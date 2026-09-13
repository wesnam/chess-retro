import { describe, it, expect } from "vitest";
import { CLASSIFICATION_LEGEND, explainMove, formatUci } from "./explain-move";
import type { MoveRow } from "./queries";

function move(over: Partial<MoveRow> = {}): MoveRow {
  return {
    ply: 10,
    color: "w",
    san: "Nf3",
    uci: "g1f3",
    fenBefore: "startpos",
    isUserMove: true,
    evalBefore: 20,
    evalAfter: 10,
    mateBefore: null,
    mateAfter: null,
    bestMoveUci: "e2e4",
    cpLoss: 10,
    winPctBefore: 55,
    winPctAfter: 50,
    moveAccuracy: 90,
    classification: "inaccuracy",
    clockMs: 60_000,
    moveTimeMs: 3_000,
    ...over,
  };
}

describe("explainMove", () => {
  it("says the engine agreed, for a best move", () => {
    const explained = explainMove(move({ classification: "best", uci: "e2e4" }));
    expect(explained?.name).toBe("Best move");
    expect(explained?.betterMove).toBeUndefined();
  });

  it("names the move the engine preferred", () => {
    const explained = explainMove(move({ uci: "g1f3", bestMoveUci: "e2e4" }));
    expect(explained?.betterMove).toBe("e2e4");
  });

  it("does not offer a better move when the player found it", () => {
    const explained = explainMove(move({ uci: "e2e4", bestMoveUci: "e2e4" }));
    expect(explained?.betterMove).toBeUndefined();
  });

  it("quantifies the cost in win probability, not centipawns", () => {
    // The classification keys on win probability, so the explanation must
    // speak the same units or it describes a different judgement.
    const explained = explainMove(
      move({ winPctBefore: 70, winPctAfter: 40, classification: "blunder" }),
    );
    expect(explained?.why).toContain("30.0 points of win probability");
  });

  it("describes the swing in words when the assessment changed", () => {
    const explained = explainMove(
      move({ winPctBefore: 90, winPctAfter: 50, classification: "blunder" }),
    );
    expect(explained?.why).toContain("winning");
    expect(explained?.why).toContain("level");
  });

  it("omits a swing when the assessment did not change", () => {
    // A three-point drop inside "winning" is not a story worth telling.
    const explained = explainMove(
      move({ winPctBefore: 95, winPctAfter: 90, classification: "good" }),
    );
    expect(explained?.why).not.toContain("→");
  });

  it("never reports a negative cost", () => {
    // The engine can rate a position better after a move than before.
    const explained = explainMove(
      move({ winPctBefore: 40, winPctAfter: 60, classification: "excellent" }),
    );
    expect(explained?.why).toContain("0.0 points");
  });

  it("handles a move with no evaluation stored", () => {
    const explained = explainMove(
      move({ winPctBefore: null, winPctAfter: null }),
    );
    expect(explained?.why).toContain("No evaluation");
  });

  it("returns nothing for an unclassified move", () => {
    expect(explainMove(move({ classification: null }))).toBeUndefined();
  });
});

describe("CLASSIFICATION_LEGEND", () => {
  it("covers every mark the scoresheet can show", () => {
    const keys = CLASSIFICATION_LEGEND.map((entry) => entry.key);
    expect(keys).toEqual([
      "best",
      "excellent",
      "good",
      "inaccuracy",
      "mistake",
      "blunder",
    ]);
  });

  it("gives every entry a meaning, so the legend explains rather than lists", () => {
    for (const entry of CLASSIFICATION_LEGEND) {
      expect(entry.meaning.length).toBeGreaterThan(10);
    }
  });
});

describe("formatUci", () => {
  it("renders a move as from-to", () => {
    expect(formatUci("e2e4")).toBe("e2-e4");
  });

  it("marks a promotion", () => {
    expect(formatUci("a7a8q")).toBe("a7-a8=Q");
  });

  it("leaves something it cannot read alone", () => {
    expect(formatUci("??")).toBe("??");
  });
});
