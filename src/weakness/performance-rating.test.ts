import { describe, it, expect } from "vitest";
import {
  fitPerformanceCurve,
  estimateRating,
  describeEstimate,
  splitEstimate,
  type AccuracyRatingPair,
} from "./performance-rating";
import {
  referencePairs,
  RAPID_ACCURACY_BY_BAND,
} from "./performance-reference";

/**
 * Turning one game's accuracy into "you played like a ~1400 player".
 *
 * The estimate is deliberately coarse. Within a single rating band, players
 * differ in accuracy by about 4 points on average, which is real variation
 * between people rather than measurement noise — so no amount of data makes
 * this precise. The interface therefore returns a BAND, never a number
 * pretending to be someone's rating.
 */

/** A monotone sample: accuracy rising with rating, as the real curve does. */
function sample(): AccuracyRatingPair[] {
  const pairs: AccuracyRatingPair[] = [];
  for (const [rating, accuracy] of [
    [400, 62],
    [800, 70],
    [1200, 76],
    [1600, 82],
    [2000, 87],
    [2400, 91],
  ] as const) {
    // Several observations per band, so a fit has something to average.
    for (let i = 0; i < 20; i += 1) {
      pairs.push({ rating, accuracy: accuracy + (i % 5) - 2 });
    }
  }
  return pairs;
}

describe("fitting the accuracy curve", () => {
  it("places a mid-range accuracy inside the band it was sampled from", () => {
    const curve = fitPerformanceCurve(sample());
    const estimate = estimateRating(curve, 76);

    // 76% was sampled at 1200. The estimate must contain it.
    expect(estimate).toBeDefined();
    expect(estimate!.low).toBeLessThanOrEqual(1200);
    expect(estimate!.high).toBeGreaterThanOrEqual(1200);
  });

  it("ranks a more accurate game higher than a less accurate one", () => {
    const curve = fitPerformanceCurve(sample());

    const weak = estimateRating(curve, 65)!;
    const strong = estimateRating(curve, 88)!;

    expect(strong.centre).toBeGreaterThan(weak.centre);
  });

  it("reports a band wide enough to be honest about its own error", () => {
    // Between-player spread within one band is ~4 accuracy points, which at
    // any plausible slope is hundreds of rating points. An estimate quoted
    // tighter than that would be false precision.
    const curve = fitPerformanceCurve(sample());
    const estimate = estimateRating(curve, 76)!;

    expect(estimate.high - estimate.low).toBeGreaterThanOrEqual(200);
  });

  it("refuses to fit when the samples span too little of the rating range", () => {
    // Every pair from one band cannot establish a slope. Returning a curve
    // here would extrapolate wildly from noise.
    const narrow: AccuracyRatingPair[] = Array.from({ length: 50 }, (_, i) => ({
      rating: 600 + (i % 40),
      accuracy: 66 + (i % 7),
    }));

    expect(fitPerformanceCurve(narrow)).toBeUndefined();
  });

  it("refuses to fit from too few samples", () => {
    expect(fitPerformanceCurve(sample().slice(0, 3))).toBeUndefined();
  });

  it("does not extrapolate beyond the range it was fitted on", () => {
    // An accuracy far above anything sampled says "better than the top of
    // what we measured", not a specific superhuman rating.
    const curve = fitPerformanceCurve(sample());
    const estimate = estimateRating(curve, 99.5);

    expect(estimate).toBeDefined();
    expect(estimate!.beyondRange).toBe(true);
  });

  it("stays inside the sampled range for an ordinary accuracy", () => {
    const curve = fitPerformanceCurve(sample());
    expect(estimateRating(curve, 76)!.beyondRange).toBe(false);
  });
});

/**
 * What the real fitted curve must not do.
 *
 * These come from running the actual reference table through the fit, where
 * a low accuracy produced a NEGATIVE rating and the quoted band was ±119 —
 * tighter than the between-player spread can justify.
 */
describe("bounds on a real fit", () => {
  it("never estimates a rating below the floor of the scale", () => {
    // 55% accuracy fitted to -696, which is not a rating anyone can hold.
    const curve = fitPerformanceCurve(sample())!;
    const estimate = estimateRating(curve, 20)!;

    expect(estimate.low).toBeGreaterThanOrEqual(100);
    expect(estimate.centre).toBeGreaterThanOrEqual(100);
  });

  it("quotes a band no tighter than the between-player spread allows", () => {
    // Players in one band differ by ~4 accuracy points, which at ~98 rating
    // points per accuracy point is ~400 rating points of genuine spread.
    // A ±119 band would claim precision this method does not have.
    const curve = fitPerformanceCurve(sample())!;
    const estimate = estimateRating(curve, 76)!;

    expect(estimate.high - estimate.low).toBeGreaterThanOrEqual(400);
  });
});

/**
 * Presenting the estimate.
 *
 * The label is the whole safety mechanism here: a centre shown alone reads as
 * a rating, which this method cannot support. Every rendering must carry the
 * range.
 */
describe("describing an estimate", () => {
  it("quotes the range alongside the centre", () => {
    const curve = fitPerformanceCurve(sample())!;
    const text = describeEstimate(estimateRating(curve, 76));

    expect(text).toMatch(/\d+/);
    // Both ends present, not just the middle.
    const numbers = text!.match(/\d+/g)!.map(Number);
    expect(numbers.length).toBeGreaterThanOrEqual(3);
  });

  it("says nothing at all when there is no estimate", () => {
    // An unanalysed game must not render a blank band that looks like zero.
    expect(describeEstimate(undefined)).toBeUndefined();
  });

  it("marks an estimate above the fitted range as a floor", () => {
    const curve = fitPerformanceCurve(sample())!;
    const beyond = describeEstimate(estimateRating(curve, 99.5))!;

    expect(beyond.toLowerCase()).toContain("above");
  });

  it("marks an estimate below the fitted range as a ceiling", () => {
    // An accuracy below anything sampled means "weaker than the bottom of
    // what we measured". Calling that "above 100" states the opposite.
    const curve = fitPerformanceCurve(sample())!;
    const beyond = describeEstimate(estimateRating(curve, 20))!;

    expect(beyond.toLowerCase()).toContain("below");
    expect(beyond.toLowerCase()).not.toContain("above");
  });
});

describe("missing input", () => {
  it("has no estimate when the accuracy is not a number", () => {
    // A game chess.com never reviewed has no accuracy. That must read as
    // "no estimate", not as a band computed from NaN.
    const curve = fitPerformanceCurve(sample())!;

    expect(estimateRating(curve, Number.NaN)).toBeUndefined();
    expect(describeEstimate(estimateRating(curve, Number.NaN))).toBeUndefined();
  });
});

describe("splitting the estimate for display", () => {
  it("separates the centre from the range without dropping either", () => {
    const curve = fitPerformanceCurve(sample())!;
    const parts = splitEstimate(estimateRating(curve, 76))!;

    expect(parts.centre).toMatch(/\d/);
    expect(parts.range).toMatch(/\d+.*\d+/);
  });

  it("gives a bound no centre to quote on its own", () => {
    // "above 3,142" has no middle; rendering one would invent it.
    const curve = fitPerformanceCurve(sample())!;
    const parts = splitEstimate(estimateRating(curve, 99.5))!;

    expect(parts.centre.toLowerCase()).toContain("above");
    expect(parts.range).toBe("beyond the measured range");
  });
});

/**
 * The top of the scale.
 *
 * Symmetric with the floor, and for the same reason. The fit is a straight
 * line through a table whose mass sits at the bottom — 3,881 of its 5,002
 * observations are rated under 800 — so it keeps climbing at ~98 rating
 * points per accuracy point long after real accuracy has started to saturate
 * against 100%. Run at the top of its OWN reference table it returns 3,273,
 * which is above anything on chess.com's rapid leaderboard.
 */
describe("the ceiling of the scale", () => {
  it("never estimates a rating above the top of the reference table", () => {
    // 94.3% is the most accurate band mean in the real table, at 2900.
    // Unclamped the line puts it at 3,273 — a rating nobody holds.
    const curve = fitPerformanceCurve(referencePairs())!;
    const estimate = estimateRating(curve, 94.3)!;

    expect(estimate.centre).toBeLessThanOrEqual(2900);
  });

  it("holds the ceiling for an accuracy beyond the table entirely", () => {
    // A 99% game is still a game between two humans on a rating scale.
    const curve = fitPerformanceCurve(referencePairs())!;
    const estimate = estimateRating(curve, 99)!;

    expect(estimate.centre).toBeLessThanOrEqual(2900);
    expect(estimate.low).toBeLessThanOrEqual(2900);
  });

  it("still ranks a stronger game at or above a weaker one at the top", () => {
    // Clamping must not invert the order it was protecting.
    const curve = fitPerformanceCurve(referencePairs())!;

    const strong = estimateRating(curve, 91.8)!;
    const stronger = estimateRating(curve, 94.3)!;

    expect(stronger.centre).toBeGreaterThanOrEqual(strong.centre);
  });
});

/**
 * A clamped estimate must not pose as a located one.
 *
 * The ceiling pins `centre` and `high` to the same number, which leaves a
 * band 200 points wide below and nothing above. Read literally that says
 * "somewhere between 2,700 and 2,900, and certainly no higher" — a claim
 * this curve cannot make at the top, where the reference table says it
 * OVERSTATES by up to +373. The range is the module's whole safety
 * mechanism; a lopsided one understates the error exactly where it is
 * largest, so a pinned estimate has to read as a bound instead.
 */
describe("an estimate pinned to the ceiling", () => {
  it("locates a band at the top band's own mean, which the curve now reaches", () => {
    // 91.8% is band 2600-2799's mean. The straight line overshot it to 3028
    // and had to be clamped, which produced a lopsided band; the fitted
    // curve lands on 2700 exactly, so this is an ordinary located estimate
    // and must NOT be downgraded to a bound.
    const curve = fitPerformanceCurve(referencePairs())!;
    const estimate = estimateRating(curve, 91.8)!;

    expect(estimate.centre).toBe(2700);
    expect(estimate.beyondRange).toBe(false);
  });

  it("reports as a bound at the very top of the fitted table", () => {
    // 94.3% is exactly `observed.maxAccuracy`, so a strict `>` misses it —
    // and it is the single most overstating point on the whole curve.
    const curve = fitPerformanceCurve(referencePairs())!;
    const estimate = estimateRating(curve, 94.3)!;

    expect(estimate.beyondRange).toBe(true);
  });

  it("never quotes a band with room on one side only", () => {
    // Anywhere the centre is pinned, `high` equals it. Such an estimate may
    // be phrased as a bound, but never as "~X (low–high)".
    const curve = fitPerformanceCurve(referencePairs())!;

    for (const accuracy of [90.5, 91.8, 93, 94.3, 97]) {
      const estimate = estimateRating(curve, accuracy)!;
      const lopsided =
        estimate.high === estimate.centre || estimate.low === estimate.centre;
      if (lopsided) {
        expect(estimate.beyondRange).toBe(true);
      }
    }
  });

  it("still locates a band below the clamp, where the fit is honest", () => {
    // The fix must not swallow ordinary strong games into a bound.
    const curve = fitPerformanceCurve(referencePairs())!;
    const estimate = estimateRating(curve, 86.5)!;

    expect(estimate.beyondRange).toBe(false);
    expect(estimate.high).toBeGreaterThan(estimate.centre);
    expect(estimate.low).toBeLessThan(estimate.centre);
  });
});

/**
 * The curve has to follow the table it was fitted on.
 *
 * A straight line cannot. Fed each band's own mean accuracy it returned 1245
 * for band 1400-1599 and 1421 for 1600-1799 — 255 and 279 points BELOW the
 * band those players actually hold — while overshooting the top by +373.
 * That error is structural, not noise: it is the line failing to bend, and
 * it is larger than the +/-200 band quoted around it, so the true value fell
 * outside the range shown. An estimate is allowed to be vague; it is not
 * allowed to be confidently wrong.
 */
describe("following the reference table", () => {
  it("places every band within its own quoted range", () => {
    // The strongest statement of the requirement: feed the curve a band's
    // mean accuracy and the band it came from must lie inside the answer.
    const curve = fitPerformanceCurve(referencePairs())!;

    for (const { band, meanAccuracy } of RAPID_ACCURACY_BY_BAND) {
      const estimate = estimateRating(curve, meanAccuracy)!;
      const centreOfBand = band + 100;

      expect(estimate.low).toBeLessThanOrEqual(centreOfBand);
      expect(estimate.high).toBeGreaterThanOrEqual(centreOfBand);
    }
  });

  it("lands near the band centre, not merely inside the range", () => {
    // 1400-1899 is where the line was worst and where most games land. The
    // line missed these by 243-279 points; a curve that follows the table
    // should be an order of magnitude closer.
    //
    // Band 1400-1599 is excluded deliberately: its mean accuracy (73.6%) is
    // LOWER than band 1200-1399's (74.6%), so the two are pooled and neither
    // can be placed on its own centre. That is the data declining to
    // separate them, and `never rates a more accurate game below a less
    // accurate one` is the test that pins the pooling.
    const curve = fitPerformanceCurve(referencePairs())!;

    for (const band of [1600, 1800]) {
      const row = RAPID_ACCURACY_BY_BAND.find((r) => r.band === band)!;
      const estimate = estimateRating(curve, row.meanAccuracy)!;

      expect(Math.abs(estimate.centre - (band + 100))).toBeLessThanOrEqual(30);
    }
  });

  it("places a pooled band inside its range even when it cannot centre it", () => {
    // 1200-1399 and 1400-1599 invert, so both sit at their shared value.
    // Neither is centred, but neither may fall outside the quoted range —
    // being vague is allowed, being confidently wrong is not.
    const curve = fitPerformanceCurve(referencePairs())!;

    for (const band of [1200, 1400]) {
      const row = RAPID_ACCURACY_BY_BAND.find((r) => r.band === band)!;
      const estimate = estimateRating(curve, row.meanAccuracy)!;

      expect(estimate.low).toBeLessThanOrEqual(band + 100);
      expect(estimate.high).toBeGreaterThanOrEqual(band + 100);
    }
  });

  it("never rates a more accurate game below a less accurate one", () => {
    // Two band pairs in the table inverted — 700/900 at 69.2/69.1 and
    // 1300/1500 at 74.6/73.6 — so interpolating the raw means would make a
    // better game score worse. The curve must be monotonic regardless.
    const curve = fitPerformanceCurve(referencePairs())!;

    let previous = -Infinity;
    for (let accuracy = 60; accuracy <= 96; accuracy += 0.1) {
      const { centre } = estimateRating(curve, accuracy)!;
      expect(centre).toBeGreaterThanOrEqual(previous);
      previous = centre;
    }
  });
});
