import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { moves } from "@/db/schema";
import { phaseOf } from "./phase";

/**
 * Label stored moves with the phase of the game they were played in.
 *
 * Phase is derived from the position, so it needs no engine and can be filled
 * in over rows that already exist. Runs after analysis, alongside motif
 * tagging: both are cheap passes over data already in the database.
 */
export function backfillPhases(
  db: Db,
  user: string,
  options: { refill?: boolean } = {},
): number {
  const rows = db
    .select({
      gameId: moves.gameId,
      ply: moves.ply,
      fenBefore: moves.fenBefore,
    })
    .from(moves)
    .where(
      options.refill
        ? eq(moves.user, user)
        : and(eq(moves.user, user), isNull(moves.phase)),
    )
    .all();

  let filled = 0;

  db.transaction((tx) => {
    for (const row of rows) {
      const phase = phaseOf(row.fenBefore);
      // An unreadable position stays NULL rather than defaulting into a
      // phase: a wrong label silently skews the whole dimension, and the
      // queries already exclude NULL.
      if (!phase) continue;

      tx.update(moves)
        .set({ phase })
        .where(
          and(
            eq(moves.gameId, row.gameId),
            eq(moves.user, user),
            eq(moves.ply, row.ply),
          ),
        )
        .run();
      filled += 1;
    }
  });

  return filled;
}

/** How many of a user's moves still have no phase. */
export function countUnphased(db: Db, user: string): number {
  const row = db
    .select({ n: sql<number>`COUNT(*)` })
    .from(moves)
    .where(and(eq(moves.user, user), isNull(moves.phase)))
    .get();
  return row?.n ?? 0;
}
