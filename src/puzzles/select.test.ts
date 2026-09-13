import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDb, type Db } from "@/db/client";
import { games, puzzleAttempts, puzzles, puzzleThemes } from "@/db/schema";
import {
  DEFAULT_RATING,
  RATING_BAND,
  playerRating,
  recordAttempt,
  selectPuzzles,
  themeProgress,
} from "./select";
import { MIN_POPULARITY } from "./parse";

/**
 * Selection against a real database: the filters ARE SQL, so a mocked store
 * would test nothing that ships.
 */

const tempDirs: string[] = [];

function tempDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chess-retro-puzzles-"));
  tempDirs.push(dir);
  return createDb(path.join(dir, "test.db"));
}

afterEach(() => {
  let dir: string | undefined;
  while ((dir = tempDirs.pop())) fs.rmSync(dir, { recursive: true, force: true });
});

const FEN = "r6k/pp2r2p/4Rp1Q/3p4/8/1N1P2R1/PqP2bPP/7K b - - 0 24";

function seedPuzzle(
  db: Db,
  options: {
    id: string;
    rating: number;
    popularity?: number;
    themes: string[];
  },
): void {
  db.insert(puzzles)
    .values({
      id: options.id,
      fen: FEN,
      movesUci: "f2g3 e6e7",
      rating: options.rating,
      popularity: options.popularity ?? 95,
    })
    .run();

  for (const theme of options.themes) {
    db.insert(puzzleThemes).values({ puzzleId: options.id, theme }).run();
  }
}

function seedGame(
  db: Db,
  options: {
    id: string;
    user?: string;
    timeClass?: string;
    rating: number | null;
    endTime: number;
  },
): void {
  db.insert(games)
    .values({
      id: options.id,
      user: options.user ?? "alice",
      pgn: "1. e4 e5",
      timeClass: options.timeClass ?? "rapid",
      userColor: "w",
      userResult: "win",
      userRating: options.rating,
      endTime: options.endTime,
    })
    .run();
}

describe("playerRating", () => {
  /**
   * Rating is per time control, and the most recent game is the honest answer:
   * a corpus stretching back a year averages in a player the person no longer
   * is.
   */
  it("takes the rating from the most recent game in that control", () => {
    const db = tempDb();
    seedGame(db, { id: "g1", rating: 900, endTime: 1000 });
    seedGame(db, { id: "g2", rating: 1200, endTime: 2000 });

    expect(playerRating(db, { user: "alice", timeClass: "rapid" })).toBe(1200);
  });

  it("never reads another control's rating", () => {
    const db = tempDb();
    seedGame(db, { id: "g1", rating: 900, endTime: 1000 });
    // More recent, but blitz — a different rating for a different game.
    seedGame(db, { id: "g2", rating: 2400, timeClass: "blitz", endTime: 2000 });

    expect(playerRating(db, { user: "alice", timeClass: "rapid" })).toBe(900);
  });

  it("skips games with no recorded rating rather than returning null", () => {
    const db = tempDb();
    seedGame(db, { id: "g1", rating: 900, endTime: 1000 });
    seedGame(db, { id: "g2", rating: null, endTime: 2000 });

    expect(playerRating(db, { user: "alice", timeClass: "rapid" })).toBe(900);
  });

  it("is undefined when nothing is known", () => {
    const db = tempDb();
    expect(
      playerRating(db, { user: "alice", timeClass: "rapid" }),
    ).toBeUndefined();
  });
});

describe("selectPuzzles", () => {
  it("returns only puzzles carrying the requested theme", () => {
    const db = tempDb();
    seedPuzzle(db, { id: "a", rating: 1000, themes: ["fork"] });
    seedPuzzle(db, { id: "b", rating: 1000, themes: ["pin"] });

    const found = selectPuzzles(db, {
      user: "alice",
      theme: "fork",
      rating: 1000,
    });

    expect(found.map((p) => p.id)).toEqual(["a"]);
  });

  /**
   * The band is the point of the feature: puzzles far above a player's rating
   * are hopeless and far below teach nothing.
   */
  it("keeps puzzles inside the rating band and drops those outside", () => {
    const db = tempDb();
    seedPuzzle(db, { id: "inside", rating: 1000, themes: ["fork"] });
    seedPuzzle(db, {
      id: "too-hard",
      rating: 1000 + RATING_BAND + 50,
      themes: ["fork"],
    });
    seedPuzzle(db, {
      id: "too-easy",
      rating: 1000 - RATING_BAND - 50,
      themes: ["fork"],
    });

    const found = selectPuzzles(db, {
      user: "alice",
      theme: "fork",
      rating: 1000,
    });

    expect(found.map((p) => p.id)).toEqual(["inside"]);
  });

  it("excludes unpopular puzzles", () => {
    const db = tempDb();
    seedPuzzle(db, { id: "good", rating: 1000, themes: ["fork"] });
    seedPuzzle(db, {
      id: "disliked",
      rating: 1000,
      popularity: MIN_POPULARITY - 1,
      themes: ["fork"],
    });

    const found = selectPuzzles(db, {
      user: "alice",
      theme: "fork",
      rating: 1000,
    });

    expect(found.map((p) => p.id)).toEqual(["good"]);
  });

  /**
   * Serving a puzzle someone has already seen measures their memory, not their
   * tactics — and the attempt history is how improvement is read later.
   */
  it("excludes puzzles this player has already attempted", () => {
    const db = tempDb();
    seedPuzzle(db, { id: "fresh", rating: 1000, themes: ["fork"] });
    seedPuzzle(db, { id: "seen", rating: 1000, themes: ["fork"] });
    recordAttempt(db, {
      user: "alice",
      puzzleId: "seen",
      solved: true,
      theme: "fork",
    });

    const found = selectPuzzles(db, {
      user: "alice",
      theme: "fork",
      rating: 1000,
    });

    expect(found.map((p) => p.id)).toEqual(["fresh"]);
  });

  it("does not hide a puzzle because someone else attempted it", () => {
    const db = tempDb();
    seedPuzzle(db, { id: "p1", rating: 1000, themes: ["fork"] });
    recordAttempt(db, {
      user: "bob",
      puzzleId: "p1",
      solved: true,
      theme: "fork",
    });

    const found = selectPuzzles(db, {
      user: "alice",
      theme: "fork",
      rating: 1000,
    });

    expect(found.map((p) => p.id)).toEqual(["p1"]);
  });

  /**
   * A player with no rated games still gets puzzles. Without a fallback the
   * band would be built around `undefined` and the first session — the one
   * where a person decides whether this is worth using — would be empty.
   */
  it("falls back to a default rating when the player has none", () => {
    const db = tempDb();
    seedPuzzle(db, { id: "mid", rating: DEFAULT_RATING, themes: ["fork"] });
    seedPuzzle(db, {
      id: "far",
      rating: DEFAULT_RATING + RATING_BAND + 100,
      themes: ["fork"],
    });

    const found = selectPuzzles(db, { user: "alice", theme: "fork" });
    expect(found.map((p) => p.id)).toEqual(["mid"]);
  });

  it("honours the requested limit", () => {
    const db = tempDb();
    for (let i = 0; i < 10; i += 1) {
      seedPuzzle(db, { id: `p${i}`, rating: 1000, themes: ["fork"] });
    }

    const found = selectPuzzles(db, {
      user: "alice",
      theme: "fork",
      rating: 1000,
      limit: 3,
    });

    expect(found).toHaveLength(3);
  });

  /**
   * Two visits to the same weakness should not drill the same ten puzzles in
   * the same order, so selection is randomised — but it must stay inside every
   * filter while doing it.
   */
  it("varies the set it returns without leaving the band", () => {
    const db = tempDb();
    for (let i = 0; i < 40; i += 1) {
      seedPuzzle(db, { id: `p${i}`, rating: 950 + i, themes: ["fork"] });
    }

    const runs = new Set<string>();
    for (let run = 0; run < 8; run += 1) {
      const found = selectPuzzles(db, {
        user: "alice",
        theme: "fork",
        rating: 1000,
        limit: 5,
      });
      for (const puzzle of found) {
        expect(Math.abs(puzzle.rating - 1000)).toBeLessThanOrEqual(RATING_BAND);
      }
      runs.add(found.map((p) => p.id).join(","));
    }

    expect(runs.size).toBeGreaterThan(1);
  });

  /**
   * `NOT IN (subquery)` against an empty set is a classic SQL footgun, and an
   * empty attempts table is the state every new player is in — if this breaks,
   * the feature serves nothing to anybody on their first visit.
   */
  it("serves puzzles when the player has attempted nothing at all", () => {
    const db = tempDb();
    seedPuzzle(db, { id: "a", rating: 1000, themes: ["fork"] });

    expect(
      selectPuzzles(db, { user: "alice", theme: "fork", rating: 1000 }),
    ).toHaveLength(1);
  });

  /**
   * Themes are a separate table joined one-to-many, so a puzzle tagged with
   * four themes must not come back four times and fill a session with one
   * position repeated.
   */
  it("returns a puzzle once however many themes it carries", () => {
    const db = tempDb();
    seedPuzzle(db, {
      id: "a",
      rating: 1000,
      themes: ["fork", "endgame", "short", "crushing"],
    });

    expect(
      selectPuzzles(db, { user: "alice", theme: "fork", rating: 1000 }),
    ).toHaveLength(1);
  });

  it("carries the whole line, so the puzzle can be played offline", () => {
    const db = tempDb();
    seedPuzzle(db, { id: "a", rating: 1000, themes: ["fork"] });

    const [puzzle] = selectPuzzles(db, {
      user: "alice",
      theme: "fork",
      rating: 1000,
    });

    expect(puzzle).toMatchObject({
      id: "a",
      fen: FEN,
      movesUci: "f2g3 e6e7",
      rating: 1000,
    });
  });
});

describe("recordAttempt and themeProgress", () => {
  it("counts solved and failed attempts per theme", () => {
    const db = tempDb();
    seedPuzzle(db, { id: "a", rating: 1000, themes: ["fork"] });
    seedPuzzle(db, { id: "b", rating: 1000, themes: ["fork"] });
    seedPuzzle(db, { id: "c", rating: 1000, themes: ["pin"] });

    recordAttempt(db, { user: "alice", puzzleId: "a", solved: true, theme: "fork" });
    recordAttempt(db, { user: "alice", puzzleId: "b", solved: false, theme: "fork" });
    recordAttempt(db, { user: "alice", puzzleId: "c", solved: true, theme: "pin" });

    expect(themeProgress(db, { user: "alice", theme: "fork" })).toEqual({
      attempted: 2,
      solved: 1,
    });
  });

  it("keeps one player's progress out of another's", () => {
    const db = tempDb();
    seedPuzzle(db, { id: "a", rating: 1000, themes: ["fork"] });
    recordAttempt(db, { user: "bob", puzzleId: "a", solved: true, theme: "fork" });

    expect(themeProgress(db, { user: "alice", theme: "fork" })).toEqual({
      attempted: 0,
      solved: 0,
    });
  });

  /**
   * Recorded against the theme it was SERVED for, not the puzzle's full theme
   * list. A fork puzzle also tagged `endgame` was drilled as a fork, and
   * reading progress any other way would credit practice never done.
   */
  it("records the theme the puzzle was served for", () => {
    const db = tempDb();
    seedPuzzle(db, { id: "a", rating: 1000, themes: ["fork", "endgame"] });
    recordAttempt(db, { user: "alice", puzzleId: "a", solved: true, theme: "fork" });

    expect(themeProgress(db, { user: "alice", theme: "endgame" })).toEqual({
      attempted: 0,
      solved: 0,
    });
  });
});
