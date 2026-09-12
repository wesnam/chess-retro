import { describe, it, expect } from "vitest";
import { phaseOf } from "./phase";

/**
 * Phase is derived from the position, not from the move number: a queenless
 * middlegame reached on move 12 is an endgame, and a full board on move 40 is
 * not. Move-number cutoffs would mislabel both.
 */

describe("phaseOf", () => {
  it("calls the starting position the opening", () => {
    const start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    expect(phaseOf(start)).toBe("opening");
  });

  it("calls a bare king-and-pawn position the endgame", () => {
    expect(phaseOf("8/5k2/8/8/3P4/8/5K2/8 w - - 0 50")).toBe("endgame");
  });

  it("calls a full-material middle position the middlegame", () => {
    // Developed, everything still on, no longer in the opening.
    const fen = "r1bq1rk1/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQ1RK1 w - - 8 8";
    expect(phaseOf(fen)).toBe("middlegame");
  });

  it("calls a queenless position with little material an endgame", () => {
    // Both queens traded and few pieces left: an endgame regardless of how
    // early it arrived.
    expect(phaseOf("4k3/5ppp/8/8/8/8/5PPP/4K2R w K - 0 20")).toBe("endgame");
  });

  it("does not call a queenless position with heavy material an endgame", () => {
    // Queens off but rooks, bishops and knights all still present — this is
    // still a middlegame, and calling it an endgame would misattribute every
    // error in it.
    const fen = "r1b1k2r/pppp1ppp/2n2n2/4p3/2B1P3/2N2N2/PPPP1PPP/R1B1K2R w KQkq - 0 10";
    expect(phaseOf(fen)).toBe("middlegame");
  });

  it("returns undefined for a position it cannot read", () => {
    // An unreadable FEN must not silently become "opening" and skew the
    // phase dimension.
    expect(phaseOf("not a fen")).toBeUndefined();
  });
});
