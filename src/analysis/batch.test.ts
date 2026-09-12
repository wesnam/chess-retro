import { describe, it, expect, beforeEach } from "vitest";
import { and, eq, isNotNull } from "drizzle-orm";
import { createDb, type Db } from "@/db/client";
import { games, moves } from "@/db/schema";
import { AnalysisJob, countPending, reclaimOrphanedGames } from "./batch";
import type { Analyser } from "./analyze-game";
import type { Score } from "./accuracy";

/**
 * Resumability, tested against a real database with a stubbed analyser.
 *
 * The property under test is transactional — orphan reclaim, no duplicate
 * rows, the right resume count — and has nothing to do with chess, so no
 * engine runs here.
 */

let db: Db;

beforeEach(() => {
  db = createDb(":memory:");
});

const cp = (n: number): Score => ({ kind: "cp", cp: n });

const PGN = '[Event "Test"]\n\n1. e4 e5 2. Nf3 Nc6 *';

/** A promise a test can hold open, to keep a job's claim alive on demand. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function stubEngine(
  options: { onGame?: (n: number) => void | Promise<void> } = {},
): Analyser & { gamesSeen: number } {
  const stub = {
    depth: 18,
    gamesSeen: 0,
    async newGame() {
      stub.gamesSeen += 1;
      await options.onGame?.(stub.gamesSeen);
    },
    async analyse(_fen: string) {
      return { score: cp(10), bestMove: "e2e4", depth: 18 };
    },
  };
  return stub;
}

function seedGame(id: string, user = "alice", status = "pending") {
  db.insert(games)
    .values({
      id,
      user,
      pgn: PGN,
      timeClass: "blitz",
      userColor: "w",
      userResult: "win",
      endTime: 1_700_000_000,
      rated: true,
      analysisStatus: status,
    })
    .run();

  for (const [index, san] of ["e4", "e5", "Nf3", "Nc6"].entries()) {
    db.insert(moves)
      .values({
        gameId: id,
        ply: index + 1,
        user,
        timeClass: "blitz",
        isUserMove: index % 2 === 0,
        color: index % 2 === 0 ? "w" : "b",
        fenBefore: "fen",
        san,
        uci: "e2e4",
        piece: "p",
      })
      .run();
  }
}

function statusOf(id: string, user = "alice"): string {
  return db
    .select({ s: games.analysisStatus })
    .from(games)
    .where(and(eq(games.id, id), eq(games.user, user)))
    .get()!.s;
}

function evaluatedMoveCount(id: string): number {
  return db
    .select({ ply: moves.ply })
    .from(moves)
    .where(and(eq(moves.gameId, id), isNotNull(moves.classification)))
    .all().length;
}

describe("running a batch", () => {
  it("analyses every pending game for the user", async () => {
    seedGame("g1");
    seedGame("g2");
    seedGame("g3");

    const job = new AnalysisJob({ db, user: "alice", engines: [stubEngine()] });
    await job.run();

    expect(statusOf("g1")).toBe("done");
    expect(statusOf("g2")).toBe("done");
    expect(statusOf("g3")).toBe("done");
  });

  it("leaves another user's games alone", async () => {
    seedGame("g1", "alice");
    seedGame("g2", "bob");

    const job = new AnalysisJob({ db, user: "alice", engines: [stubEngine()] });
    await job.run();

    expect(statusOf("g1", "alice")).toBe("done");
    expect(statusOf("g2", "bob")).toBe("pending");
  });

  it("skips games already analysed, so re-running costs nothing", async () => {
    seedGame("g1", "alice", "done");
    seedGame("g2");

    const engine = stubEngine();
    const job = new AnalysisJob({ db, user: "alice", engines: [engine] });
    await job.run();

    // Only the pending game was handed to the engine.
    expect(engine.gamesSeen).toBe(1);
    expect(job.progress().completed).toBe(1);
  });

  it("records a failed game with its error and carries on", async () => {
    seedGame("g1");
    seedGame("g2");
    seedGame("g3");

    // The second game the engine sees throws.
    const engine = stubEngine({
      onGame: (n) => {
        if (n === 2) throw new Error("engine exploded");
      },
    });

    const job = new AnalysisJob({ db, user: "alice", engines: [engine] });
    await job.run();

    const statuses = ["g1", "g2", "g3"].map((id) => statusOf(id));
    expect(statuses.filter((s) => s === "done")).toHaveLength(2);
    expect(statuses.filter((s) => s === "error")).toHaveLength(1);

    const failed = db
      .select({ id: games.id, error: games.analysisError })
      .from(games)
      .where(eq(games.analysisStatus, "error"))
      .get()!;
    expect(failed.error).toContain("engine exploded");

    // A failure is still progress: the job must not stall on it.
    expect(job.progress().completed + job.progress().failed).toBe(3);
  });

  it("never analyses one game twice, even across a resume", async () => {
    seedGame("g1");
    seedGame("g2");

    const first = stubEngine();
    await new AnalysisJob({ db, user: "alice", engines: [first] }).run();

    const second = stubEngine();
    await new AnalysisJob({ db, user: "alice", engines: [second] }).run();

    expect(first.gamesSeen).toBe(2);
    // Everything was already done, so the second run had nothing to do.
    expect(second.gamesSeen).toBe(0);
  });

  it("writes each move exactly once", async () => {
    seedGame("g1");

    await new AnalysisJob({ db, user: "alice", engines: [stubEngine()] }).run();

    const rows = db
      .select({ ply: moves.ply })
      .from(moves)
      .where(eq(moves.gameId, "g1"))
      .all();

    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((r) => r.ply)).size).toBe(4);
  });

  it("spreads work across the engines it was given", async () => {
    for (let i = 0; i < 6; i++) seedGame(`g${i}`);

    const engines = [stubEngine(), stubEngine(), stubEngine()];
    const job = new AnalysisJob({ db, user: "alice", engines });
    await job.run();

    // Every engine did some work; none sat idle while another did all six.
    for (const engine of engines) {
      expect(engine.gamesSeen).toBeGreaterThan(0);
    }
    const total = engines.reduce((sum, e) => sum + e.gamesSeen, 0);
    expect(total).toBe(6);
  });
});

describe("pausing", () => {
  it("stops taking new games once paused", async () => {
    for (let i = 0; i < 6; i++) seedGame(`g${i}`);

    let job: AnalysisJob;
    const engine = stubEngine({
      onGame: (n) => {
        if (n === 2) job.pause();
      },
    });

    job = new AnalysisJob({ db, user: "alice", engines: [engine] });
    await job.run();

    // The game in flight finishes; nothing new is started.
    expect(engine.gamesSeen).toBe(2);
    expect(job.progress().status).toBe("paused");
  });

  it("leaves the remaining games pending, so resuming picks them up", async () => {
    for (let i = 0; i < 5; i++) seedGame(`g${i}`);

    let job: AnalysisJob;
    const engine = stubEngine({
      onGame: (n) => {
        if (n === 2) job.pause();
      },
    });
    job = new AnalysisJob({ db, user: "alice", engines: [engine] });
    await job.run();

    expect(countPending(db, "alice")).toBe(3);

    // Resuming completes the rest.
    await new AnalysisJob({ db, user: "alice", engines: [stubEngine()] }).run();
    expect(countPending(db, "alice")).toBe(0);
  });
});

describe("progress", () => {
  it("reports how many games there are to do and how many are done", async () => {
    for (let i = 0; i < 4; i++) seedGame(`g${i}`);

    const job = new AnalysisJob({ db, user: "alice", engines: [stubEngine()] });
    expect(job.progress().total).toBe(0);

    await job.run();

    const progress = job.progress();
    expect(progress.total).toBe(4);
    expect(progress.completed).toBe(4);
    expect(progress.status).toBe("done");
  });

  it("estimates the time remaining from the rate so far", async () => {
    for (let i = 0; i < 4; i++) seedGame(`g${i}`);

    let job: AnalysisJob;
    const engine = stubEngine({
      onGame: (n) => {
        if (n === 2) job.pause();
      },
    });
    job = new AnalysisJob({ db, user: "alice", engines: [engine] });
    await job.run();

    const progress = job.progress();
    expect(progress.completed).toBe(2);
    // Two of four done, so an estimate for the rest is available.
    expect(progress.remaining).toBe(2);
    expect(progress.etaMs).toBeGreaterThanOrEqual(0);
  });

  it("has no estimate before anything has finished", () => {
    seedGame("g1");
    const job = new AnalysisJob({ db, user: "alice", engines: [stubEngine()] });

    expect(job.progress().etaMs).toBeUndefined();
  });
});

describe("reclaiming orphans", () => {
  it("returns a crashed run's games to pending", () => {
    seedGame("g1", "alice", "running");
    seedGame("g2", "alice", "pending");

    expect(reclaimOrphanedGames(db)).toBe(1);
    expect(statusOf("g1")).toBe("pending");
  });

  it("leaves a live job's games alone", async () => {
    // The whole point of an ownership token: a reclaim triggered while a job
    // is running must not steal the game that job is working on, or two
    // workers analyse it at once and one overwrites the other.
    for (let i = 0; i < 4; i++) seedGame(`g${i}`);

    let reclaimed = -1;
    const engine = stubEngine({
      onGame: (n) => {
        // Reclaim from "another process" while this job holds a game.
        if (n === 1) reclaimed = reclaimOrphanedGames(db);
      },
    });

    const job = new AnalysisJob({ db, user: "alice", engines: [engine] });
    await job.run();

    expect(reclaimed).toBe(0);
    expect(job.progress().completed).toBe(4);
  });

  it("leaves games alone when several jobs are live at once", async () => {
    // Two runs in flight is the case an `or` over the live owners gets wrong:
    // a game held by A satisfies "owner is not B", so it reads as orphaned and
    // is taken from A while A is still analysing it.
    for (let i = 0; i < 6; i++) seedGame(`g${i}`);
    seedGame("h1", "bob");

    let reclaimed = -1;
    const blockAlice = deferred();

    const aliceEngine = stubEngine({
      onGame: (n) => {
        // Hold Alice's first game open so her claim is live while Bob runs.
        if (n === 1) return blockAlice.promise;
      },
    });
    const alice = new AnalysisJob({
      db,
      user: "alice",
      engines: [aliceEngine],
    });
    const aliceRun = alice.run();

    const bobEngine = stubEngine({
      onGame: () => {
        // Both runs are now live and each holds a game.
        reclaimed = reclaimOrphanedGames(db);
      },
    });
    await new AnalysisJob({ db, user: "bob", engines: [bobEngine] }).run();

    blockAlice.resolve();
    await aliceRun;

    expect(reclaimed).toBe(0);
    expect(alice.progress().failed).toBe(0);
  });

  it("does not resurrect a finished game", () => {
    seedGame("g1", "alice", "done");

    expect(reclaimOrphanedGames(db)).toBe(0);
    expect(statusOf("g1")).toBe("done");
  });

  it("counts what is left to do after a crash", () => {
    seedGame("g1", "alice", "running");
    seedGame("g2", "alice", "done");
    seedGame("g3", "alice", "pending");
    seedGame("g4", "alice", "error");

    reclaimOrphanedGames(db);

    // The crashed one and the never-started one; not the done one, and not
    // the failed one, which would otherwise retry forever.
    expect(countPending(db, "alice")).toBe(2);
  });
});
