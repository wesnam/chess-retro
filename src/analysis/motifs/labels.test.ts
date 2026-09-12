import { describe, it, expect } from "vitest";
import { missedSummary, motifLabel } from "./labels";

describe("motifLabel", () => {
  it("renders a camelCase theme as words", () => {
    expect(motifLabel("backRankMate")).toBe("back-rank mate");
    expect(motifLabel("discoveredAttack")).toBe("discovered attack");
  });

  it("passes an unknown theme through rather than hiding it", () => {
    expect(motifLabel("somethingNew")).toBe("somethingNew");
  });
});

describe("missedSummary", () => {
  it("reads naturally for one tactic", () => {
    expect(missedSummary(["fork"])).toBe("missed a fork");
  });

  it("joins two tactics", () => {
    expect(missedSummary(["fork", "pin"])).toBe("missed a fork and a pin");
  });

  it("joins three tactics", () => {
    expect(missedSummary(["fork", "pin", "skewer"])).toBe(
      "missed a fork, a pin and a skewer",
    );
  });

  it("says nothing when there is nothing to say", () => {
    expect(missedSummary([])).toBe("");
  });
});
