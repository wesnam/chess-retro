import { and, desc, eq, isNotNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { games } from "@/db/schema";

/**
 * The player's current strength, for choosing who to compare them against.
 *
 * Deliberately "what are they now" rather than a career average: someone who
 * has climbed from 600 to 1200 should be ranked against 1200-rated peers, and
 * averaging their whole history would pick a cohort they have outgrown. The
 * window is recent games in the time control being displayed.
 *
 * Averaged rather than taken from the latest game, because a single rating is
 * noisy — one game's result moves it, and a cohort should not turn on that.
 */

/**
 * How many recent games set the rating.
 *
 * Enough to average out a bad evening, few enough that it tracks a climb.
 */
export const RATING_WINDOW = 40;

export function typicalRating(
  db: Db,
  scope: { user: string; timeClass: string },
): number | undefined {
  const recent = db
    .select({ rating: games.userRating })
    .from(games)
    .where(
      and(
        eq(games.user, scope.user),
        eq(games.timeClass, scope.timeClass),
        // An unrated game says nothing about strength: the rating attached to
        // it did not move and was not earned, so averaging it in picks a
        // cohort on the strength of a number that measured nothing.
        eq(games.rated, true),
        isNotNull(games.userRating),
      ),
    )
    .orderBy(desc(games.endTime))
    .limit(RATING_WINDOW)
    .all();

  // Narrowed here rather than trusted from the query: `IS NOT NULL` makes the
  // nulls unreachable, but a `?? 0` fallback would encode a wrong answer as a
  // default if that filter ever changed — an average silently dragged toward
  // zero picks a cohort nobody belongs to.
  const ratings = recent
    .map((row) => row.rating)
    .filter((rating): rating is number => rating !== null);

  if (ratings.length === 0) return undefined;

  const total = ratings.reduce((sum, rating) => sum + rating, 0);
  return Math.round(total / ratings.length);
}
