import { describe, it, expect } from "vitest";
import { moveNumber, describeMove } from "./move-notation";

/**
 * Turning a stored ply into the move a chess player would name.
 *
 * The database counts plies — one per move by either side — while people count
 * moves, one per PAIR. Ply 36 is move 18, and it is Black's, so it is written
 * "18...Nc6". Getting the number right but the side wrong points at a real
 * move played by the other player, which is the kind of wrongness that reads
 * as correct.
 */

describe("the move a ply belongs to", () => {
  it("pairs plies into moves", () => {
    expect(moveNumber(1)).toBe(1);
    expect(moveNumber(2)).toBe(1);
    expect(moveNumber(3)).toBe(2);
    expect(moveNumber(36)).toBe(18);
    expect(moveNumber(81)).toBe(41);
  });
});

describe("naming a move", () => {
  it("writes White's move with a single dot", () => {
    // Odd plies are White's: ply 81 is move 41, White.
    expect(describeMove(81, "b3")).toBe("41. b3");
    expect(describeMove(1, "e4")).toBe("1. e4");
  });

  it("writes Black's move with an ellipsis", () => {
    // The bug this exists to stop: "18. Nc6" is White's move 18, a different
    // move by the other player, and often not even legal for White.
    expect(describeMove(36, "Nc6")).toBe("18...Nc6");
    expect(describeMove(2, "e5")).toBe("1...e5");
    expect(describeMove(46, "Bf6")).toBe("23...Bf6");
  });

  it("never labels a Black ply as White's", () => {
    for (const ply of [2, 18, 20, 32, 36, 46]) {
      expect(describeMove(ply, "Xx")).toContain("...");
    }
    for (const ply of [1, 31, 35, 81]) {
      expect(describeMove(ply, "Xx")).not.toContain("...");
    }
  });
});
