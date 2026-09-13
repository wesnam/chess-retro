import { describe, it, expect } from "vitest";
import { plyShownAt, plyPlayedFrom } from "./position-move";

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
