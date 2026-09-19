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

/** One point on the fitted curve: an accuracy and the rating it maps to. */
export type CurveKnot = {
  accuracy: number;
  rating: number;
};

export type PerformanceCurve = {
  /**
   * The curve itself, as points joined by straight segments, ascending in
   * accuracy and never descending in rating.
   *
   * A single line cannot describe this table. Fitted as one it sat 255 and
   * 279 points below bands 1400-1599 and 1600-1799 while overshooting the
   * top by 373 — error larger than the band quoted around it, in a table
   * that genuinely bends. Joining the band means instead makes the curve
   * exact where it has evidence and honest between those points.
   */
  knots: CurveKnot[];
  /** Rating points per accuracy point, averaged across the whole curve. */
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

/**
 * The top of the rating scale this method can speak to.
 *
 * The same guard as the floor, at the other end. It was load-bearing when
 * the fit was a straight line: that line kept climbing at ~98 rating points
 * per accuracy point while real accuracy saturates against 100%, so the top
 * of its own reference table (94.3%) returned 3,273 and a 99% game returned
 * 3,734 — above anything on chess.com's rapid leaderboard.
 *
 * The fitted curve no longer overshoots, since it holds its end value past
 * the last knot rather than extrapolating a slope. The ceiling stays as a
 * backstop for a reference table that might one day end higher, and to keep
 * the scale's two ends symmetric.
 */
const RATING_CEILING = 2900;

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

  const knots = fitKnots(pairs);

  // Residual spread is what the band is quoted from: it carries the real
  // scatter of players around the curve, which is the thing that matters.
  const residuals = pairs.map(
    ({ accuracy, rating }) => rating - ratingAt(knots, accuracy),
  );
  const residualSd = Math.sqrt(mean(residuals.map((r) => r ** 2)));

  return {
    knots,
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

  const raw = ratingAt(curve.knots, accuracy);
  const centre = clampToScale(raw);
  const halfWidth = Math.max(curve.residualSd, MIN_BAND_HALF_WIDTH);

  // At the edges of the scale the band loses room on one side while keeping
  // its full width on the other, which would render as "~2,900 (2,700-2,900)":
  // 200 points below and none above, understating the error exactly where the
  // curve is least trustworthy. An estimate whose band cannot open both ways
  // is therefore a BOUND, the same as one off the end of the fitted range —
  // `describeEstimate` already has the honest phrasing for that.
  const pinnedHigh = centre + halfWidth > RATING_CEILING;
  const pinnedLow = centre - halfWidth < RATING_FLOOR;

  const below = accuracy < curve.observed.minAccuracy || pinnedLow;
  const above = accuracy > curve.observed.maxAccuracy || pinnedHigh;

  return {
    centre: Math.round(centre),
    low: Math.round(clampToScale(centre - halfWidth)),
    high: Math.round(clampToScale(centre + halfWidth)),
    beyondRange: below || above,
    beyond: above ? "above" : below ? "below" : undefined,
  };
}

/**
 * The curve's knots: one per distinct accuracy, forced to ascend.
 *
 * Observations are pooled by accuracy first, so a band measured on 2,443
 * games and one measured on 17 each contribute a single point rather than
 * the heavier one dragging the curve through itself.
 *
 * Then pool-adjacent-violators. The reference table is NOT monotonic — band
 * 800-999 averages 69.1% against 600-799's 69.2%, and 1400-1599 averages
 * 73.6% against 1200-1399's 74.6% — so joining the means in accuracy order
 * would hand a more accurate game a lower rating than a less accurate one.
 * Where that happens the offending points are merged into their weighted
 * mean, which is the least-squares answer under a monotonicity constraint
 * and says the honest thing: these bands are not distinguishable by accuracy.
 */
function fitKnots(pairs: AccuracyRatingPair[]): CurveKnot[] {
  const byAccuracy = new Map<number, { total: number; count: number }>();
  for (const { accuracy, rating } of pairs) {
    const entry = byAccuracy.get(accuracy) ?? { total: 0, count: 0 };
    entry.total += rating;
    entry.count += 1;
    byAccuracy.set(accuracy, entry);
  }

  const blocks = [...byAccuracy.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([accuracy, { total, count }]) => ({
      from: accuracy,
      to: accuracy,
      rating: total / count,
      weight: count,
    }));

  // Pool adjacent violators: while any block sits below its predecessor,
  // merge the two into their weighted mean and re-check backwards.
  for (let i = 1; i < blocks.length; i += 1) {
    while (i > 0 && blocks[i].rating < blocks[i - 1].rating) {
      const previous = blocks[i - 1];
      const current = blocks[i];
      const weight = previous.weight + current.weight;
      blocks.splice(i - 1, 2, {
        // A merged block spans every accuracy both covered, and all of them
        // map to the pooled rating: the whole claim of the merge is that
        // accuracy cannot tell these players apart, so the curve must be
        // FLAT across the span rather than sloping through it.
        from: previous.from,
        to: current.to,
        rating:
          (previous.rating * previous.weight + current.rating * current.weight) /
          weight,
        weight,
      });
      i -= 1;
    }
  }

  // A pooled block becomes two knots at the same rating, one at each end of
  // its span, which draws the flat segment. A block that never merged has
  // from === to and contributes a single knot.
  return blocks.flatMap(({ from, to, rating }) =>
    from === to
      ? [{ accuracy: from, rating }]
      : [
          { accuracy: from, rating },
          { accuracy: to, rating },
        ],
  );
}

/**
 * The rating at one accuracy, along the segments between knots.
 *
 * Outside the knots the curve holds its end value rather than continuing:
 * extrapolating a segment's slope past the data is what produced -696 and
 * 3,734 in the first place, and `beyondRange` already marks these as bounds.
 */
function ratingAt(knots: CurveKnot[], accuracy: number): number {
  const first = knots[0];
  const last = knots[knots.length - 1];
  if (accuracy <= first.accuracy) return first.rating;
  if (accuracy >= last.accuracy) return last.rating;

  for (let i = 0; i < knots.length - 1; i += 1) {
    const left = knots[i];
    const right = knots[i + 1];
    if (accuracy >= left.accuracy && accuracy <= right.accuracy) {
      const span = right.accuracy - left.accuracy;
      if (span === 0) return right.rating;
      const t = (accuracy - left.accuracy) / span;
      return left.rating + t * (right.rating - left.rating);
    }
  }

  return last.rating;
}

/** Hold a rating inside the scale the reference table can speak to. */
function clampToScale(rating: number): number {
  return Math.min(RATING_CEILING, Math.max(RATING_FLOOR, rating));
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
