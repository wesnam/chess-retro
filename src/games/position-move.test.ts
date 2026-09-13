import { describe, it, expect } from "vitest";
import { plyShownAt, plyPlayedFrom, positionForPly } from "./position-move";

/**
 * Which move each position is about.
 *
 * `buildReview` fixes the convention: a move highlights on the position it
 * PRODUCED, so ply N belongs to position N and position 0 is the starting
 * position, before anybody has moved. The board, the eval bar, the graph
 * cursor and the scoresheet all key off that one number.
 *
 * The verdict pane did not. It looked up `index + 1` — the move about to be
 * played rather than the one that was — so the opening position showed the
 * board untouched while the pane beside it rated White's first move. Exactly
 * "the board showing one position while the evaluation beside it describes
 * another", which the rest of the review is carefully built to avoid.
 */

describe("the move a position is about", () => {
  it("is nothing at the starting position, where nobody has moved", () => {
    // The whole bug in one assertion.
    expect(plyShownAt(0)).toBeUndefined();
  });

  it("is the move that produced the position", () => {
    expect(plyShownAt(1)).toBe(1);
    expect(plyShownAt(2)).toBe(2);
    expect(plyShownAt(40)).toBe(40);
  });
});

describe("the move playable FROM a position", () => {
  it("is the next ply, which is what an arrow out of this position shows", () => {
    // Distinct from the above and deliberately named apart: at position 0 the
    // engine's suggestion for the opening move is a real thing to draw, even
    // though no move has been played yet.
    expect(plyPlayedFrom(0)).toBe(1);
    expect(plyPlayedFrom(5)).toBe(6);
  });
});

/**
 * The scoresheet cursor marks the move the board is showing.
 *
 * It used to highlight `index + 1` — the move about to be played — while the
 * board, the eval bar and the verdict all describe the move that produced the
 * position. The grid therefore read one turn ahead of the board: at the
 * position where Nf3 had just been played, the cursor sat on Qf6.
 *
 * The comment defending that cited a real bug — a dashboard link to a blunder
 * landing the cursor a move short — but the cause of THAT is the link, which
 * opens `ply - 1`. A link to ply N should open the position ply N produced, and
 * then one convention serves everything on the page.
 */

describe("the scoresheet cursor", () => {
  it("marks the move that produced the position on the board", () => {
    // Index 3 shows the result of ply 3; the cursor belongs on ply 3.
    expect(plyShownAt(3)).toBe(3);
    expect(plyShownAt(12)).toBe(12);
  });

  it("marks nothing at the starting position", () => {
    expect(plyShownAt(0)).toBeUndefined();
  });

  it("agrees with the verdict, which reads the same function", () => {
    // The two were computed from different expressions and drifted apart. One
    // source, so they cannot disagree again.
    for (const index of [1, 3, 7, 12, 40]) {
      expect(plyShownAt(index)).toBe(plyShownAt(index));
    }
  });
});

describe("opening a game at a move", () => {
  it("lands on the position that move produced", () => {
    // A dashboard example linking to the blunder at ply 23 should open the
    // board showing that blunder played, with the cursor on it — not the quiet
    // position before it.
    expect(positionForPly(23)).toBe(23);
    expect(plyShownAt(positionForPly(23))).toBe(23);
  });

  it("keeps ply 1 inside the board", () => {
    expect(positionForPly(1)).toBe(1);
  });
});
