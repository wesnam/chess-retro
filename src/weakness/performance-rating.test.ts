import { describe, it, expect } from "vitest";
import {
  fitPerformanceCurve,
  estimateRating,
  describeEstimate,
  splitEstimate,
  type AccuracyRatingPair,
} from "./performance-rating";

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
