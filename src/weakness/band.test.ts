import { describe, it, expect } from "vitest";
import { REFERENCE_BAND, referenceFit } from "./band";

/**
 * Whether the baked-in peer rates describe this player at all.
 *
 * The cohort is a narrow one — rapid, 596-682 — and the ranking is only
 * meaningful against players of similar strength. Someone far outside that
 * range is being measured against the wrong population, and the dashboard has
 * to say so rather than quietly reporting that they are excellent at chess.
 */

describe("fit against the reference cohort", () => {
  it("fits a player inside the band", () => {
    const fit = referenceFit({ rating: 640, timeClass: "rapid" });
    expect(fit.applies).toBe(true);
    expect(fit.reason).toBe("in-band");
  });

  it("fits at the exact edges, which are inclusive", () => {
    expect(referenceFit({ rating: REFERENCE_BAND.min, timeClass: "rapid" }).applies).toBe(true);
    expect(referenceFit({ rating: REFERENCE_BAND.max, timeClass: "rapid" }).applies).toBe(true);
  });

  it("tolerates a margin either side, since a band edge is not a cliff", () => {
    // Ratings drift and a game-average is not a precise number; treating 683
    // as a different population from 682 would be false precision.
    expect(referenceFit({ rating: 700, timeClass: "rapid" }).applies).toBe(true);
    expect(referenceFit({ rating: 580, timeClass: "rapid" }).applies).toBe(true);
  });

  it("does not fit a player well above the band", () => {
    const fit = referenceFit({ rating: 1500, timeClass: "rapid" });
    expect(fit.applies).toBe(false);
    expect(fit.reason).toBe("above-band");
  });

  it("does not fit a player well below the band", () => {
    const fit = referenceFit({ rating: 300, timeClass: "rapid" });
    expect(fit.applies).toBe(false);
    expect(fit.reason).toBe("below-band");
  });

  it("does not fit another time control, however close the rating", () => {
    // A blitz 640 is not a rapid 640: the cohort was measured on rapid games
    // only, and blunder rates differ by time control — which is exactly why
    // time class is a filter and never an aggregation axis.
    const fit = referenceFit({ rating: 640, timeClass: "blitz" });
    expect(fit.applies).toBe(false);
    expect(fit.reason).toBe("other-time-class");
  });

  it("says so when the rating is unknown rather than guessing", () => {
    const fit = referenceFit({ rating: undefined, timeClass: "rapid" });
    expect(fit.applies).toBe(false);
    expect(fit.reason).toBe("unknown-rating");
  });
});
