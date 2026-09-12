import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { games, moveMotifs, moves } from "@/db/schema";

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

  return db
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
