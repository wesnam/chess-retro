import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { games, moveMotifs, moves } from "@/db/schema";
import { motifLabel } from "@/analysis/motifs/labels";
import type { WeaknessCandidate } from "./score";

/**
 * Turning the corpus into ranked candidates.
 *
 * Every dimension answers the same two questions: how often did the
 * opportunity arise (exposure), and what did failing it cost. Exposure is the
 * part that makes a rate mean anything, and it differs per dimension — for
 * motifs it is how often the tactic was on the board at all, for phase it is
 * how many moves were played in that phase.
 *
 * Time class filters everything and is never aggregated across: a blitz
 * time-pressure error and a rapid miscalculation are different problems, and
 * averaging them describes a player who does not exist.
 */

/** Win probability a move threw away, floored at zero. */
const lostExpr = sql<number>`SUM(MAX(0, ${moves.winPctBefore} - ${moves.winPctAfter}))`;

type Scope = { user: string; timeClass: string };

function analysedUserMoves({ user, timeClass }: Scope) {
  return and(
    eq(moves.user, user),
    eq(moves.timeClass, timeClass),
    eq(moves.isUserMove, true),
    sql`${moves.winPctBefore} IS NOT NULL`,
    sql`${moves.winPctAfter} IS NOT NULL`,
  );
}

/**
 * The player's own cost per move across the corpus, in win-probability points.
 *
 * This is the standard every candidate is measured against. It must come from
 * the whole corpus rather than from the candidates being ranked: averaging the
 * candidates would make the comparison self-referential and put half of any
 * set below "average" by construction.
 */
/** How many of the user's moves in this time class carry an evaluation. */
export function countAnalysedMoves(db: Db, scope: Scope): number {
  const row = db
    .select({ n: sql<number>`COUNT(*)` })
    .from(moves)
    .where(analysedUserMoves(scope))
    .get();
  return row?.n ?? 0;
}

export function corpusBaseline(db: Db, scope: Scope): number {
  const row = db
    .select({ lost: lostExpr, n: sql<number>`COUNT(*)` })
    .from(moves)
    .where(analysedUserMoves(scope))
    .get();

  if (!row || !row.n) return 0;
  return (row.lost ?? 0) / row.n;
}

/**
 * Motifs the player missed.
 *
 * Exposure is how often the tactic was present at all — in any role — because
 * that is how often the player had the chance to see it. Failures are the
 * `missed` ones. Counting only missed tags as both numerator and denominator
 * would make every rate exactly 1.
 */
export function motifCandidates(db: Db, scope: Scope): WeaknessCandidate[] {
  const { user, timeClass } = scope;

  const rows = db
    .select({
      motif: moveMotifs.motif,
      opportunities: sql<number>`COUNT(DISTINCT ${moveMotifs.gameId} || ':' || ${moveMotifs.ply})`,
      failures: sql<number>`COUNT(DISTINCT CASE WHEN ${moveMotifs.role} = 'missed' THEN ${moveMotifs.gameId} || ':' || ${moveMotifs.ply} END)`,
      games: sql<number>`COUNT(DISTINCT ${moveMotifs.gameId})`,
      lost: sql<number>`SUM(CASE WHEN ${moveMotifs.role} = 'missed' THEN MAX(0, ${moves.winPctBefore} - ${moves.winPctAfter}) ELSE 0 END)`,
    })
    .from(moveMotifs)
    .innerJoin(
      moves,
      and(
        eq(moves.gameId, moveMotifs.gameId),
        eq(moves.user, moveMotifs.user),
        eq(moves.ply, moveMotifs.ply),
      ),
    )
    .where(
      and(
        eq(moveMotifs.user, user),
        eq(moveMotifs.timeClass, timeClass),
        // The same filter every other dimension applies, and the one
        // `examplesFor` applies when fetching this weakness's evidence.
        // `moveMotifs.user` is the corpus owner, not the mover, so without
        // this the opponent's blunders would count as the player's missed
        // tactics — and the card's numbers would not reconcile with the
        // examples printed beneath them.
        eq(moves.isUserMove, true),
        sql`${moves.winPctBefore} IS NOT NULL`,
        sql`${moves.winPctAfter} IS NOT NULL`,
      ),
    )
    .groupBy(moveMotifs.motif)
    .all();

  return rows.map((row) => ({
    dimension: "motif" as const,
    key: row.motif,
    label: motifLabel(row.motif),
    opportunities: row.opportunities ?? 0,
    failures: row.failures ?? 0,
    winPctLost: row.lost ?? 0,
    games: row.games ?? 0,
  }));
}

/**
 * Which phase of the game errors cluster in.
 *
 * Exposure is every move played in that phase; failure is every move that lost
 * meaningful win probability. Phase is stored on the move row, computed from
 * the position rather than the move number.
 */
export function phaseCandidates(db: Db, scope: Scope): WeaknessCandidate[] {
  const rows = db
    .select({
      phase: moves.phase,
      opportunities: sql<number>`COUNT(*)`,
      failures: sql<number>`SUM(CASE WHEN ${moves.classification} IN ('inaccuracy','mistake','blunder') THEN 1 ELSE 0 END)`,
      games: sql<number>`COUNT(DISTINCT ${moves.gameId})`,
      lost: lostExpr,
    })
    .from(moves)
    .where(and(analysedUserMoves(scope), sql`${moves.phase} IS NOT NULL`))
    .groupBy(moves.phase)
    .all();

  const names: Record<string, string> = {
    opening: "The opening",
    middlegame: "The middlegame",
    endgame: "The endgame",
  };

  return rows
    .filter((row): row is typeof row & { phase: string } => row.phase !== null)
    .map((row) => ({
      dimension: "phase" as const,
      key: row.phase,
      label: names[row.phase] ?? row.phase,
      opportunities: row.opportunities ?? 0,
      failures: row.failures ?? 0,
      winPctLost: row.lost ?? 0,
      games: row.games ?? 0,
    }));
}

/**
 * Whether errors cluster under time pressure.
 *
 * Buckets are by time REMAINING on the clock, not by time spent: the question
 * is whether the player falls apart when short of time. Bucketing by seconds
 * would make bullet and rapid incomparable, so each bucket is a fraction of
 * the game's own starting time, and time class is already a filter.
 */
export function timeCandidates(db: Db, scope: Scope): WeaknessCandidate[] {
  // Named once and referenced in both SELECT and GROUP BY. Grouping by the
  // ordinal `1` also works, but couples the query to the key order of the
  // object literal below: moving `bucket` down one line would silently group
  // by COUNT(*) instead, which SQLite accepts.
  // No NULL branch: the WHERE already excludes rows without a clock.
  const bucketExpr = sql<string>`CASE
    WHEN ${moves.clockMs} < 10000 THEN 'scramble'
    WHEN ${moves.clockMs} < 30000 THEN 'low'
    ELSE 'comfortable'
  END`;

  const rows = db
    .select({
      bucket: bucketExpr,
      opportunities: sql<number>`COUNT(*)`,
      failures: sql<number>`SUM(CASE WHEN ${moves.classification} IN ('inaccuracy','mistake','blunder') THEN 1 ELSE 0 END)`,
      games: sql<number>`COUNT(DISTINCT ${moves.gameId})`,
      lost: lostExpr,
    })
    .from(moves)
    .where(and(analysedUserMoves(scope), sql`${moves.clockMs} IS NOT NULL`))
    .groupBy(bucketExpr)
    .all();

  const names: Record<string, string> = {
    scramble: "Under 10 seconds left",
    low: "Under 30 seconds left",
    comfortable: "With time to think",
  };

  return rows
    .filter((row): row is typeof row & { bucket: string } => row.bucket !== null)
    .map((row) => ({
      dimension: "time" as const,
      key: row.bucket,
      label: names[row.bucket] ?? row.bucket,
      opportunities: row.opportunities ?? 0,
      failures: row.failures ?? 0,
      winPctLost: row.lost ?? 0,
      games: row.games ?? 0,
    }));
}

/**
 * Openings the player scores badly from.
 *
 * Exposure is moves played in games of that opening family, so the
 * denominator is comparable with the other dimensions rather than being a
 * game count.
 */
export function openingCandidates(db: Db, scope: Scope): WeaknessCandidate[] {
  const rows = db
    .select({
      family: games.openingFamily,
      opportunities: sql<number>`COUNT(*)`,
      failures: sql<number>`SUM(CASE WHEN ${moves.classification} IN ('inaccuracy','mistake','blunder') THEN 1 ELSE 0 END)`,
      games: sql<number>`COUNT(DISTINCT ${moves.gameId})`,
      lost: lostExpr,
    })
    .from(moves)
    .innerJoin(
      games,
      and(eq(games.id, moves.gameId), eq(games.user, moves.user)),
    )
    .where(
      and(analysedUserMoves(scope), sql`${games.openingFamily} IS NOT NULL`),
    )
    .groupBy(games.openingFamily)
    .all();

  return rows
    .filter((row): row is typeof row & { family: string } => row.family !== null)
    .map((row) => ({
      dimension: "opening" as const,
      key: row.family,
      label: row.family,
      opportunities: row.opportunities ?? 0,
      failures: row.failures ?? 0,
      winPctLost: row.lost ?? 0,
      games: row.games ?? 0,
    }));
}

/** Whether errors concentrate on one piece the player handles badly. */
export function pieceCandidates(db: Db, scope: Scope): WeaknessCandidate[] {
  const rows = db
    .select({
      piece: moves.piece,
      opportunities: sql<number>`COUNT(*)`,
      failures: sql<number>`SUM(CASE WHEN ${moves.classification} IN ('inaccuracy','mistake','blunder') THEN 1 ELSE 0 END)`,
      games: sql<number>`COUNT(DISTINCT ${moves.gameId})`,
      lost: lostExpr,
    })
    .from(moves)
    .where(analysedUserMoves(scope))
    .groupBy(moves.piece)
    .all();

  const names: Record<string, string> = {
    p: "Pawn moves",
    n: "Knight moves",
    b: "Bishop moves",
    r: "Rook moves",
    q: "Queen moves",
    k: "King moves",
  };

  return rows.map((row) => ({
    dimension: "piece" as const,
    key: row.piece,
    label: names[row.piece] ?? row.piece,
    opportunities: row.opportunities ?? 0,
    failures: row.failures ?? 0,
    winPctLost: row.lost ?? 0,
    games: row.games ?? 0,
  }));
}

/** Every dimension's candidates, for ranking in one pool. */
export function allCandidates(db: Db, scope: Scope): WeaknessCandidate[] {
  return [
    ...motifCandidates(db, scope),
    ...phaseCandidates(db, scope),
    ...timeCandidates(db, scope),
    ...openingCandidates(db, scope),
    ...pieceCandidates(db, scope),
  ];
}

export type WeaknessExample = {
  gameId: string;
  ply: number;
  san: string;
  fenBefore: string;
  classification: string | null;
  winPctLost: number;
  endTime: number;
  opponentUsername: string | null;
};

/**
 * Real positions where a weakness showed up, worst first.
 *
 * The evidence behind a claim: without being able to click into the actual
 * moves, a ranked weakness is just an assertion.
 */
export function examplesFor(
  db: Db,
  scope: Scope,
  candidate: { dimension: string; key: string },
  limit = 3,
): WeaknessExample[] {
  const base = {
    gameId: moves.gameId,
    ply: moves.ply,
    san: moves.san,
    fenBefore: moves.fenBefore,
    classification: moves.classification,
    winPctLost: sql<number>`MAX(0, ${moves.winPctBefore} - ${moves.winPctAfter})`,
    endTime: games.endTime,
    opponentUsername: games.opponentUsername,
  };

  const withGame = (where: ReturnType<typeof and>) =>
    db
      .select(base)
      .from(moves)
      .innerJoin(
        games,
        and(eq(games.id, moves.gameId), eq(games.user, moves.user)),
      )
      .where(where)
      .orderBy(sql`MAX(0, ${moves.winPctBefore} - ${moves.winPctAfter}) DESC`)
      .limit(limit)
      .all();

  switch (candidate.dimension) {
    case "motif":
      return db
        .select(base)
        .from(moves)
        .innerJoin(
          moveMotifs,
          and(
            eq(moveMotifs.gameId, moves.gameId),
            eq(moveMotifs.user, moves.user),
            eq(moveMotifs.ply, moves.ply),
          ),
        )
        .innerJoin(
          games,
          and(eq(games.id, moves.gameId), eq(games.user, moves.user)),
        )
        .where(
          and(
            analysedUserMoves(scope),
            eq(moveMotifs.motif, candidate.key),
            eq(moveMotifs.role, "missed"),
          ),
        )
        .orderBy(sql`MAX(0, ${moves.winPctBefore} - ${moves.winPctAfter}) DESC`)
        .limit(limit)
        .all();

    case "phase":
      return withGame(
        and(analysedUserMoves(scope), eq(moves.phase, candidate.key)),
      );

    case "piece":
      return withGame(
        and(analysedUserMoves(scope), eq(moves.piece, candidate.key)),
      );

    case "opening":
      return withGame(
        and(analysedUserMoves(scope), eq(games.openingFamily, candidate.key)),
      );

    case "time": {
      const clock = moves.clockMs;
      const bounds =
        candidate.key === "scramble"
          ? sql`${clock} < 10000`
          : candidate.key === "low"
            ? sql`${clock} >= 10000 AND ${clock} < 30000`
            : sql`${clock} >= 30000`;
      return withGame(and(analysedUserMoves(scope), bounds));
    }

    default:
      return [];
  }
}
