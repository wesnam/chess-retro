import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type Db } from "@/db/client";
import { games } from "@/db/schema";
import { typicalRating } from "./rating";

/**
 * The player's rating for the purpose of choosing a comparison cohort.
 *
 * A single game's rating is noisy and a career average spans strengths the
 * player has long left behind, so this is deliberately "what are they now",
 * taken from recent games in the time control being looked at.
 */

let db: Db;

beforeEach(() => {
  db = createDb(":memory:");
});

function seed(options: {
  rating: number | null;
  endTime: number;
  timeClass?: string;
  user?: string;
}) {
  db.insert(games)
    .values({
      id: `g${options.endTime}-${options.user ?? "alice"}`,
      user: options.user ?? "alice",
      pgn: "[Event \"t\"]\n\n1. e4 *",
      timeClass: options.timeClass ?? "rapid",
      userColor: "w",
      userResult: "win",
      endTime: options.endTime,
      rated: true,
      userRating: options.rating,
      analysisStatus: "done",
    })
    .run();
}

describe("the player's typical rating", () => {
  it("is undefined when there are no games", () => {
    expect(typicalRating(db, { user: "alice", timeClass: "rapid" })).toBeUndefined();
  });

  it("is undefined when no game carries a rating", () => {
    seed({ rating: null, endTime: 100 });
    expect(typicalRating(db, { user: "alice", timeClass: "rapid" })).toBeUndefined();
  });

  it("reads a single rated game", () => {
    seed({ rating: 640, endTime: 100 });
    expect(typicalRating(db, { user: "alice", timeClass: "rapid" })).toBe(640);
  });

  it("averages across games, so one outlier does not decide the cohort", () => {
    seed({ rating: 600, endTime: 100 });
    seed({ rating: 620, endTime: 200 });
    seed({ rating: 640, endTime: 300 });
    expect(typicalRating(db, { user: "alice", timeClass: "rapid" })).toBe(620);
  });

  it("ignores the other time control", () => {
    // A blitz rating is a different number about a different game; blending
    // them would pick a cohort for a player who does not exist.
    seed({ rating: 640, endTime: 100, timeClass: "rapid" });
    seed({ rating: 1400, endTime: 200, timeClass: "blitz" });
    expect(typicalRating(db, { user: "alice", timeClass: "rapid" })).toBe(640);
  });

  it("ignores another user's games", () => {
    seed({ rating: 640, endTime: 100, user: "alice" });
    seed({ rating: 1800, endTime: 200, user: "bob" });
    expect(typicalRating(db, { user: "alice", timeClass: "rapid" })).toBe(640);
  });

  it("skips games with no rating rather than counting them as zero", () => {
    seed({ rating: 600, endTime: 100 });
    seed({ rating: null, endTime: 200 });
    expect(typicalRating(db, { user: "alice", timeClass: "rapid" })).toBe(600);
  });

  it("prefers recent games, so an old strength does not set the cohort", () => {
    // Someone who has climbed should be compared against where they are now.
    for (let i = 0; i < 60; i += 1) seed({ rating: 600, endTime: 1_000 + i });
    for (let i = 0; i < 40; i += 1) seed({ rating: 1200, endTime: 9_000 + i });

    const rating = typicalRating(db, { user: "alice", timeClass: "rapid" });

    // Only the most recent window counts, so this sits at the newer strength
    // rather than being dragged down by a long history at 600.
    expect(rating).toBe(1200);
  });
});
