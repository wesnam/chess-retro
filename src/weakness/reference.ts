import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { games, moveMotifs, moves } from "@/db/schema";

/**
 * How often players of a similar strength miss each tactic.
 *
 * The measure the dashboard ranks on. Lift — cost against the player's OWN
 * average — cannot answer "what am I bad at", because it divides out exactly
 * the thing being asked about: a grandmaster measured against 2.13 points per
 * move and a beginner measured against 5.14 both come out near 1.5x, and their
 * top-five lists look alike. Measured against real games from the player's own
 * rating band, the difference is stark: on the corpus this was built from,
 * `sacrifice` ranked second by lift but sits within a point of a 3352-rated
 * player's rate, while `discoveredAttack` and `pin` — the two the player
 * confirmed as true — stand ten points clear.
 *
 * A rate is "bad" only relative to peers. A 600-rated player missing 14% of
 * forks may be entirely ordinary for 600, and sending them to drill forks
 * would waste the practice the whole tool exists to direct.
 */

/** One motif's miss rate across the reference cohort. */
export type ReferenceRate = {
  motif: string;
  /** Plies where the tactic was on the board, across the cohort. */
  opportunities: number;
  /** How many of those the cohort missed. */
  failures: number;
  /** failures / opportunities. */
  missRate: number;
  /** How many distinct players contributed. */
  players: number;
};

/**
 * Cohort miss rates, computed from stored games.
 *
 * Derived from the same detectors that measure the user, so any detector bias
 * cancels on both sides of the comparison. That also means these numbers mean
 * something only within this tool — they are not comparable to Lichess's or
 * chess.com's published statistics.
 */
export function referenceRates(
  db: Db,
  cohort: string[],
  timeClass: string,
): ReferenceRate[] {
  if (cohort.length === 0) return [];

  return db
    .select({
      motif: moveMotifs.motif,
      opportunities: sql<number>`COUNT(DISTINCT ${moveMotifs.user} || ':' || ${moveMotifs.gameId} || ':' || ${moveMotifs.ply})`,
      failures: sql<number>`COUNT(DISTINCT CASE WHEN ${moveMotifs.role} = 'missed' THEN ${moveMotifs.user} || ':' || ${moveMotifs.gameId} || ':' || ${moveMotifs.ply} END)`,
      players: sql<number>`COUNT(DISTINCT ${moveMotifs.user})`,
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
        inArray(moveMotifs.user, cohort),
        eq(moveMotifs.timeClass, timeClass),
        // Only the cohort players' own moves, matching how the user is
        // measured; their opponents are a different population entirely.
        eq(moves.isUserMove, true),
      ),
    )
    .groupBy(moveMotifs.motif)
    .all()
    .map((row) => ({
      motif: row.motif,
      opportunities: row.opportunities ?? 0,
      failures: row.failures ?? 0,
      missRate: row.opportunities ? (row.failures ?? 0) / row.opportunities : 0,
      players: row.players ?? 0,
    }));
}

/**
 * Opportunities a motif needs across the cohort before its rate is usable.
 *
 * A reference rate drawn from a handful of sightings is noise, and subtracting
 * noise from the user's rate produces a confident-looking excess that means
 * nothing.
 */
export const MIN_REFERENCE_OPPORTUNITIES = 40;

/** Players a motif needs to appear across, so one person cannot set the bar. */
export const MIN_REFERENCE_PLAYERS = 3;

export type ReferenceTable = Map<string, ReferenceRate>;

/** Index the usable rates by motif; thin ones are omitted rather than trusted. */
export function referenceTable(rates: ReferenceRate[]): ReferenceTable {
  const table: ReferenceTable = new Map();
  for (const rate of rates) {
    if (rate.opportunities < MIN_REFERENCE_OPPORTUNITIES) continue;
    if (rate.players < MIN_REFERENCE_PLAYERS) continue;
    table.set(rate.motif, rate);
  }
  return table;
}
