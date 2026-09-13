import { describe, it, expect } from "vitest";
import type { WeaknessExample } from "@/weakness/queries";
import { selectExamples } from "./examples";

/**
 * The coach sees three positions per weakness, and which three decides what it
 * can say. Worst, typical and most recent, from distinct games, so it sees the
 * full shape of the problem rather than three views of one disaster — and can
 * say whether the problem is still happening.
 */

function example(over: Partial<WeaknessExample> = {}): WeaknessExample {
  return {
    gameId: "g1",
    ply: 10,
    san: "Nf3",
    fenBefore: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    classification: "blunder",
    winPctLost: 10,
    endTime: 1_700_000_000,
    opponentUsername: "opp",
    ...over,
  };
}

describe("selectExamples", () => {
  it("picks the worst, a typical and the most recent case", () => {
    const pool = [
      example({ gameId: "a", winPctLost: 40, endTime: 100 }),
      example({ gameId: "b", winPctLost: 20, endTime: 200 }),
      example({ gameId: "c", winPctLost: 10, endTime: 300 }),
    ];

    const picked = selectExamples(pool);

    expect(picked.map((p) => p.role)).toEqual(["worst", "typical", "recent"]);
    expect(picked[0]!.example.gameId).toBe("a"); // biggest loss
    expect(picked[2]!.example.gameId).toBe("c"); // latest endTime
  });

  it("never shows the same game twice", () => {
    // The failure this guards: one catastrophic game is both the worst case
    // and the most recent one, so a naive pick shows it three times and the
    // coach describes a single disaster as if it were a pattern.
    const pool = [
      example({ gameId: "a", ply: 10, winPctLost: 40, endTime: 900 }),
      example({ gameId: "a", ply: 20, winPctLost: 35, endTime: 900 }),
      example({ gameId: "b", ply: 10, winPctLost: 20, endTime: 100 }),
      example({ gameId: "c", ply: 10, winPctLost: 5, endTime: 200 }),
    ];

    const picked = selectExamples(pool);

    const games = picked.map((p) => p.example.gameId);
    expect(new Set(games).size).toBe(games.length);
    expect(picked).toHaveLength(3);
  });

  it("returns fewer than three when there are not three distinct games", () => {
    const pool = [
      example({ gameId: "a", ply: 10, winPctLost: 40 }),
      example({ gameId: "a", ply: 20, winPctLost: 10 }),
    ];

    const picked = selectExamples(pool);

    expect(picked).toHaveLength(1);
    expect(picked[0]!.example.gameId).toBe("a");
  });

  it("has nothing to show for an empty pool", () => {
    expect(selectExamples([])).toEqual([]);
  });

  it("picks the same three whatever order the pool arrives in", () => {
    // The cache is keyed by a hash of the request, and the examples are in
    // it. If selection depended on input order — or on how ties happened to
    // land — an unchanged corpus would produce a new hash and silently pay
    // for a fresh explanation on every page load.
    const pool = [
      example({ gameId: "a", ply: 1, winPctLost: 30, endTime: 100 }),
      example({ gameId: "b", ply: 2, winPctLost: 30, endTime: 100 }),
      example({ gameId: "c", ply: 3, winPctLost: 30, endTime: 100 }),
      example({ gameId: "d", ply: 4, winPctLost: 30, endTime: 100 }),
    ];

    const forwards = selectExamples(pool);
    const backwards = selectExamples([...pool].reverse());

    expect(backwards).toEqual(forwards);
  });
});
