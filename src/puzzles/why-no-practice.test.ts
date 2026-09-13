import { describe, it, expect } from "vitest";
import { whyNoPractice } from "./why-no-practice";

/**
 * Why a weakness has no practice link.
 *
 * Two cards on a dashboard carry a "Practise this" link and a third silently
 * does not, which reads as something missing rather than something decided.
 * It is decided: puzzles are tagged by tactical motif, and a weakness about
 * how someone handles their king — or their endgames, or their clock — is a
 * pattern across games rather than a tactic anyone can drill.
 *
 * Saying nothing is the thing being fixed, so every non-drillable dimension
 * has to produce a reason, and a drillable one must produce none.
 */

describe("explaining a missing practice link", () => {
  it("says nothing for a tactic, which has a link instead", () => {
    expect(whyNoPractice({ dimension: "motif", key: "fork" })).toBeUndefined();
  });

  it("explains a piece weakness", () => {
    const why = whyNoPractice({ dimension: "piece", key: "k" });
    expect(why).toBeDefined();
    // Names what it IS, not just what it is not.
    expect(why?.toLowerCase()).toContain("tactic");
  });

  it("explains every other non-drillable dimension", () => {
    for (const dimension of ["phase", "time", "opening", "piece"]) {
      const why = whyNoPractice({ dimension, key: "x" });
      expect(why, dimension).toBeDefined();
      expect(why!.length, dimension).toBeGreaterThan(20);
    }
  });

  it("explains a motif no detector emits, which also has no puzzles", () => {
    // A motif key that is not a real Lichess theme has nothing behind it, so
    // the card is linkless for a different reason and must still say so.
    const why = whyNoPractice({ dimension: "motif", key: "notARealMotif" });
    expect(why).toBeDefined();
  });

  it("gives an unknown dimension a reason rather than falling silent", () => {
    // A dimension added later must not reintroduce the silence this fixes.
    expect(whyNoPractice({ dimension: "somethingNew", key: "x" })).toBeDefined();
  });
});
