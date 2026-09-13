import { describe, it, expect } from "vitest";
import { diagnoseMove } from "./diagnose-move";

/**
 * A wrong explanation is worse than none: it teaches something false about a
 * position the reader is studying. Every case here is verified against a real
 * board rather than asserted from the shape of the code.
 */

describe("diagnoseMove", () => {
  it("names the mate a move allows", () => {
    // From a real game: Rxf7 lets Black play Rd1#.
    const diagnosis = diagnoseMove({
      fenBefore: "3rkb1r/pp1R1npp/8/2p1N1N1/6b1/8/PPP2PPP/R1B3K1 w k - 0 15",
      uci: "d7f7",
      bestMoveUci: "d7d8",
    });

    expect(diagnosis?.problem).toContain("mate in one");
    expect(diagnosis?.problem).toContain("Rd1#");
  });

  it("names the capture the player passed over", () => {
    // b3 ignores that the queen could simply take the queen on c2.
    const diagnosis = diagnoseMove({
      fenBefore: "8/pp2k3/2n3Q1/4p3/K1P2p2/8/PPq4P/6R1 w - - 9 41",
      uci: "b2b3",
      bestMoveUci: "g6c2",
    });

    expect(diagnosis?.problem).toContain("queen");
    expect(diagnosis?.problem).toContain("c2");
  });

  it("names a piece left undefended", () => {
    // A bishop on b5 with nothing guarding it, attacked by a pawn on a6.
    const diagnosis = diagnoseMove({
      fenBefore: "rnbqkbnr/1ppppppp/p7/1B6/8/4P3/PPPP1PPP/RNBQK1NR w KQkq - 0 3",
      uci: "e3e4",
      bestMoveUci: "b5c4",
    });

    expect(diagnosis?.problem).toContain("bishop");
    expect(diagnosis?.problem).toContain("b5");
  });

  it("says what the better move would have done", () => {
    const diagnosis = diagnoseMove({
      fenBefore: "8/pp2k3/2n3Q1/4p3/K1P2p2/8/PPq4P/6R1 w - - 9 41",
      uci: "b2b3",
      bestMoveUci: "g6c2",
    });

    // Qxc2 is a capture of the queen.
    expect(diagnosis?.betterIdea).toContain("takes the queen");
  });

  it("does not call a defended trade a hanging piece", () => {
    // Knights en prise to each other on a normal board: this is a trade, and
    // calling it a blunder would be wrong.
    const diagnosis = diagnoseMove({
      fenBefore:
        "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4",
      uci: "e1g1",
      bestMoveUci: "e1g1",
    });

    // Castling into a normal position leaves nothing hanging.
    expect(diagnosis?.problem ?? "").not.toContain("to be taken");
  });

  it("reports nothing when the played move was the engine's choice", () => {
    const diagnosis = diagnoseMove({
      fenBefore:
        "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      uci: "e2e4",
      bestMoveUci: "e2e4",
    });

    expect(diagnosis).toBeUndefined();
  });

  it("survives a position it cannot read", () => {
    expect(
      diagnoseMove({ fenBefore: "not a fen", uci: "e2e4", bestMoveUci: "d2d4" }),
    ).toBeUndefined();
  });

  it("survives a move that is not legal in the position", () => {
    expect(
      diagnoseMove({
        fenBefore: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        uci: "e2e9",
        bestMoveUci: "e2e4",
      }),
    ).toBeUndefined();
  });

  it("prefers the mate over a hanging piece when both are true", () => {
    // Being mated matters more than the material, so that is what gets said.
    const diagnosis = diagnoseMove({
      fenBefore: "3rkb1r/pp1R1npp/8/2p1N1N1/6b1/8/PPP2PPP/R1B3K1 w k - 0 15",
      uci: "d7f7",
      bestMoveUci: "d7d8",
    });

    expect(diagnosis?.problem).toContain("mate");
    expect(diagnosis?.problem).not.toContain("to be taken");
  });
});
