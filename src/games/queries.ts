import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { games, moveMotifs, moves } from "@/db/schema";

/**
 * How many of the player's own moves earned each mark.
 *
 * Every grade is present and zero when unearned, so a caller can render the
 * six in a fixed order without checking for holes.
 */
export type MoveMarks = {
  best: number;
  excellent: number;
  good: number;
  inaccuracy: number;
  mistake: number;
  blunder: number;
};

const MARK_GRADES = [
  "best",
  "excellent",
  "good",
  "inaccuracy",
  "mistake",
  "blunder",
] as const;

function emptyMarks(): MoveMarks {
  return {
    best: 0,
    excellent: 0,
    good: 0,
    inaccuracy: 0,
    mistake: 0,
    blunder: 0,
  };
}

export type GameListRow = {
  id: string;
  url: string | null;
  endTime: number;
  timeClass: string;
  timeControl: string | null;
  userColor: string;
  userResult: string;
  userResultRaw: string | null;
  userRating: number | null;
  opponentUsername: string | null;
  opponentRating: number | null;
  openingName: string | null;
  analysisStatus: string;
  /** The player's own moves by grade; all zero until the game is analysed. */
  marks: MoveMarks;
};

/** Most recent first — the order a person expects to browse their own games. */
export function listGames(
  db: Db,
  user: string,
  options: { limit?: number; timeClass?: string } = {},
): GameListRow[] {
  const { limit = 200, timeClass } = options;

  const where = timeClass
    ? sql`${games.user} = ${user} AND ${games.timeClass} = ${timeClass}`
    : eq(games.user, user);

  const rows = db
    .select({
      id: games.id,
      url: games.url,
      endTime: games.endTime,
      timeClass: games.timeClass,
      timeControl: games.timeControl,
      userColor: games.userColor,
      userResult: games.userResult,
      userResultRaw: games.userResultRaw,
      userRating: games.userRating,
      opponentUsername: games.opponentUsername,
      opponentRating: games.opponentRating,
      openingName: games.openingName,
      analysisStatus: games.analysisStatus,
    })
    .from(games)
    .where(where)
    .orderBy(desc(games.endTime))
    .limit(limit)
    .all();

  const marks = markCounts(
    db,
    user,
    rows.map((row) => row.id),
  );

  return rows.map((row) => ({
    ...row,
    marks: marks.get(row.id) ?? emptyMarks(),
  }));
}

/**
 * Mark counts for a set of games, as one grouped query.
 *
 * Counted per game rather than per row so the list costs one query regardless
 * of how many games it shows; a lookup inside the map would put a query per
 * row on a page that renders two hundred.
 *
 * Scoped by user as well as game: one chess.com game is two rows when both
 * players are tracked, and grouping by game alone would show each player the
 * other's blunders.
 */
function markCounts(
  db: Db,
  user: string,
  gameIds: string[],
): Map<string, MoveMarks> {
  const counts = new Map<string, MoveMarks>();
  if (gameIds.length === 0) return counts;

  const rows = db
    .select({
      gameId: moves.gameId,
      classification: moves.classification,
      total: sql<number>`count(*)`,
    })
    .from(moves)
    .where(
      and(
        eq(moves.user, user),
        eq(moves.isUserMove, true),
        inArray(moves.gameId, gameIds),
        isNotNull(moves.classification),
      ),
    )
    .groupBy(moves.gameId, moves.classification)
    .all();

  for (const row of rows) {
    // A classification the app no longer knows about is skipped rather than
    // widening the row's shape with a key the renderer cannot place.
    if (!isGrade(row.classification)) continue;

    const marks = counts.get(row.gameId) ?? emptyMarks();
    marks[row.classification] = row.total;
    counts.set(row.gameId, marks);
  }

  return counts;
}

function isGrade(value: string | null): value is keyof MoveMarks {
  return value !== null && (MARK_GRADES as readonly string[]).includes(value);
}

export type GameDetail = {
  id: string;
  user: string;
  url: string | null;
  endTime: number;
  timeClass: string;
  timeControl: string | null;
  userColor: string;
  userResult: string;
  userResultRaw: string | null;
  userRating: number | null;
  opponentUsername: string | null;
  opponentRating: number | null;
  openingName: string | null;
  eco: string | null;
  analysisStatus: string;
  analysisError: string | null;
  analysisDepth: number | null;
  accuracyUser: number | null;
  ccAccuracyUser: number | null;
  ccAccuracyOpponent: number | null;
};

export function getGame(
  db: Db,
  user: string,
  gameId: string,
): GameDetail | undefined {
  return db
    .select({
      id: games.id,
      user: games.user,
      url: games.url,
      endTime: games.endTime,
      timeClass: games.timeClass,
      timeControl: games.timeControl,
      userColor: games.userColor,
      userResult: games.userResult,
      userResultRaw: games.userResultRaw,
      userRating: games.userRating,
      opponentUsername: games.opponentUsername,
      opponentRating: games.opponentRating,
      openingName: games.openingName,
      eco: games.eco,
      analysisStatus: games.analysisStatus,
      analysisError: games.analysisError,
      analysisDepth: games.analysisDepth,
      accuracyUser: games.accuracyUser,
      ccAccuracyUser: games.ccAccuracyUser,
      ccAccuracyOpponent: games.ccAccuracyOpponent,
    })
    .from(games)
    .where(and(eq(games.id, gameId), eq(games.user, user)))
    .get();
}

export type MoveRow = {
  ply: number;
  color: string;
  san: string;
  uci: string;
  fenBefore: string;
  isUserMove: boolean;
  evalBefore: number | null;
  evalAfter: number | null;
  mateBefore: number | null;
  mateAfter: number | null;
  bestMoveUci: string | null;
  bestLine: string | null;
  cpLoss: number | null;
  winPctBefore: number | null;
  winPctAfter: number | null;
  moveAccuracy: number | null;
  classification: string | null;
  clockMs: number | null;
  moveTimeMs: number | null;
};

export function listMoves(db: Db, user: string, gameId: string): MoveRow[] {
  return db
    .select({
      ply: moves.ply,
      color: moves.color,
      san: moves.san,
      uci: moves.uci,
      fenBefore: moves.fenBefore,
      isUserMove: moves.isUserMove,
      evalBefore: moves.evalBefore,
      evalAfter: moves.evalAfter,
      mateBefore: moves.mateBefore,
      mateAfter: moves.mateAfter,
      bestMoveUci: moves.bestMoveUci,
      bestLine: moves.bestLine,
      cpLoss: moves.cpLoss,
      winPctBefore: moves.winPctBefore,
      winPctAfter: moves.winPctAfter,
      moveAccuracy: moves.moveAccuracy,
      classification: moves.classification,
      clockMs: moves.clockMs,
      moveTimeMs: moves.moveTimeMs,
    })
    .from(moves)
    .where(and(eq(moves.gameId, gameId), eq(moves.user, user)))
    .orderBy(moves.ply)
    .all();
}

/**
 * Tactics the user missed, by ply, for one game.
 *
 * Only the `missed` role: what the player found is not what they need to
 * practise, and the opponent's tactics are not theirs to fix.
 */
export function listMissedMotifs(
  db: Db,
  user: string,
  gameId: string,
): Map<number, string[]> {
  const rows = db
    .select({ ply: moveMotifs.ply, motif: moveMotifs.motif })
    .from(moveMotifs)
    .where(
      and(
        eq(moveMotifs.gameId, gameId),
        eq(moveMotifs.user, user),
        eq(moveMotifs.role, "missed"),
      ),
    )
    .orderBy(moveMotifs.ply)
    .all();

  const byPly = new Map<number, string[]>();
  for (const row of rows) {
    const existing = byPly.get(row.ply);
    if (existing) existing.push(row.motif);
    else byPly.set(row.ply, [row.motif]);
  }
  return byPly;
}

export type GameCounts = {
  total: number;
  byTimeClass: { timeClass: string; count: number }[];
  byResult: { win: number; loss: number; draw: number };
};

export function countGames(db: Db, user: string): GameCounts {
  const rows = db
    .select({
      timeClass: games.timeClass,
      userResult: games.userResult,
      n: sql<number>`count(*)`,
    })
    .from(games)
    .where(eq(games.user, user))
    .groupBy(games.timeClass, games.userResult)
    .all();

  const byTimeClass = new Map<string, number>();
  const byResult = { win: 0, loss: 0, draw: 0 };
  let total = 0;

  for (const row of rows) {
    total += row.n;
    byTimeClass.set(row.timeClass, (byTimeClass.get(row.timeClass) ?? 0) + row.n);
    if (row.userResult in byResult) {
      byResult[row.userResult as keyof typeof byResult] += row.n;
    }
  }

  return {
    total,
    byTimeClass: [...byTimeClass.entries()]
      .map(([timeClass, count]) => ({ timeClass, count }))
      .sort((a, b) => b.count - a.count),
    byResult,
  };
}
