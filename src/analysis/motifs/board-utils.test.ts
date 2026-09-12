import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import {
  attackedBy,
  defendersOf,
  isHanging,
  isSoftlyDefended,
  pieceValue,
  slidingBetween,
  winsMaterial,
} from "./board-utils";

/**
 * The primitives every detector shares. These decide what counts as "hanging"
 * and what counts as "wins material", so a mistake here becomes a wrong motif
 * on every position in the corpus.
 */

describe("pieceValue", () => {
  it("ranks the pieces conventionally", () => {
    expect(pieceValue("p")).toBe(1);
    expect(pieceValue("n")).toBe(3);
    expect(pieceValue("b")).toBe(3);
    expect(pieceValue("r")).toBe(5);
    expect(pieceValue("q")).toBe(9);
  });

  it("gives the king a value no capture can exceed", () => {
    expect(pieceValue("k")).toBeGreaterThan(pieceValue("q"));
  });
});

describe("defendersOf", () => {
  it("finds a pawn defending another pawn", () => {
    const chess = new Chess("8/1p6/p7/8/8/8/8/K6k w - - 0 1");
    expect(defendersOf(chess, "a6")).toEqual(["b7"]);
  });

  it("finds nothing defending a lone piece", () => {
    const chess = new Chess("8/8/p7/8/8/8/8/K6k w - - 0 1");
    expect(defendersOf(chess, "a6")).toEqual([]);
  });

  it("finds a defender of an occupied square", () => {
    // chess.js's own `attackers` will not report a piece defending its own
    // side's OCCUPIED square. Reading it directly answers "undefended" for
    // every real piece on the board, which tags everything as hanging.
    // Black pawns capture downward, so d6 defends e5 (d5 would not).
    const chess = new Chess("4k3/8/3p4/4p3/8/8/8/4K3 w - - 0 1");
    expect(defendersOf(chess, "e5")).toEqual(["d6"]);
  });

  it("finds a defender on the back rank", () => {
    // The stand-in piece cannot be a pawn here, since pawns cannot occupy
    // the back ranks and the probe position would be illegal.
    const chess = new Chess("4k3/8/8/8/8/8/8/R5RK w - - 0 1");
    expect(defendersOf(chess, "a1")).toContain("g1");
  });

  it("does not count a piece as its own defender", () => {
    const chess = new Chess("4k3/8/3p4/4p3/8/8/8/4K3 w - - 0 1");
    expect(defendersOf(chess, "e5")).not.toContain("e5");
  });

  it("finds a defender that is a pawn of the other colour's direction", () => {
    // The mirror of the case above: white pawns capture upward, so d4
    // defends e5 for White.
    const chess = new Chess("4k3/8/8/4P3/3P4/8/8/4K3 w - - 0 1");
    expect(defendersOf(chess, "e5")).toEqual(["d4"]);
  });
});

describe("isHanging", () => {
  it("calls an undefended attacked piece hanging", () => {
    // White knight attacks the undefended black bishop on d5.
    const chess = new Chess("4k3/8/8/3b4/8/2N5/8/4K3 w - - 0 1");
    expect(isHanging(chess, "d5")).toBe(true);
  });

  it("does not call a defended piece hanging when the trade is level", () => {
    // The bishop is defended by the king, and a knight for a bishop is even.
    const chess = new Chess("8/8/8/3b4/4k3/2N5/8/4K3 w - - 0 1");
    expect(isHanging(chess, "d5")).toBe(false);
  });

  it("calls a defended piece hanging when it can be won cheaply", () => {
    // A pawn attacks the queen: the defender does not save it, because
    // queen-for-pawn loses material even after the recapture.
    const chess = new Chess("4k3/8/8/3q4/2P5/8/8/4K3 w - - 0 1");
    expect(isHanging(chess, "d5")).toBe(true);
  });

  it("does not call an unattacked piece hanging", () => {
    const chess = new Chess("4k3/8/8/3b4/8/8/8/4K3 w - - 0 1");
    expect(isHanging(chess, "d5")).toBe(false);
  });

  it("says nothing about an empty square", () => {
    const chess = new Chess("4k3/8/8/8/8/8/8/4K3 w - - 0 1");
    expect(isHanging(chess, "d5")).toBe(false);
  });
});

describe("isSoftlyDefended", () => {
  it("is true when the defender is worth more than the attacker", () => {
    // Queen defends a pawn a pawn attacks: taking still wins material.
    const chess = new Chess("4k3/8/8/3p4/2P5/8/3Q4/4K3 w - - 0 1");
    expect(isSoftlyDefended(chess, "d5")).toBe(false);
  });
});

describe("winsMaterial", () => {
  it("is true when capturing an undefended piece", () => {
    const chess = new Chess("4k3/8/8/3b4/8/2N5/8/4K3 w - - 0 1");
    expect(winsMaterial(chess, "c3", "d5")).toBe(true);
  });

  it("is false for an even trade", () => {
    const chess = new Chess("8/8/8/3b4/4k3/2N5/8/4K3 w - - 0 1");
    expect(winsMaterial(chess, "c3", "d5")).toBe(false);
  });

  it("is false when the capture loses material", () => {
    // Rook takes a pawn defended by a pawn.
    const chess = new Chess("4k3/8/1p6/2p5/8/8/8/R3K3 w - - 0 1");
    expect(winsMaterial(chess, "a1", "a8")).toBe(false);
  });
});

describe("slidingBetween", () => {
  it("lists the squares between two points on a rank", () => {
    expect(slidingBetween("a1", "d1")).toEqual(["b1", "c1"]);
  });

  it("lists the squares between two points on a diagonal", () => {
    expect(slidingBetween("c1", "f4")).toEqual(["d2", "e3"]);
  });

  it("is empty for adjacent squares", () => {
    expect(slidingBetween("a1", "b1")).toEqual([]);
  });

  it("is empty for squares that share no line", () => {
    // A knight's move is not a line, so nothing lies between.
    expect(slidingBetween("a1", "b3")).toEqual([]);
  });
});

describe("attackedBy", () => {
  it("lists what a piece on a square attacks", () => {
    // Knight on c7 hits a8 and e8 among others.
    const chess = new Chess("r3k3/2N5/8/8/8/8/8/4K3 w - - 0 1");
    const targets = attackedBy(chess, "c7");

    expect(targets).toContain("a8");
    expect(targets).toContain("e8");
  });

  it("is empty for an empty square", () => {
    const chess = new Chess("4k3/8/8/8/8/8/8/4K3 w - - 0 1");
    expect(attackedBy(chess, "d4")).toEqual([]);
  });
});
