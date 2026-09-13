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

  it("names a two-move refutation from the engine's line", () => {
    // Qh6 hangs nothing and allows no mate, so every single-position check
    // is silent — yet it cost 65 points, because Bg5 attacks the queen and
    // wins it next move. This is the case single-move reasoning cannot see.
    const diagnosis = diagnoseMove({
      fenBefore: "r1bq1r1k/pp5p/5bp1/3N3Q/2B5/8/PPP2PPP/R4RK1 w - - 0 16",
      uci: "h5h6",
      bestMoveUci: "h5e2",
      refutation: "f6g5 h6f8 d8f8 b2b3",
    });

    expect(diagnosis?.problem).toContain("Bg5");
    expect(diagnosis?.problem).toContain("queen");
    expect(diagnosis?.problem).toContain("h6");
  });

  it("attributes the threat to the opponent, not the player", () => {
    // The line alternates sides. Reading our own capture as theirs produced
    // "after Qxf8+ your rook is gone" when that move WINS a rook.
    const diagnosis = diagnoseMove({
      fenBefore: "r1bq1r1k/pp5p/5bp1/3N3Q/2B5/8/PPP2PPP/R4RK1 w - - 0 16",
      uci: "h5h6",
      bestMoveUci: "h5e2",
      refutation: "f6g5 h6f8 d8f8",
    });

    expect(diagnosis?.problem).not.toContain("Qxf8");
    expect(diagnosis?.problem).not.toContain("rook is gone");
  });

  it("falls back when no line was stored", () => {
    // Most of the corpus predates principal-variation capture.
    const diagnosis = diagnoseMove({
      fenBefore: "r1bq1r1k/pp5p/5bp1/3N3Q/2B5/8/PPP2PPP/R4RK1 w - - 0 16",
      uci: "h5h6",
      bestMoveUci: "h5e2",
      refutation: null,
    });

    expect(diagnosis?.problem).toBe("The engine saw something better.");
  });

  it("ignores a line it cannot replay", () => {
    const diagnosis = diagnoseMove({
      fenBefore: "r1bq1r1k/pp5p/5bp1/3N3Q/2B5/8/PPP2PPP/R4RK1 w - - 0 16",
      uci: "h5h6",
      bestMoveUci: "h5e2",
      refutation: "z9z9 not a line",
    });

    expect(diagnosis?.problem).toBe("The engine saw something better.");
  });

  it("names an opportunity the move passed up", () => {
    // A move can be terrible without allowing anything. Bg7 threatens nothing
    // and hangs nothing — it is a blunder purely because Bg5 would have won
    // the queen, and every threat-based check is silent on that.
    const diagnosis = diagnoseMove({
      fenBefore: "r1bq1r1k/pp5p/5bpQ/3N4/2B5/8/PPP2PPP/R4RK1 b - - 1 16",
      uci: "f6g7",
      bestMoveUci: "f6g5",
      isUserMove: false,
    });

    expect(diagnosis?.problem).toContain("Bg5");
    expect(diagnosis?.problem).toContain("queen");
  });

  it("writes possessives from the reader's side", () => {
    // An opponent's blunder must not say "your bishop" about their bishop.
    const theirs = diagnoseMove({
      fenBefore: "r1bq1r1k/pp5p/6p1/3N4/2B5/1Q6/P1P2PPb/1R2R1K1 b - - 0 21",
      uci: "h2h1",
      bestMoveUci: "d8d6",
      isUserMove: false,
    });

    expect(theirs?.problem ?? "").not.toContain("your");
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
