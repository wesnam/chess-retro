import { describe, it, expect } from "vitest";
import { detectMotifs } from "./detect";

/**
 * Each detector over hand-built positions.
 *
 * Every detector gets a positive case AND a negative case that would fool a
 * naive implementation. That asymmetry is the point: a false "missed fork"
 * becomes a false weakness, which becomes false coaching and wasted practice —
 * the wrong end of the whole pipeline. Tags must be conservative.
 */

/** Motifs found for a move played from `fen`. */
function motifs(fen: string, uci: string): string[] {
  return detectMotifs(fen, uci).sort();
}

describe("fork", () => {
  it("tags a knight check that also attacks a rook", () => {
    // Nb5-c7+ hits the king on e8 and the rook on a8 at once.
    expect(motifs("r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1", "b5c7")).toContain(
      "fork",
    );
  });

  it("does not call an attack on two defended pawns a fork", () => {
    // The ticket's own example. The knight hits b7 and d7, but both are
    // defended by the king and neither can actually be won.
    expect(motifs("4k3/1p1p4/8/2N5/8/8/8/4K3 w - - 0 1", "c5d3")).not.toContain(
      "fork",
    );
  });

  it("does not call a single attack a fork", () => {
    expect(motifs("4k3/8/8/8/8/8/8/R3K3 w - - 0 1", "a1a7")).not.toContain(
      "fork",
    );
  });
});

describe("hangingPiece", () => {
  it("tags capturing a piece that was left undefended", () => {
    // The black bishop on d5 is defended by nothing.
    expect(motifs("4k3/8/8/3b4/8/2N5/8/4K3 w - - 0 1", "c3d5")).toContain(
      "hangingPiece",
    );
  });

  it("does not tag an even trade", () => {
    // The bishop is defended by the king: knight for bishop is not winning
    // material, so nothing was hanging.
    expect(motifs("8/8/8/3b4/4k3/2N5/8/4K3 w - - 0 1", "c3d5")).not.toContain(
      "hangingPiece",
    );
  });

  it("does not tag a capture that loses material", () => {
    // Rook takes a pawn defended by a pawn.
    expect(motifs("4k3/8/1p6/2p5/8/8/8/2R1K3 w - - 0 1", "c1c5")).not.toContain(
      "hangingPiece",
    );
  });
});

describe("pin", () => {
  it("tags pinning a knight against its king", () => {
    // Bb5 pins the knight on c6 to the king on e8.
    expect(motifs("4k3/8/2n5/8/8/8/8/4KB2 w - - 0 1", "f1b5")).toContain("pin");
  });

  it("does not call an attack with nothing behind it a pin", () => {
    expect(motifs("4k3/8/2n5/8/8/8/8/4KB2 w - - 0 1", "f1a6")).not.toContain(
      "pin",
    );
  });
});

describe("skewer", () => {
  it("tags attacking a king with a rook behind it", () => {
    // The king must move, losing the rook behind it on the same rank.
    expect(motifs("4k2r/8/8/8/8/8/8/R3K3 w - - 0 1", "a1a8")).toContain(
      "skewer",
    );
  });

  it("does not call a pin a skewer", () => {
    // Front piece cheaper than the back piece is a pin, not a skewer.
    expect(motifs("4k3/8/2n5/8/8/8/8/4KB2 w - - 0 1", "f1b5")).not.toContain(
      "skewer",
    );
  });
});

describe("backRankMate", () => {
  it("tags mate delivered on the back rank behind its own pawns", () => {
    expect(motifs("6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1", "a1a8")).toContain(
      "backRankMate",
    );
  });

  it("does not call a mate in the middle of the board a back-rank mate", () => {
    // Scholar's mate. The king is on its own back rank with pieces near it,
    // but it is mated by a queen on f7, not boxed in along the rank — the
    // escape squares must ALL be blocked by its own pieces, not merely one.
    expect(
      motifs(
        "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 1",
        "f3f7",
      ),
    ).not.toContain("backRankMate");
  });

  it("does not tag a back-rank check the king can escape", () => {
    // Luft: the h-pawn has moved, so the king walks out.
    expect(motifs("6k1/5pp1/7p/8/8/8/8/R3K3 w - - 0 1", "a1a8")).not.toContain(
      "backRankMate",
    );
  });
});

describe("mateIn1", () => {
  it("tags a move that delivers mate", () => {
    expect(motifs("6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1", "a1a8")).toContain(
      "mateIn1",
    );
  });

  it("does not tag an ordinary check", () => {
    expect(motifs("4k3/8/8/8/8/8/8/R3K3 w - - 0 1", "a1a8")).not.toContain(
      "mateIn1",
    );
  });
});

describe("doubleCheck", () => {
  it("tags a discovered move that checks with two pieces at once", () => {
    // Rook on e1 behind the knight on d5. Nd5-c7+ checks with the knight and
    // uncovers the rook's check down the e-file: two checkers at once.
    const found = motifs("4k3/8/8/3N4/8/8/8/4R1K1 w - - 0 1", "d5c7");
    expect(found).toContain("doubleCheck");
  });

  it("does not tag an ordinary single check", () => {
    expect(motifs("4k3/8/8/8/8/8/8/R3K3 w - - 0 1", "a1a8")).not.toContain(
      "doubleCheck",
    );
  });
});

describe("discoveredAttack", () => {
  it("tags moving a piece out of its own rook's line onto a target", () => {
    // The rook on e1 is behind the knight on e5; moving the knight uncovers
    // an attack on the king.
    expect(motifs("4k3/8/8/4N3/8/8/8/4R1K1 w - - 0 1", "e5c4")).toContain(
      "discoveredAttack",
    );
  });

  it("does not tag a move that uncovers nothing", () => {
    expect(motifs("4k3/8/8/4N3/8/8/8/6K1 w - - 0 1", "e5c4")).not.toContain(
      "discoveredAttack",
    );
  });
});

describe("sacrifice", () => {
  it("tags giving up material into a capture", () => {
    // Ra6-e6 steps onto a square the f7 pawn defends, capturing nothing.
    expect(motifs("4k3/5p2/R7/8/8/8/8/4K3 w - - 0 1", "a6e6")).toContain(
      "sacrifice",
    );
  });

  it("does not tag a move to a square nothing attacks", () => {
    expect(motifs("4k3/5p2/R7/8/8/8/8/4K3 w - - 0 1", "a6b6")).not.toContain(
      "sacrifice",
    );
  });

  it("does not call a safe developing move a sacrifice", () => {
    expect(motifs("4k3/8/8/8/8/8/8/R3K3 w - - 0 1", "a1a4")).not.toContain(
      "sacrifice",
    );
  });
});

describe("trappedPiece", () => {
  it("does not tag a piece with squares to run to", () => {
    expect(motifs("4k3/8/8/3b4/8/8/8/4K3 b - - 0 1", "d5e4")).not.toContain(
      "trappedPiece",
    );
  });

  it("does not tag every piece on the board when the move gives check", () => {
    // Escape squares come from chess.js's legal moves, which under check are
    // only the king's evasions — so every other enemy piece looks stuck. That
    // makes any check-plus-attack read as a trapped piece: this fork position
    // was falsely tagged even though the a8 rook has a whole rank and file.
    expect(motifs("r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1", "b5c7")).not.toContain(
      "trappedPiece",
    );
  });

  it("does not tag a checkmate as a trapped piece", () => {
    expect(
      motifs(
        "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 1",
        "f3f7",
      ),
    ).not.toContain("trappedPiece");
  });
});

describe("several tactics at once", () => {
  it("gives a position more than one tag when it earns them", () => {
    // Ra8 is mate, on the back rank, and the rook is not hanging.
    const found = motifs("6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1", "a1a8");

    expect(found).toContain("mateIn1");
    expect(found).toContain("backRankMate");
    expect(found.length).toBeGreaterThan(1);
  });
});

describe("robustness", () => {
  it("returns nothing for a move that is not legal in the position", () => {
    expect(motifs("4k3/8/8/8/8/8/8/4K3 w - - 0 1", "a1a8")).toEqual([]);
  });

  it("returns nothing for an unreadable position", () => {
    expect(motifs("not-a-fen", "a1a8")).toEqual([]);
  });
});
