/**
 * "You played like a ~1400 player", from one game's accuracy.
 *
 * Read the width of the band before trusting the middle of it. Within a single
 * rating band, players differ in mean accuracy by about 4 percentage points —
 * measured on this project's own corpus, where a 597-rated player averaged
 * 72.9% and a 700-rated one averaged 61.8%. That is real variation between
 * people, not measurement error, so it does NOT shrink by collecting more
 * games or more players. It is the floor on how precise this can ever be.
 *
 * Everything here therefore returns a RANGE. A single number would be read as
 * a rating, and this method cannot support one.
 */

export type AccuracyRatingPair = {
  rating: number;
  /** Whole-game accuracy, 0-100. */
  accuracy: number;
};

export type PerformanceCurve = {
  /** Rating points per accuracy point. */
  slope: number;
  intercept: number;
  /** The accuracy range actually observed, for refusing to extrapolate. */
  observed: { minAccuracy: number; maxAccuracy: number };
  /** Residual spread of the fit, in rating points. */
  residualSd: number;
  samples: number;
};

export type RatingEstimate = {
  centre: number;
  low: number;
  high: number;
  /**
   * True when the accuracy sits outside what the curve was fitted on, so the
   * estimate is a bound rather than a located band.
   */
  beyondRange: boolean;
  /**
   * Which side of the fitted range it fell off, when it did. Above means more
   * accurate than anything sampled, below means less — and the two must not
   * be conflated, since reporting a floor for a very weak game states the
   * opposite of the truth.
   */
  beyond?: "above" | "below";
};

/**
 * Fewer samples than this cannot separate the between-player spread from the
 * slope, and a curve fitted on them would be confident noise.
 */
const MIN_SAMPLES = 20;

/**
 * The fit needs real span in the independent variable. Pairs drawn from one
 * rating band have no slope to find: any line through them is as good as any
 * other, and the one least-squares picks will extrapolate absurdly.
 */
const MIN_RATING_SPAN = 400;

/**
 * Never quote a band tighter than the between-player spread allows.
 *
 * Players within one rating band differ in mean accuracy by about 4
 * percentage points, measured on this project's corpus. At the fitted slope
 * of ~98 rating points per accuracy point that is ~400 rating points of
 * genuine spread between two people who hold the SAME rating.
 *
 * The fit's own residual SD is far smaller (~119) because it is computed
 * against band MEANS, which have already averaged that spread away. Quoting
 * the residual would therefore describe how well the line fits the averages,
 * not how well it locates one player — so the floor below wins in practice,
 * and is the reason this returns a band at all.
 */
const MIN_BAND_HALF_WIDTH = 200;

/**
 * The bottom of the rating scale.
 *
 * A linear fit run below the accuracies it was trained on happily returns a
 * negative rating — 55% accuracy produced -696 — which is not a number anyone
 * can hold. Clamped rather than rejected: "at the floor" is the right answer
 * for a very inaccurate game, and `beyondRange` already says the estimate is
 * extrapolated.
 */
const RATING_FLOOR = 100;

export function fitPerformanceCurve(
  pairs: AccuracyRatingPair[],
): PerformanceCurve | undefined {
  if (pairs.length < MIN_SAMPLES) return undefined;

  const ratings = pairs.map((p) => p.rating);
  if (Math.max(...ratings) - Math.min(...ratings) < MIN_RATING_SPAN) {
    return undefined;
  }

  // Rating regressed ON accuracy, which is the direction it is used in.
  const accuracies = pairs.map((p) => p.accuracy);
  const meanAcc = mean(accuracies);
  const meanRating = mean(ratings);

  let covariance = 0;
  let variance = 0;
  for (const { accuracy, rating } of pairs) {
    covariance += (accuracy - meanAcc) * (rating - meanRating);
    variance += (accuracy - meanAcc) ** 2;
  }
  if (variance === 0) return undefined;

  const slope = covariance / variance;
  const intercept = meanRating - slope * meanAcc;

  // Residual spread is what the band is quoted from: it carries the real
  // scatter of players around the line, which is the thing that matters.
  const residuals = pairs.map(
    ({ accuracy, rating }) => rating - (intercept + slope * accuracy),
  );
  const residualSd = Math.sqrt(mean(residuals.map((r) => r ** 2)));

  return {
    slope,
    intercept,
    observed: {
      minAccuracy: Math.min(...accuracies),
      maxAccuracy: Math.max(...accuracies),
    },
    residualSd,
    samples: pairs.length,
  };
}

export function estimateRating(
  curve: PerformanceCurve | undefined,
  accuracy: number,
): RatingEstimate | undefined {
  if (!curve) return undefined;
  // A game chess.com never reviewed carries no accuracy. Arithmetic on that
  // yields a NaN band that renders as "~NaN" rather than as nothing.
  if (!Number.isFinite(accuracy)) return undefined;

  const centre = Math.max(
    RATING_FLOOR,
    curve.intercept + curve.slope * accuracy,
  );
  const halfWidth = Math.max(curve.residualSd, MIN_BAND_HALF_WIDTH);

  const below = accuracy < curve.observed.minAccuracy;
  const above = accuracy > curve.observed.maxAccuracy;

  return {
    centre: Math.round(centre),
    low: Math.round(Math.max(RATING_FLOOR, centre - halfWidth)),
    high: Math.round(centre + halfWidth),
    beyondRange: below || above,
    beyond: above ? "above" : below ? "below" : undefined,
  };
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * The estimate as a phrase, range included.
 *
 * The range is not decoration. A centre on its own reads as "your rating is
 * 1284", and this method cannot support that claim for any individual — two
 * players at the same rating routinely differ by more than the whole band.
 * So the range travels with the number wherever it is shown, and there is no
 * accessor here that returns the centre alone.
 */
export function describeEstimate(
  estimate: RatingEstimate | undefined,
): string | undefined {
  if (!estimate) return undefined;

  // Past the fitted range there is no located band, only a floor: saying
  // "~3342" from an accuracy nothing in the cohort reached would invent a
  // precision the data never had.
  if (estimate.beyondRange) {
    return estimate.beyond === "below"
      ? `below ${estimate.high.toLocaleString()}`
      : `above ${estimate.low.toLocaleString()}`;
  }

  return `~${estimate.centre.toLocaleString()} (${estimate.low.toLocaleString()}–${estimate.high.toLocaleString()})`;
}

/**
 * The estimate split into a headline and a qualifier, for a two-line figure.
 *
 * Exists so a panel can size the centre and the range differently without
 * either being dropped. `describeEstimate` remains the one-line form; both
 * carry the range, because neither is allowed to present the centre alone.
 */
export function splitEstimate(
  estimate: RatingEstimate | undefined,
): { centre: string; range: string } | undefined {
  if (!estimate) return undefined;

  if (estimate.beyondRange) {
    return {
      centre: describeEstimate(estimate)!,
      range: "beyond the measured range",
    };
  }

  return {
    centre: `~${estimate.centre.toLocaleString()}`,
    range: `${estimate.low.toLocaleString()}–${estimate.high.toLocaleString()}`,
  };
}
