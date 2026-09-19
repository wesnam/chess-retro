import { describe, it, expect } from "vitest";
import { qualityScore, qualityPercentile, describeQuality } from "./game-quality";
import { emptyMarks, type MoveMarks } from "./move-marks";

/**
 * How well one game was played, as a percentile among measured games.
 *
 * Deliberately NOT a rating. Measured on 271 games crawled across rating
 * bands 800-2400 and analysed with this project's own engine pipeline, the
 * best available formula over these marks explains 6% of the variance in
 * rating (r = 0.24), and the optimal weighting of all six marks plus accuracy
 * reaches only 7%. A single game does not carry a player's strength, so this
 * says where the GAME falls and claims nothing about who played it.
 */
function marks(over: Partial<MoveMarks>): MoveMarks {
  return { ...emptyMarks(), ...over };
}

describe("scoring one game", () => {
  it("rewards the engine's own choices and punishes catastrophes", () => {
    const clean = qualityScore(marks({ best: 20, good: 10 }))!;
    const sloppy = qualityScore(marks({ best: 20, good: 5, blunder: 5 }))!;

    expect(clean).toBeGreaterThan(sloppy);
  });

  it("counts a blunder as heavier than a merely good move is light", () => {
    // Trading a good move for a blunder must cost, not merely fail to gain.
    const before = qualityScore(marks({ best: 10, good: 10 }))!;
    const after = qualityScore(marks({ best: 10, good: 9, blunder: 1 }))!;

    expect(after).toBeLessThan(before);
  });

  it("is a rate, so a long game is not flattered by its length", () => {
    // Twice the moves at the same standard is the same quality.
    const short = qualityScore(marks({ best: 10, good: 5, blunder: 1 }))!;
    const long = qualityScore(marks({ best: 20, good: 10, blunder: 2 }))!;

    expect(long).toBeCloseTo(short, 5);
  });

  it("has no score for a game with no classified moves", () => {
    expect(qualityScore(emptyMarks())).toBeUndefined();
  });
});

describe("placing a game among measured games", () => {
  it("puts a typical game near the middle", () => {
    // The median of the reference corpus is Q = 0.333.
    const median = qualityPercentile(0.333)!;

    expect(median).toBeGreaterThan(40);
    expect(median).toBeLessThan(60);
  });

  it("puts a strong game high and a weak one low", () => {
    expect(qualityPercentile(0.6)!).toBeGreaterThan(90);
    expect(qualityPercentile(0.1)!).toBeLessThan(15);
  });

  it("never leaves the 0-100 range, however extreme the game", () => {
    // A flawless game and a catastrophic one both sit off the end of the
    // measured range; neither may report a percentile outside it.
    expect(qualityPercentile(5)).toBe(100);
    expect(qualityPercentile(-5)).toBe(0);
  });

  it("rises with the score, never falling", () => {
    let previous = -1;
    for (let q = -0.3; q <= 0.9; q += 0.01) {
      const p = qualityPercentile(q)!;
      expect(p).toBeGreaterThanOrEqual(previous);
      previous = p;
    }
  });
});

describe("describing the result", () => {
  it("says what the percentile is measured against", () => {
    // A bare "64th percentile" invites "of what?" — the corpus has to travel
    // with the number.
    const text = describeQuality(qualityPercentile(0.4))!;

    expect(text).toMatch(/\d/);
    expect(text.toLowerCase()).toContain("game");
  });

  it("says nothing at all when there is no score", () => {
    expect(describeQuality(undefined)).toBeUndefined();
  });
});
