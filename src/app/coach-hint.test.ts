import { describe, it, expect } from "vitest";
import { shouldOfferCoaching, DISMISSED_KEY } from "./coach-hint";

/**
 * When to mention that coaching exists.
 *
 * Someone with no API key currently sees nothing at all — both coaching
 * components render null — so the feature is invisible to exactly the people
 * who have not opted into it. One line, once, is the whole intervention: this
 * is a dashboard people open daily, and a permanent advertisement on it would
 * be worse than saying nothing.
 */

describe("offering coaching", () => {
  it("offers it when a ranking rendered without any coaching", () => {
    expect(
      shouldOfferCoaching({
        status: "unavailable",
        hasWeaknesses: true,
        dismissed: false,
      }),
    ).toBe(true);
  });

  it("says nothing while the request is still in flight", () => {
    // Otherwise the hint flashes up on every load before the answer lands,
    // including for people who already have a key.
    expect(
      shouldOfferCoaching({
        status: "loading",
        hasWeaknesses: true,
        dismissed: false,
      }),
    ).toBe(false);
  });

  it("says nothing when coaching is working", () => {
    expect(
      shouldOfferCoaching({
        status: "ready",
        hasWeaknesses: true,
        dismissed: false,
      }),
    ).toBe(false);
  });

  it("says nothing on an empty dashboard", () => {
    // Nothing has been ranked yet, so there is nothing coaching would explain.
    // Offering it here asks someone to pay for prose about no findings.
    expect(
      shouldOfferCoaching({
        status: "unavailable",
        hasWeaknesses: false,
        dismissed: false,
      }),
    ).toBe(false);
  });

  it("stays dismissed once dismissed", () => {
    expect(
      shouldOfferCoaching({
        status: "unavailable",
        hasWeaknesses: true,
        dismissed: true,
      }),
    ).toBe(false);
  });

  it("names the storage key it remembers the dismissal under", () => {
    expect(DISMISSED_KEY).toBe("chess-retro.coach-hint-dismissed");
  });
});
