import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type Db } from "@/db/client";
import type { CoachProvider } from "./provider";
import type { InsightRequest } from "./request";
import { coachingFor } from "./coach";

/**
 * The cached path: what it costs to revisit the dashboard.
 *
 * Explaining is a paid API call, so an unchanged corpus must never pay twice.
 * These run against real SQLite because the cache IS the insights table —
 * mocking the database here would test nothing.
 */

let db: Db;
beforeEach(() => {
  db = createDb(":memory:");
});

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

function stubProvider(): CoachProvider & { calls: number } {
  return {
    model: "test-model",
    calls: 0,
    async explain() {
      this.calls += 1;
      return {
        weaknesses: [
          {
            key: "motif:fork",
            explanation: "You miss forks.",
            why: "You scan captures only.",
          },
        ],
        practice: { summary: "Drill forks.", themes: ["fork"] },
      };
    },
  };
}

describe("coachingFor", () => {
  it("asks the model when nothing is cached", async () => {
    const provider = stubProvider();

    const result = await coachingFor(db, "hikaru", request, provider);

    expect(provider.calls).toBe(1);
    expect(result.coaching?.weaknesses[0]!.explanation).toBe("You miss forks.");
    expect(result.cached).toBe(false);
  });

  it("serves the same statistics from cache without paying again", async () => {
    const provider = stubProvider();

    await coachingFor(db, "hikaru", request, provider);
    const second = await coachingFor(db, "hikaru", request, provider);

    expect(provider.calls).toBe(1);
    expect(second.cached).toBe(true);
    expect(second.coaching?.weaknesses[0]!.explanation).toBe("You miss forks.");
  });

  it("asks again once the statistics change", async () => {
    const provider = stubProvider();

    await coachingFor(db, "hikaru", request, provider);
    await coachingFor(db, "hikaru", { ...request, analysedMoves: 4300 }, provider);

    expect(provider.calls).toBe(2);
  });

  it("returns nothing rather than throwing when there is no provider", async () => {
    // No API key configured: the dashboard must still render its ranked
    // statistics, so the absence of a coach is a normal state and not an error.
    const result = await coachingFor(db, "hikaru", request, undefined);

    expect(result.coaching).toBeUndefined();
    expect(result.reason).toBe("unavailable");
  });

  it("survives the model failing", async () => {
    const failing: CoachProvider = {
      model: "test-model",
      async explain() {
        throw new Error("503 from the API");
      },
    };

    const result = await coachingFor(db, "hikaru", request, failing);

    expect(result.coaching).toBeUndefined();
    expect(result.reason).toBe("failed");
  });

  it("does not serve one player's explanation to another", async () => {
    // The statistics alone do not identify whose they are. Two accounts with
    // the same numbers would otherwise share a cache row, and the second
    // player would read prose written about someone else's games.
    const provider = stubProvider();

    await coachingFor(db, "hikaru", request, provider);
    const other = await coachingFor(db, "magnus", request, provider);

    expect(other.cached).toBe(false);
    expect(provider.calls).toBe(2);
  });

  it("asks again after the model changes", async () => {
    // `CoachProvider.model` promises that a model change invalidates the
    // cache; without the model in the key, swapping providers would keep
    // serving the old model's prose forever.
    const oldModel = stubProvider();
    await coachingFor(db, "hikaru", request, oldModel);

    const newModel = { ...stubProvider(), model: "different-model" };
    const result = await coachingFor(db, "hikaru", request, newModel);

    expect(result.cached).toBe(false);
    expect(newModel.calls).toBe(1);
  });
});
