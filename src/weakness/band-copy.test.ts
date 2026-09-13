import { describe, it, expect } from "vitest";
import { fitCaveat } from "./band-copy";
import { REFERENCE_BAND } from "./band";

/**
 * What to tell someone whose strength the reference cohort does not cover.
 *
 * The failure being described is silent: a stronger player beats the cohort on
 * every tactic, every excess goes negative, and the dashboard reports that
 * they have no weaknesses. The message has to say the comparison is wrong, not
 * merely that it is approximate.
 */

describe("the cohort caveat", () => {
  it("says nothing to a player the cohort covers", () => {
    expect(fitCaveat({ applies: true, reason: "in-band" }, 640)).toBeUndefined();
  });

  it("warns a stronger player that the ranking understates them", () => {
    const caveat = fitCaveat({ applies: false, reason: "above-band" }, 1500);

    expect(caveat).toBeDefined();
    // Names the player's rating and the band, so the mismatch is checkable.
    expect(caveat).toContain("1500");
    expect(caveat).toContain(String(REFERENCE_BAND.min));
    expect(caveat).toContain(String(REFERENCE_BAND.max));
    // Says which way it is wrong: a stronger player looks better than they are.
    expect(caveat?.toLowerCase()).toContain("stronger");
  });

  it("warns a weaker player that the ranking overstates them", () => {
    const caveat = fitCaveat({ applies: false, reason: "below-band" }, 300);

    expect(caveat).toBeDefined();
    expect(caveat).toContain("300");
    expect(caveat?.toLowerCase()).toContain("weaker");
  });

  it("explains that the cohort is rapid-only for another time control", () => {
    const caveat = fitCaveat({ applies: false, reason: "other-time-class" }, 640);

    expect(caveat).toBeDefined();
    expect(caveat?.toLowerCase()).toContain("rapid");
  });

  it("says the rating is unknown rather than inventing one", () => {
    const caveat = fitCaveat({ applies: false, reason: "unknown-rating" }, undefined);

    expect(caveat).toBeDefined();
    expect(caveat?.toLowerCase()).toContain("rating");
    // Must not print "undefined" at a person.
    expect(caveat).not.toContain("undefined");
  });
});
