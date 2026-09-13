import { and, desc, eq, gte, isNotNull, lte, notInArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { games, puzzleAttempts, puzzles, puzzleThemes } from "@/db/schema";
import { MIN_POPULARITY } from "./parse";

/**
 * Choosing what to practise.
 *
 * Four filters, in the order the ticket asks for them: the theme of the
 * weakness being drilled, a band around the player's own rating, a popularity
 * floor so the material is sound, and everything they have already seen.
 *
 * Each filter is a WHERE clause rather than a post-filter in JavaScript. With
 * six million rows, reading them out to filter in memory is not an option, and
 * the schema's `puzzle_themes_theme` and `puzzles_rating_pop` indexes exist
 * precisely for this shape of query.
 */

/**
 * How far either side of the player's rating a puzzle may sit.
 *
 * Wide enough that every theme has material at any rating — a narrow band
 * empties out for rarer themes and the page has nothing to show — and narrow
 * enough that the puzzles are still about this player. Lichess's own puzzle
 * ratings share the Glicko scale the player's rating is on, so the two are
 * directly comparable.
 */
export const RATING_BAND = 300;

/**
 * The rating used when the player has none: no rated games yet, or a corpus
 * that predates the API recording it. The median of the puzzle database is a
 * better guess than the extremes at either end.
 */
export const DEFAULT_RATING = 1500;

/** How many puzzles a practice session serves before it runs out. */
export const DEFAULT_LIMIT = 10;

export type PracticePuzzle = {
  id: string;
  fen: string;
  movesUci: string;
  rating: number;
  gameUrl: string | null;
};

/**
 * What this player is currently rated in one time control.
 *
 * The most recent rated game, not an average: a corpus reaching back a year
 * averages in a player the person is no longer, and would hand a improving
 * player puzzles for the rating they have outgrown. Scoped to one control
 * because a blitz rating and a rapid rating are different numbers about
 * different things — the same rule the rest of the codebase follows.
 */
export function playerRating(
  db: Db,
  scope: { user: string; timeClass: string },
): number | undefined {
  const row = db
    .select({ rating: games.userRating })
    .from(games)
    .where(
      and(
        eq(games.user, scope.user),
        eq(games.timeClass, scope.timeClass),
        // Unrated games carry no number; skipped rather than treated as zero.
        isNotNull(games.userRating),
      ),
    )
    .orderBy(desc(games.endTime))
    .limit(1)
    .get();

  return row?.rating ?? undefined;
}

/**
 * Puzzles to drill one theme, at one player's level.
 *
 * Ordered randomly rather than by rating or popularity. Two visits to the same
 * weakness would otherwise serve the same ten puzzles in the same order until
 * they were exhausted, and the strongest material would all be spent first.
 * `RANDOM()` over an already-filtered set is cheap: the index narrows to one
 * theme inside a 600-point window long before the sort.
 */
export function selectPuzzles(
  db: Db,
  options: {
    user: string;
    theme: string;
    rating?: number;
    limit?: number;
  },
): PracticePuzzle[] {
  const rating = options.rating ?? DEFAULT_RATING;
  const limit = options.limit ?? DEFAULT_LIMIT;

  // This player's history only: a puzzle is stale because THEY have seen it,
  // and another account's practice must not narrow their pool.
  const attempted = db
    .select({ puzzleId: puzzleAttempts.puzzleId })
    .from(puzzleAttempts)
    .where(eq(puzzleAttempts.user, options.user));

  return db
    .select({
      id: puzzles.id,
      fen: puzzles.fen,
      movesUci: puzzles.movesUci,
      rating: puzzles.rating,
      gameUrl: puzzles.gameUrl,
    })
    .from(puzzles)
    .innerJoin(puzzleThemes, eq(puzzleThemes.puzzleId, puzzles.id))
    .where(
      and(
        eq(puzzleThemes.theme, options.theme),
        gte(puzzles.rating, rating - RATING_BAND),
        lte(puzzles.rating, rating + RATING_BAND),
        gte(puzzles.popularity, MIN_POPULARITY),
        notInArray(puzzles.id, attempted),
      ),
    )
    .orderBy(sql`RANDOM()`)
    .limit(limit)
    .all();
}

/**
 * Record how an attempt went.
 *
 * `theme` is the theme the puzzle was SERVED for, not its full tag list: a
 * fork puzzle also tagged `endgame` was drilled as a fork, and counting it
 * under both would credit practice that never happened.
 */
export function recordAttempt(
  db: Db,
  attempt: {
    user: string;
    puzzleId: string;
    solved: boolean;
    theme: string | undefined;
  },
): void {
  db.insert(puzzleAttempts)
    .values({
      user: attempt.user,
      puzzleId: attempt.puzzleId,
      solved: attempt.solved,
      servedForTheme: attempt.theme ?? null,
      attemptedAt: Date.now(),
    })
    .run();
}

/**
 * How this player is doing on one theme.
 *
 * The point of recording attempts at all: a solve rate on `fork` that climbs
 * over weeks is the only evidence that practising it worked.
 */
export function themeProgress(
  db: Db,
  scope: { user: string; theme: string },
): { attempted: number; solved: number } {
  const row = db
    .select({
      attempted: sql<number>`COUNT(*)`,
      solved: sql<number>`SUM(CASE WHEN ${puzzleAttempts.solved} THEN 1 ELSE 0 END)`,
    })
    .from(puzzleAttempts)
    .where(
      and(
        eq(puzzleAttempts.user, scope.user),
        eq(puzzleAttempts.servedForTheme, scope.theme),
      ),
    )
    .get();

  return { attempted: row?.attempted ?? 0, solved: row?.solved ?? 0 };
}
