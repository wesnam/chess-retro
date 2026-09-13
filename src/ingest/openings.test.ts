import { describe, it, expect, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDb, type Db } from "@/db/client";
import { games, openings } from "@/db/schema";
import {
  familyOf,
  gamePositionKeys,
  importOpenings,
  lineEndPosition,
  loadOpeningLines,
  matchOpening,
  parseOpeningTsv,
  positionKey,
  labelGames,
} from "./openings";

const tempDirs: string[] = [];

function tempDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chess-retro-openings-"));
  tempDirs.push(dir);
  return createDb(path.join(dir, "test.db"));
}

afterEach(() => {
  let dir: string | undefined;
  while ((dir = tempDirs.pop())) fs.rmSync(dir, { recursive: true, force: true });
});

describe("familyOf", () => {
  it("takes the part before the first colon", () => {
    expect(familyOf("Sicilian Defense: Najdorf Variation")).toBe(
      "Sicilian Defense",
    );
  });

  it("keeps a name that has no colon", () => {
    expect(familyOf("Nimzowitsch-Larsen Attack")).toBe(
      "Nimzowitsch-Larsen Attack",
    );
  });

  it("splits on the FIRST colon only", () => {
    // Some names carry more than one, and the family is the outermost.
    expect(familyOf("Ruy Lopez: Morphy Defense: Modern Steinitz")).toBe(
      "Ruy Lopez",
    );
  });

  it("groups sibling variations under one family", () => {
    // The point of the family: the dashboard needs enough games per group to
    // say anything, and every exact variation is its own near-unique line.
    const names = [
      "Sicilian Defense: Closed",
      "Sicilian Defense: Najdorf Variation",
      "Sicilian Defense: Dragon Variation, Yugoslav Attack",
    ];
    expect(new Set(names.map(familyOf)).size).toBe(1);
  });
});

describe("positionKey", () => {
  it("drops the move counters so a position matches however it was reached", () => {
    // The halfmove clock and fullmove number differ between two routes to the
    // same position; keeping them would defeat the whole point.
    const a = "rnbqkbnr/ppp2ppp/4p3/3p4/3PP3/8/PPP2PPP/RNBQKBNR w KQkq - 0 3";
    const b = "rnbqkbnr/ppp2ppp/4p3/3p4/3PP3/8/PPP2PPP/RNBQKBNR w KQkq - 2 7";
    expect(positionKey(a)).toBe(positionKey(b));
  });

  it("keeps castling rights and the en-passant square", () => {
    // Two positions with the same pieces but different rights are genuinely
    // different positions and must not collapse together.
    const withRights = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    const without = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1";
    expect(positionKey(withRights)).not.toBe(positionKey(without));
  });
});

describe("lineEndPosition", () => {
  it("returns the position a SAN line reaches, and its length", () => {
    const result = lineEndPosition("1. e4 c5 2. Nf3");
    expect(result?.plyCount).toBe(3);
    expect(result?.key).toContain(" b "); // Black to move after three plies.
  });

  it("gives the same key for two move orders reaching one position", () => {
    // The behaviour the whole matcher rests on.
    const direct = lineEndPosition("1. e4 e6 2. d4 d5");
    const transposed = lineEndPosition("1. d4 e6 2. e4 d5");
    expect(direct?.key).toBe(transposed?.key);
  });

  it("handles a line with no move numbers", () => {
    expect(lineEndPosition("e4 e5")?.plyCount).toBe(2);
  });

  it("returns undefined for a line it cannot replay", () => {
    // A malformed row must not become an opening keyed on nonsense.
    expect(lineEndPosition("1. e4 Qxz9")).toBeUndefined();
  });

  it("returns undefined for an empty line", () => {
    expect(lineEndPosition("")).toBeUndefined();
  });
});

describe("parseOpeningTsv", () => {
  const TSV = [
    "eco\tname\tpgn",
    "B20\tSicilian Defense\t1. e4 c5",
    "B23\tSicilian Defense: Closed\t1. e4 c5 2. Nc3",
    "",
  ].join("\n");

  it("reads every data row and skips the header", () => {
    const rows = parseOpeningTsv(TSV);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ eco: "B20", name: "Sicilian Defense" });
  });

  it("derives the position key, family and ply count", () => {
    const [, closed] = parseOpeningTsv(TSV);
    expect(closed).toMatchObject({
      uciPrefix: lineEndPosition("1. e4 c5 2. Nc3")!.key,
      family: "Sicilian Defense",
      plyCount: 3,
    });
  });

  it("drops a row whose moves cannot be replayed", () => {
    const bad = ["eco\tname\tpgn", "A00\tNonsense\t1. e4 Zz9"].join("\n");
    expect(parseOpeningTsv(bad)).toEqual([]);
  });

  it("ignores blank and malformed lines rather than throwing", () => {
    const ragged = ["eco\tname\tpgn", "", "B20\tOnly two fields"].join("\n");
    expect(parseOpeningTsv(ragged)).toEqual([]);
  });
});

describe("matchOpening", () => {
  /** Build an index the way the importer does, from SAN lines. */
  function indexOf(entries: [san: string, eco: string, name: string][]) {
    const index = new Map<string, ReturnType<typeof parseOpeningTsv>[number]>();
    for (const [san, eco, name] of entries) {
      const position = lineEndPosition(san)!;
      index.set(position.key, {
        uciPrefix: position.key,
        eco,
        name,
        family: familyOf(name),
        plyCount: position.plyCount,
      });
    }
    return index;
  }

  const index = indexOf([
    // A one-ply line, so "merely shares a first move" is a real possibility
    // that the matcher has to reject on its own merits.
    ["1. e4", "B00", "King's Pawn Opening"],
    ["1. e4 c5", "B20", "Sicilian Defense"],
    ["1. e4 c5 2. Nc3", "B23", "Sicilian Defense: Closed"],
    ["1. e4 e5", "C20", "King's Pawn Game"],
    ["1. e4 e6 2. d4 d5", "C00", "French Defense"],
  ]);

  const keys = (pgn: string) => gamePositionKeys(pgn)!;

  it("picks the deepest matching line, not the first", () => {
    // Otherwise every Sicilian is just "Sicilian Defense" and the variation
    // is thrown away.
    const match = matchOpening(keys("1. e4 c5 2. Nc3 d6"), index);
    expect(match?.name).toBe("Sicilian Defense: Closed");
  });

  it("falls back to the shallower line when the deep one does not match", () => {
    const match = matchOpening(keys("1. e4 c5 2. Nf3"), index);
    expect(match?.name).toBe("Sicilian Defense");
  });

  it("does not take a shallower line when a deeper one fits", () => {
    // The false-match case the ticket asks for. "1. e4" IS in the index and
    // every one of these games passes through it, so a matcher that stopped
    // at the first hit would label all of them "King's Pawn Opening".
    expect(matchOpening(keys("1. e4 e5"), index)?.name).toBe("King's Pawn Game");
    expect(matchOpening(keys("1. e4 c5"), index)?.name).toBe("Sicilian Defense");
  });

  it("recognises a line reached by transposition", () => {
    // The defect this matcher exists to avoid. A French Defense played
    // 1.d4 e6 2.e4 d5 shares no move prefix with 1.e4 e6 2.d4 d5, and keying
    // on moves labelled it "Horwitz Defense" — a different opening entirely.
    const transposed = matchOpening(keys("1. d4 e6 2. e4 d5"), index);
    expect(transposed?.name).toBe("French Defense");
  });

  it("still matches the direct move order", () => {
    expect(matchOpening(keys("1. e4 e6 2. d4 d5"), index)?.name).toBe(
      "French Defense",
    );
  });

  it("returns undefined when nothing matches", () => {
    expect(matchOpening(keys("1. d4 d5"), index)).toBeUndefined();
  });

  it("returns undefined for a game with no moves", () => {
    expect(matchOpening([], index)).toBeUndefined();
  });
});

// Every test here imports the real 3,800-line dataset, which costs about a
// second to replay through chess.js; the two that import twice cost two. That
// fits in the 5s default on a dev machine but not on a CI runner, so the whole
// suite gets the headroom rather than the two tests that happen to exceed it
// today.
describe("importOpenings", { timeout: 30_000 }, () => {
  it("loads the bundled dataset into the database", () => {
    const db = tempDb();
    const count = importOpenings(db);

    expect(count).toBeGreaterThan(3000);

    const rows = db.select().from(openings).all();
    expect(rows.length).toBe(count);
  });

  it("is idempotent: importing twice does not duplicate rows", () => {
    const db = tempDb();
    const first = importOpenings(db);
    const second = importOpenings(db);

    expect(second).toBe(first);
    expect(db.select().from(openings).all().length).toBe(first);
  });

  it("skips the work entirely once the table is complete", () => {
    // Parsing replays 3,800 SAN lines through chess.js, about a second. Paid
    // on every boot for a table that has not changed, that is a second of
    // startup for nothing.
    const db = tempDb();
    importOpenings(db);

    const started = Date.now();
    importOpenings(db);
    expect(Date.now() - started).toBeLessThan(200);
  });

  it("re-imports when the stored table is incomplete", () => {
    // Skipping on "some rows exist" would leave a half-finished import in
    // place forever — a crash mid-transaction must be recoverable.
    const db = tempDb();
    const full = importOpenings(db);

    db.delete(openings).where(sql`rowid % 2 = 0`).run();
    const remaining = db.select().from(openings).all().length;
    expect(remaining).toBeLessThan(full);

    expect(importOpenings(db)).toBe(full);
    expect(db.select().from(openings).all().length).toBe(full);
  });

  it("re-imports on request even when complete", () => {
    const db = tempDb();
    importOpenings(db);
    db.update(openings).set({ name: "wrong" }).run();

    importOpenings(db, { force: true });

    const names = db.select().from(openings).all().map((r) => r.name);
    expect(names.every((n) => n === "wrong")).toBe(false);
  });

  it("stores the family alongside the full name", () => {
    const db = tempDb();
    importOpenings(db);

    const row = db
      .select()
      .from(openings)
      .all()
      .find((r) => r.name.startsWith("Sicilian Defense:"));

    expect(row?.family).toBe("Sicilian Defense");
  });
});

// Same dataset cost as importOpenings above: each test imports it once.
describe("labelGames", { timeout: 30_000 }, () => {
  function seedGame(db: Db, id: string, pgn: string): void {
    db.insert(games)
      .values({
        id,
        user: "alice",
        pgn,
        timeClass: "blitz",
        userColor: "w",
        userResult: "win",
        endTime: 1,
      })
      .run();
  }

  const SICILIAN_CLOSED = `[Event "x"]

1. e4 c5 2. Nc3 d6 3. g3 Nc6 1-0`;

  it("labels an existing game from its moves", () => {
    // Games already downloaded must get names too, not only new ones.
    const db = tempDb();
    importOpenings(db);
    seedGame(db, "g1", SICILIAN_CLOSED);

    expect(labelGames(db, "alice")).toBe(1);

    const row = db.select().from(games).all().at(0);
    expect(row?.openingFamily).toBe("Sicilian Defense");
    expect(row?.openingName).toContain("Sicilian Defense:");
    expect(row?.eco).toBeTruthy();
  });

  it("leaves a game it cannot name visible and unlabelled", () => {
    // Every legal first move is in the dataset, so an unmatched game means an
    // unreadable PGN rather than an exotic opening. Either way the row must
    // survive: a game vanishing from the list because it has no name would be
    // far worse than a blank cell.
    const db = tempDb();
    importOpenings(db);
    seedGame(db, "g1", "not a pgn at all");

    expect(labelGames(db, "alice")).toBe(0);

    const row = db.select().from(games).all().at(0);
    expect(row?.openingName ?? null).toBeNull();
    expect(row?.id).toBe("g1");
  });

  it("names even the most obscure legal opening", () => {
    // The dataset covers all twenty first moves, so a real game always gets a
    // name. Worth pinning: an empty list would otherwise look like success.
    const db = tempDb();
    importOpenings(db);
    seedGame(db, "g1", `[Event "x"]\n\n1. Nh3 Nh6 2. Ng1 Ng8 1-0`);

    expect(labelGames(db, "alice")).toBe(1);
    expect(db.select().from(games).all().at(0)?.openingName).toBeTruthy();
  });

  it("skips games already labelled unless asked to redo them", () => {
    const db = tempDb();
    importOpenings(db);
    seedGame(db, "g1", SICILIAN_CLOSED);

    expect(labelGames(db, "alice")).toBe(1);
    expect(labelGames(db, "alice")).toBe(0);
    expect(labelGames(db, "alice", { relabelAll: true })).toBe(1);
  });

  it("replaces a name left by the chess.com stopgap", () => {
    // The ECOUrl fallback produced families like "Nimzowitsch Larsen Attack
    // Classical Variation", which are per-game and useless for grouping.
    const db = tempDb();
    importOpenings(db);
    seedGame(db, "g1", SICILIAN_CLOSED);
    db.update(games)
      .set({
        openingName: "Sicilian Defense 2.Nc3 d6",
        openingFamily: "Sicilian Defense 2.Nc3 d6",
      })
      .run();

    labelGames(db, "alice", { relabelAll: true });

    const row = db.select().from(games).all().at(0);
    expect(row?.openingFamily).toBe("Sicilian Defense");
  });

  it("touches only the named user's games", () => {
    const db = tempDb();
    importOpenings(db);
    seedGame(db, "g1", SICILIAN_CLOSED);

    expect(labelGames(db, "someone-else")).toBe(0);
  });
});

/**
 * Measured from the vendored dataset. Asserted exactly so a parser change
 * that silently drops rows fails rather than passing a loose bound.
 */
const BUNDLED_LINE_COUNT = 3810;
const BUNDLED_FAMILY_COUNT = 149;

describe("the bundled dataset", () => {
  it("groups thousands of lines into a usable number of families", () => {
    // The whole point for the weakness dashboard: per-variation groups are
    // near-unique per game, so the family is what makes the opening
    // dimension rankable at all.
    const lines = loadOpeningLines();
    const families = new Set(lines.map((l) => l.family));

    // Exact, not a loose floor: every one of the bundled rows parses, so any
    // row silently dropped by a parser change is a regression. A `> 3000`
    // bound would let 800 disappear unnoticed.
    expect(lines.length).toBe(BUNDLED_LINE_COUNT);
    expect(families.size).toBe(BUNDLED_FAMILY_COUNT);
    expect(families.has("Sicilian Defense")).toBe(true);
  });

  it("has no duplicate uci prefixes, so the key is unambiguous", () => {
    const lines = loadOpeningLines();
    const prefixes = new Set(lines.map((l) => l.uciPrefix));
    expect(prefixes.size).toBe(lines.length);
  });
});
