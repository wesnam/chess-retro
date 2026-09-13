import { describe, it, expect } from "vitest";
import type { RankedWeakness, WeaknessReport } from "@/weakness/report";
import { buildRequest, hashRequest } from "./request";

/**
 * What the model is allowed to see, and the key it is cached under.
 *
 * Everything here is computed before the model is called: the request IS the
 * ground truth, so anything absent from it is something the coach must not be
 * able to claim.
 */

function weakness(over: Partial<RankedWeakness> = {}): RankedWeakness {
  return {
    dimension: "motif",
    key: "fork",
    label: "fork",
    opportunities: 40,
    failures: 12,
    winPctLost: 150,
    winPctLostAcrossAll: 150,
    games: 9,
    severity: 3.75,
    lift: 2.1,
    confidence: 0.6,
    failureRate: 0.3,
    excessRate: 0.12,
    referenceMissRate: 0.18,
    score: 7.2,
    examples: [
      {
        gameId: "g1",
        ply: 21,
        san: "Nf3",
        fenBefore: "8/8/8/8/8/8/8/K6k w - - 0 1",
        classification: "blunder",
        winPctLost: 22,
        endTime: 1_700_000_000,
        opponentUsername: "opp",
      },
    ],
    ...over,
  };
}

function report(over: Partial<WeaknessReport> = {}): WeaknessReport {
  return {
    timeClass: "rapid",
    baseline: 2.4,
    weaknesses: [weakness()],
    suppressed: 2,
    analysedMoves: 4200,
    fit: { applies: true, reason: "in-band" },
    rating: 640,
    ...over,
  };
}

const IDENTITY = { user: "hikaru", model: "test-model" };

describe("buildRequest", () => {
  it("carries the corpus size and the ranked statistics", () => {
    const request = buildRequest(report());

    expect(request.timeClass).toBe("rapid");
    expect(request.analysedMoves).toBe(4200);
    expect(request.baseline).toBe(2.4);
    expect(request.weaknesses[0]!.key).toBe("fork");
    expect(request.weaknesses[0]!.id).toBe("motif:fork");
    expect(request.weaknesses[0]!.failureRate).toBe(0.3);
  });
});

describe("hashRequest", () => {
  it("gives the same hash for the same statistics", () => {
    expect(hashRequest(buildRequest(report()), IDENTITY)).toBe(
      hashRequest(buildRequest(report()), IDENTITY),
    );
  });

  it("changes when the statistics change", () => {
    // The cache must not serve an explanation of last week's corpus after
    // more games have been analysed.
    const before = hashRequest(buildRequest(report()), IDENTITY);
    const after = hashRequest(buildRequest(report({ analysedMoves: 4300 })), IDENTITY);

    expect(after).not.toBe(before);
  });
});
