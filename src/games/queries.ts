import { desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { games } from "@/db/schema";

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
