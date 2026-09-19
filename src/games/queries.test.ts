import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type Db } from "@/db/client";
import { games } from "@/db/schema";
import { countGames, listGames } from "./queries";

let db: Db;

beforeEach(() => {
  db = createDb(":memory:");
});

type SeedOptions = Partial<{
  id: string;
  user: string;
  timeClass: string;
  userColor: string;
  userResult: string;
  endTime: number;
}>;

function seed(options: SeedOptions = {}) {
  db.insert(games)
    .values({
      id: options.id ?? `g-${Math.random()}`,
      user: options.user ?? "alice",
      pgn: "[pgn]",
      timeClass: options.timeClass ?? "blitz",
      userColor: options.userColor ?? "w",
      userResult: options.userResult ?? "win",
      endTime: options.endTime ?? 1_700_000_000,
      rated: true,
    })
    .run();
}

describe("listing games", () => {
  it("returns nothing for a user with no games", () => {
    expect(listGames(db, "alice")).toEqual([]);
  });

  it("shows the most recent game first", () => {
    seed({ id: "old", endTime: 1000 });
    seed({ id: "new", endTime: 2000 });
    seed({ id: "middle", endTime: 1500 });

    expect(listGames(db, "alice").map((g) => g.id)).toEqual([
      "new",
      "middle",
      "old",
    ]);
  });

  it("returns only the requested user's games", () => {
    seed({ id: "hers", user: "alice" });
    seed({ id: "his", user: "bob" });

    expect(listGames(db, "alice").map((g) => g.id)).toEqual(["hers"]);
    expect(listGames(db, "bob").map((g) => g.id)).toEqual(["his"]);
  });

  it("can filter to one time control", () => {
    seed({ id: "b1", timeClass: "blitz" });
    seed({ id: "r1", timeClass: "rapid" });

    const blitz = listGames(db, "alice", { timeClass: "blitz" });
    expect(blitz.map((g) => g.id)).toEqual(["b1"]);
  });

  it("honours a limit", () => {
    for (let i = 0; i < 5; i += 1) seed({ id: `g${i}`, endTime: 1000 + i });
    expect(listGames(db, "alice", { limit: 2 })).toHaveLength(2);
  });

  it("carries the fields the list displays", () => {
    seed({ id: "g1", userColor: "b", userResult: "loss" });
    const [row] = listGames(db, "alice");

    expect(row).toMatchObject({
      id: "g1",
      userColor: "b",
      userResult: "loss",
      timeClass: "blitz",
    });
  });
});

describe("counting games", () => {
  it("is zero for an unknown user", () => {
    expect(countGames(db, "nobody").total).toBe(0);
  });

  it("totals wins, losses and draws", () => {
    seed({ userResult: "win" });
    seed({ userResult: "win" });
    seed({ userResult: "loss" });
    seed({ userResult: "draw" });

    const counts = countGames(db, "alice");
    expect(counts.total).toBe(4);
    expect(counts.byResult).toEqual({ win: 2, loss: 1, draw: 1 });
  });

  it("breaks down by time control, commonest first", () => {
    seed({ timeClass: "blitz" });
    seed({ timeClass: "blitz" });
    seed({ timeClass: "bullet" });

    expect(countGames(db, "alice").byTimeClass).toEqual([
      { timeClass: "blitz", count: 2 },
      { timeClass: "bullet", count: 1 },
    ]);
  });

  it("counts each user separately", () => {
    seed({ user: "alice" });
    seed({ user: "bob" });
    seed({ user: "bob" });

    expect(countGames(db, "alice").total).toBe(1);
    expect(countGames(db, "bob").total).toBe(2);
  });
});
