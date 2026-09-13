import { describe, it, expect } from "vitest";
import type { InsightRequest } from "./request";
import { validateCoaching } from "./validate";

/**
 * The guard between a model's output and the page.
 *
 * The model is instructed to treat the statistics as ground truth and to
 * invent nothing — but an instruction is not an enforcement. This is the
 * enforcement, and it is why the feature can be trusted to be about the
 * player rather than about chess in general.
 */

const request: InsightRequest = {
  timeClass: "rapid",
  analysedMoves: 4200,
  baseline: 2.4,
  weaknesses: [
    {
      id: "motif:fork",
      dimension: "motif",
      key: "fork",
      label: "fork",
      title: "You miss forks",
      opportunities: 40,
      failures: 12,
      failureRate: 0.3,
      winPctLost: 150,
      games: 9,
      lift: 2.1,
      referenceMissRate: 0.18,
      examples: [],
    },
  ],
};

function coaching(over: Record<string, unknown> = {}) {
  return {
    weaknesses: [
      {
        key: "motif:fork",
        explanation: "You are missing knight forks in the middlegame.",
        why: "You check captures but not squares that hit two pieces at once.",
      },
    ],
    practice: {
      summary: "Drill forks.",
      themes: ["fork"],
    },
    ...over,
  };
}

describe("validateCoaching", () => {
  it("accepts coaching that stays inside the supplied data", () => {
    const result = validateCoaching(coaching(), request);

    expect(result.ok).toBe(true);
  });

  it("drops a weakness the data does not contain", () => {
    // The failure this exists to stop: the model recognises a famous chess
    // weakness, writes convincing prose about it, and the player is told
    // they are bad at something never measured in their games.
    const result = validateCoaching(
      coaching({
        weaknesses: [
          ...coaching().weaknesses,
          {
            key: "motif:backRankMate",
            explanation: "You also hang back-rank mates constantly.",
            why: "You never make luft.",
          },
        ],
      }),
      request,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.value.weaknesses.map((w) => w.key)).toEqual(["motif:fork"]);
    expect(result.dropped).toEqual(["motif:backRankMate"]);
  });

  it("rejects a practice theme that is not a detected motif", () => {
    // Ticket 10 matches puzzles by theme string. A hallucinated theme would
    // become a puzzle query that silently returns nothing.
    const result = validateCoaching(
      coaching({ practice: { summary: "Drill.", themes: ["zwischenzug"] } }),
      request,
    );

    if (!result.ok) throw new Error(result.reason);
    expect(result.value.practice.themes).toEqual([]);
  });

  it("rejects output that is not shaped like coaching at all", () => {
    expect(validateCoaching({ nonsense: true }, request).ok).toBe(false);
    expect(validateCoaching(null, request).ok).toBe(false);
  });

  it("rejects a real motif that this player was not measured for", () => {
    // The subtler half of the same failure the module exists to prevent.
    // "backRankMate" is a genuine motif the detectors emit, so a bare
    // spelling check waves it through — but this request only contains
    // forks, so drilling back-rank mates is advice about chess in general
    // rather than about this player.
    const result = validateCoaching(
      coaching({
        practice: { summary: "Drill.", themes: ["fork", "backRankMate"] },
      }),
      request,
    );

    if (!result.ok) throw new Error(result.reason);
    expect(result.value.practice.themes).toEqual(["fork"]);
  });

  it("tells apart two weaknesses that share a key across dimensions", () => {
    // Dimensions have separate key spaces, so nothing stops a motif and an
    // opening family both being called "x". Matching on the bare key would
    // put one paragraph on both cards; the dashboard keys cards by
    // dimension and key, and this must agree with it.
    const twoDimensions: InsightRequest = {
      ...request,
      weaknesses: [
        { ...request.weaknesses[0]!, id: "motif:x", dimension: "motif", key: "x" },
        { ...request.weaknesses[0]!, id: "opening:x", dimension: "opening", key: "x" },
      ],
    };

    const result = validateCoaching(
      {
        weaknesses: [
          { key: "motif:x", explanation: "The tactic.", why: "Because." },
          { key: "opening:x", explanation: "The opening.", why: "Because." },
        ],
        practice: { summary: "Drill.", themes: [] },
      },
      twoDimensions,
    );

    if (!result.ok) throw new Error(result.reason);
    expect(result.value.weaknesses.map((w) => w.key)).toEqual([
      "motif:x",
      "opening:x",
    ]);
  });
});
