import { describe, it, expect } from "vitest";
import { fitCaveat } from "./band-copy";
import { referenceFit } from "./band";

/**
 * The caveat has to reach the empty dashboard, not just the populated one.
 *
 * This is the whole failure mode: a player well above the cohort beats its
 * rate on nearly every tactic, so every excess shrinks toward zero and the
 * ranking comes back EMPTY. Showing the caveat only beside a populated list
 * puts it everywhere except the one place it was written for, where the page
 * otherwise says "nothing costs you more than your own average" — confidently
 * wrong, and silent.
 */

describe("an out-of-band player with an empty ranking", () => {
  it("has a caveat to show, which is what the empty state must render", () => {
    const fit = referenceFit({ rating: 1500, timeClass: "rapid" });
    const caveat = fitCaveat(fit, 1500);

    expect(fit.applies).toBe(false);
    // The empty state has something to say instead of the false reassurance.
    expect(caveat).toBeDefined();
    expect(caveat?.toLowerCase()).toContain("stronger");
  });

  it("says nothing extra for an in-band player, whose empty state is honest", () => {
    // For someone the cohort does describe, "not enough evidence yet" is the
    // true answer and must not be cluttered with a caveat.
    const fit = referenceFit({ rating: 640, timeClass: "rapid" });
    expect(fitCaveat(fit, 640)).toBeUndefined();
  });
});
