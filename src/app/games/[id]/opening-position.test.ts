import { describe, it, expect } from "vitest";
import { openingPosition } from "./page";

/**
 * Where `?ply=N` opens the board.
 *
 * A dashboard example links to the blunder it is citing, so the link must land
 * on the position that blunder PRODUCED — board showing it played, verdict
 * describing it, cursor on it. Opening the position before it put all three a
 * move short of the thing the link was about.
 *
 * The guard matters as much as the arithmetic: this value comes from a URL,
 * and `Number` accepts far more than it looks like it does.
 */

describe("opening a game at a ply", () => {
  it("opens the position the ply produced", () => {
    expect(openingPosition("23")).toBe(23);
    expect(openingPosition("1")).toBe(1);
  });

  it("opens the start when no ply is named", () => {
    expect(openingPosition(undefined)).toBe(0);
  });

  it("opens the start for a repeated parameter, which arrives as an array", () => {
    expect(openingPosition(["3", "9"])).toBe(0);
  });

  it("refuses anything that is not plain digits", () => {
    // Each of these is a number to `Number` and would open the board somewhere
    // the link never named: 16, 1000, 7, and NaN.
    for (const input of ["0x10", "1e3", " 7 ", "abc", "-4", "2.5", ""]) {
      expect(openingPosition(input), input).toBe(0);
    }
  });

  it("refuses ply 0, which is the starting position and names no move", () => {
    expect(openingPosition("0")).toBe(0);
  });
});
