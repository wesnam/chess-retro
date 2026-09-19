import { describe, it, expect } from "vitest";
import { tallyMarks } from "./move-marks";

/**
 * The player's six mark counts for one game, tallied from moves already
 * loaded for the review board rather than fetched again.
 */

function move(
  classification: string | null,
  isUserMove = true,
): { classification: string | null; isUserMove: boolean } {
  return { classification, isUserMove };
}

describe("tallying a game's marks", () => {
  it("counts the player's moves by grade", () => {
    const marks = tallyMarks([
      move("best"),
      move("best"),
      move("good"),
      move("blunder"),
    ]);

    expect(marks).toEqual({
      best: 2,
      excellent: 0,
      good: 1,
      inaccuracy: 0,
      mistake: 0,
      blunder: 1,
    });
  });

  it("ignores the opponent's moves", () => {
    // The panel is the player's own review. Counting both sides would credit
    // them with the opponent's best moves and blame them for the blunders.
    const marks = tallyMarks([move("best"), move("blunder", false)]);

    expect(marks.best).toBe(1);
    expect(marks.blunder).toBe(0);
  });

  it("ignores moves that carry no classification", () => {
    // An unanalysed move must not land in a bucket, or a half-analysed game
    // reads as a cleaner one than it was.
    const marks = tallyMarks([move(null), move("mistake")]);

    expect(marks.mistake).toBe(1);
    expect(Object.values(marks).reduce((a, b) => a + b, 0)).toBe(1);
  });

  it("counts nothing for a game with no moves", () => {
    expect(Object.values(tallyMarks([])).every((n) => n === 0)).toBe(true);
  });

  it("skips a classification the app does not recognise", () => {
    // A grade written by an older version must not widen the shape with a key
    // the panel cannot render.
    const marks = tallyMarks([move("brilliant"), move("best")]);

    expect(marks.best).toBe(1);
    expect(Object.values(marks).reduce((a, b) => a + b, 0)).toBe(1);
  });
});
