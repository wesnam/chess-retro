import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Db } from "@/db/client";
import { games } from "@/db/schema";
import { analyseAndStore, type StoredGame } from "./store";
import type { Analyser } from "./analyze-game";

/**
 * Analyse a whole corpus, resumably.
 *
 * The unit of work is a WHOLE GAME, not a position. That keeps the engine's
 * transposition table warm across the positions of one game — consecutive
 * positions share nearly all their search tree — and makes resumability easy
 * to reason about: a game is either entirely analysed or entirely not.
 *
 * Every worker pulls its next game from the database rather than from a list
 * decided up front, so a crash loses at most the games actually in flight.
 */

export type JobStatus = "idle" | "running" | "paused" | "done";

export type Progress = {
  status: JobStatus;
  /** Games this run set out to analyse. */
  total: number;
  completed: number;
  failed: number;
  remaining: number;
  /** Games per millisecond, over this run so far. */
  ratePerMs: number | undefined;
  /** Estimated milliseconds left, absent until something has finished. */
  etaMs: number | undefined;
  startedAt: number | undefined;
};

export type JobOptions = {
  db: Db;
  user: string;
  engines: Analyser[];
  /** Injectable for tests; defaults to the wall clock. */
  now?: () => number;
};

export class AnalysisJob {
  private readonly db: Db;
  private readonly user: string;
  private readonly engines: Analyser[];
  private readonly now: () => number;

  /**
   * Identifies this run in `games.analysis_owner`. Orphan reclaim uses it to
   * tell a crashed run's abandoned games from the ones this run is actively
   * working on.
   */
  readonly id = randomUUID();

  private status: JobStatus = "idle";
  private total = 0;
  private completed = 0;
  private failed = 0;
  private startedAt: number | undefined;
  private finishedAt: number | undefined;

  constructor(options: JobOptions) {
    this.db = options.db;
    this.user = options.user;
    this.engines = options.engines;
    this.now = options.now ?? Date.now;
  }

  /**
   * Analyse everything outstanding, returning when the corpus is done or the
   * job is paused.
   *
   * Each engine runs its own loop, claiming the next available game as it
   * finishes the last. Work is not divided up front: engines are not equally
   * fast, and games are not equally long, so a static split would leave one
   * engine still grinding while the rest sat idle.
   */
  async run(): Promise<Progress> {
    if (this.status === "running") return this.progress();

    this.status = "running";
    this.startedAt = this.now();
    this.finishedAt = undefined;
    this.completed = 0;
    this.failed = 0;
    this.total = countPending(this.db, this.user);

    // Registered for as long as this run holds games, so a reclaim triggered
    // meanwhile cannot take them back out from under it.
    liveRuns.add(this.id);
    try {
      await Promise.all(this.engines.map((engine) => this.worker(engine)));
    } finally {
      liveRuns.delete(this.id);
    }

    this.finishedAt = this.now();
    if (this.status === "running") this.status = "done";
    return this.progress();
  }

  /**
   * Stop taking new games. The games already in flight finish and commit —
   * abandoning them would waste the engine time already spent and leave rows
   * to reclaim.
   */
  pause(): void {
    if (this.status === "running") this.status = "paused";
  }

  progress(): Progress {
    const elapsed =
      this.startedAt === undefined
        ? 0
        : (this.finishedAt ?? this.now()) - this.startedAt;

    const finished = this.completed + this.failed;
    const remaining = Math.max(0, this.total - finished);

    // No rate until something has actually finished; dividing by zero elapsed
    // or zero games would report an infinite or absurd estimate.
    const ratePerMs =
      finished > 0 && elapsed > 0 ? finished / elapsed : undefined;

    return {
      status: this.status,
      total: this.total,
      completed: this.completed,
      failed: this.failed,
      remaining,
      ratePerMs,
      etaMs: ratePerMs ? Math.round(remaining / ratePerMs) : undefined,
      startedAt: this.startedAt,
    };
  }

  private async worker(engine: Analyser): Promise<void> {
    while (this.status === "running") {
      const game = this.claimNext();
      if (!game) return;

      try {
        await analyseAndStore(this.db, game, engine, { alreadyClaimed: true });
        this.completed += 1;
      } catch (error) {
        // One bad game must not end an overnight run. `analyseAndStore` has
        // already recorded the error against the game.
        this.failed += 1;
        this.recordFailure(game, error);
      }
    }
  }

  /**
   * Take the next outstanding game, marking it `running` and stamping this run
   * as its owner in one statement.
   *
   * The claim is a compare-and-set on `analysis_status`, so two workers racing
   * for the same game cannot both win: the loser's update matches no row and
   * it moves on to the next.
   */
  private claimNext(): StoredGame | undefined {
    // Ordered oldest-first so a resumed run makes steady forward progress
    // rather than revisiting whatever the previous run happened to skip.
    const candidate = this.db
      .select({
        id: games.id,
        user: games.user,
        pgn: games.pgn,
        userColor: games.userColor,
        analysisStatus: games.analysisStatus,
      })
      .from(games)
      .where(and(eq(games.user, this.user), eq(games.analysisStatus, "pending")))
      .orderBy(games.endTime)
      .limit(1)
      .get();

    if (!candidate) return undefined;

    const claimed = this.db
      .update(games)
      .set({
        analysisStatus: "running",
        analysisOwner: this.id,
        analysisError: null,
      })
      .where(
        and(
          eq(games.id, candidate.id),
          eq(games.user, candidate.user),
          // Still pending: another worker may have taken it since the select.
          eq(games.analysisStatus, "pending"),
        ),
      )
      .run();

    // Lost the race; try again for a different game.
    if (claimed.changes === 0) return this.claimNext();

    return { ...candidate, analysisStatus: "running" };
  }

  private recordFailure(game: StoredGame, error: unknown): void {
    this.db
      .update(games)
      .set({
        analysisStatus: "error",
        analysisError: error instanceof Error ? error.message : String(error),
        analysisOwner: null,
      })
      .where(
        and(
          eq(games.id, game.id),
          eq(games.user, game.user),
          // Only our own claim: another run may have since taken this game.
          eq(games.analysisOwner, this.id),
        ),
      )
      .run();
  }
}

/** Games still to analyse. Excludes failures, which would otherwise retry forever. */
export function countPending(db: Db, user: string): number {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(games)
    .where(and(eq(games.user, user), eq(games.analysisStatus, "pending")))
    .get();
  return row?.n ?? 0;
}

/**
 * Runs currently analysing in this process.
 *
 * A job adds itself for as long as it is working and removes itself when it
 * stops, so reclaim can tell a crashed run's abandoned games from the ones a
 * live run is still working on. Process-wide rather than passed around: the
 * caller doing the reclaiming — startup, or a stalled-job sweep — has no way
 * to know which jobs happen to be running.
 */
const liveRuns = new Set<string>();

/**
 * Return games abandoned by a crashed run to `pending`.
 *
 * Games held by a run that is still live are deliberately left alone: taking
 * one back mid-analysis would let a second worker start the same game, and
 * whichever finished last would overwrite the other. After a crash no run is
 * live, so everything left `running` is correctly reclaimed.
 */
export function reclaimOrphanedGames(db: Db): number {
  const owners = [...liveRuns];

  const result = db
    .update(games)
    .set({ analysisStatus: "pending", analysisOwner: null })
    .where(
      and(
        eq(games.analysisStatus, "running"),
        // A game with no owner predates this column or lost its owner in a
        // crash; either way no live run holds it.
        owners.length === 0
          ? undefined
          : or(
              isNull(games.analysisOwner),
              ...owners.map((owner) => ne(games.analysisOwner, owner)),
            ),
      ),
    )
    .run();

  return result.changes;
}
