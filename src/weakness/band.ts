/**
 * Whether the baked-in peer rates describe the player looking at them.
 *
 * `RAPID_600_REFERENCE` was measured on a narrow cohort — 9 rapid players
 * rated 596-682 — and the whole ranking rests on comparing like with like. A
 * 1500-rated player measured against 600-rated peers misses fewer of every
 * tactic than the cohort does, so every excess goes negative and the dashboard
 * reports, confidently and wrongly, that they have no weaknesses.
 *
 * That failure is silent, which is what makes it worth a module: nothing
 * crashes and no number looks odd. The fix is to say so, so this decides when
 * to say it.
 */

/** The cohort the baked-in rates were measured on. */
export const REFERENCE_BAND = {
  timeClass: "rapid",
  min: 596,
  max: 682,
} as const;

/**
 * How far outside the band still counts as the same population.
 *
 * A band edge is not a cliff. Ratings drift week to week and the figure here
 * is an average across a corpus, so treating 683 as a different population
 * from 682 would be false precision. Wide enough to absorb that, narrow enough
 * that a genuinely different strength still trips it.
 */
export const BAND_MARGIN = 100;

export type FitReason =
  | "in-band"
  | "above-band"
  | "below-band"
  | "other-time-class"
  | "unknown-rating";

export type ReferenceFit = {
  /** Whether the baked-in rates are a fair comparison for this player. */
  applies: boolean;
  reason: FitReason;
};

/**
 * Decide whether the reference cohort speaks for this player.
 *
 * Returns a reason either way, because the dashboard's message differs: being
 * above the band overstates nothing and understates everything, while an
 * unknown rating is simply a gap in the data.
 */
export function referenceFit(player: {
  rating: number | undefined;
  timeClass: string;
}): ReferenceFit {
  if (player.timeClass !== REFERENCE_BAND.timeClass) {
    return { applies: false, reason: "other-time-class" };
  }
  if (player.rating === undefined) {
    return { applies: false, reason: "unknown-rating" };
  }
  if (player.rating > REFERENCE_BAND.max + BAND_MARGIN) {
    return { applies: false, reason: "above-band" };
  }
  if (player.rating < REFERENCE_BAND.min - BAND_MARGIN) {
    return { applies: false, reason: "below-band" };
  }
  return { applies: true, reason: "in-band" };
}
