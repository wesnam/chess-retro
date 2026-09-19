import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type Db } from "@/db/client";
import { games, moves } from "@/db/schema";
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

/**
 * How many of each mark the player earned, per game.
 *
 * The list is where a player decides which game to open, and "3 blunders"
 * tells them that far faster than a date and an opponent do.
 */
describe("move marks", () => {
  function seedMove(
    gameId: string,
    ply: number,
    classification: string,
    options: { isUserMove?: boolean; user?: string } = {},
  ) {
    db.insert(moves)
      .values({
        gameId,
        ply,
        user: options.user ?? "alice",
        timeClass: "blitz",
        isUserMove: options.isUserMove ?? true,
        color: "w",
        fenBefore: "fen",
        san: "e4",
        uci: "e2e4",
        piece: "p",
        classification,
      })
      .run();
  }

  it("counts the player's moves by mark", () => {
    seed({ id: "g1" });
    seedMove("g1", 1, "best");
    seedMove("g1", 3, "best");
    seedMove("g1", 5, "good");
    seedMove("g1", 7, "blunder");

    const [row] = listGames(db, "alice");

    expect(row!.marks).toEqual({
      best: 2,
      excellent: 0,
      good: 1,
      inaccuracy: 0,
      mistake: 0,
      blunder: 1,
    });
  });

  it("ignores the opponent's moves", () => {
    // The row is the player's own review; counting both sides would credit
    // them with their opponent's good moves and blame them for the blunders.
    seed({ id: "g1" });
    seedMove("g1", 1, "best");
    seedMove("g1", 2, "blunder", { isUserMove: false });

    const [row] = listGames(db, "alice");

    expect(row!.marks.best).toBe(1);
    expect(row!.marks.blunder).toBe(0);
  });

  it("keeps each game's marks to itself", () => {
    seed({ id: "g1", endTime: 2000 });
    seed({ id: "g2", endTime: 1000 });
    seedMove("g1", 1, "blunder");
    seedMove("g2", 1, "best");
    seedMove("g2", 3, "best");

    const rows = listGames(db, "alice");

    expect(rows.find((r) => r.id === "g1")!.marks.blunder).toBe(1);
    expect(rows.find((r) => r.id === "g1")!.marks.best).toBe(0);
    expect(rows.find((r) => r.id === "g2")!.marks.best).toBe(2);
  });

  it("counts nothing for a game that has not been analysed", () => {
    // An unanalysed game has move rows with a null classification. Those must
    // not land in any bucket, or an unreviewed game reads as a flawless one.
    seed({ id: "g1" });
    db.insert(moves)
      .values({
        gameId: "g1",
        ply: 1,
        user: "alice",
        timeClass: "blitz",
        isUserMove: true,
        color: "w",
        fenBefore: "fen",
        san: "e4",
        uci: "e2e4",
        piece: "p",
      })
      .run();

    const [row] = listGames(db, "alice");

    expect(Object.values(row!.marks).every((n) => n === 0)).toBe(true);
  });

  it("does not borrow the other player's marks on a shared game", () => {
    // One chess.com game is two rows when both players are tracked. Counting
    // by game alone would merge both perspectives into each.
    seed({ id: "shared", user: "alice" });
    seed({ id: "shared", user: "bob" });
    seedMove("shared", 1, "best", { user: "alice" });
    seedMove("shared", 2, "blunder", { user: "bob" });

    expect(listGames(db, "alice")[0]!.marks.best).toBe(1);
    expect(listGames(db, "alice")[0]!.marks.blunder).toBe(0);
    expect(listGames(db, "bob")[0]!.marks.blunder).toBe(1);
  });
});
