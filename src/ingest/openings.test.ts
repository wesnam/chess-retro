import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDb, type Db } from "@/db/client";
import { games, openings } from "@/db/schema";
import {
  familyOf,
  importOpenings,
  loadOpeningLines,
  matchOpening,
  parseOpeningTsv,
  uciPrefixOf,
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

describe("uciPrefixOf", () => {
  it("converts a SAN line into a UCI move sequence", () => {
    expect(uciPrefixOf("1. e4 c5 2. Nf3")).toBe("e2e4 c7c5 g1f3");
  });

  it("handles a line with no move numbers", () => {
    expect(uciPrefixOf("e4 e5")).toBe("e2e4 e7e5");
  });

  it("returns undefined for a line it cannot replay", () => {
    // A malformed row must not become an opening keyed on nonsense.
    expect(uciPrefixOf("1. e4 Qxz9")).toBeUndefined();
  });

  it("encodes a promotion", () => {
    // The suffix matters: without it two different promotions share a key.
    const line = "1. a4 b5 2. axb5 Nf6 3. b6 Ng8 4. bxa7 Nf6 5. axb8=Q";
    expect(uciPrefixOf(line)?.endsWith("a7b8q")).toBe(true);
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

  it("derives the uci prefix, family and ply count", () => {
    const [, closed] = parseOpeningTsv(TSV);
    expect(closed).toMatchObject({
      uciPrefix: "e2e4 c7c5 b1c3",
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
  const LINES = [
    { uciPrefix: "e2e4 c7c5", eco: "B20", name: "Sicilian Defense", family: "Sicilian Defense", plyCount: 2 },
    { uciPrefix: "e2e4 c7c5 b1c3", eco: "B23", name: "Sicilian Defense: Closed", family: "Sicilian Defense", plyCount: 3 },
    { uciPrefix: "e2e4 e7e5", eco: "C20", name: "King's Pawn Game", family: "King's Pawn Game", plyCount: 2 },
  ];

  const index = new Map(LINES.map((l) => [l.uciPrefix, l]));

  it("picks the longest matching prefix, not the first", () => {
    // The deepest match wins — otherwise every Sicilian is just "Sicilian
    // Defense" and the variation is thrown away.
    const match = matchOpening(["e2e4", "c7c5", "b1c3", "d7d6"], index);
    expect(match?.name).toBe("Sicilian Defense: Closed");
  });

  it("falls back to the shorter line when the deep one does not match", () => {
    const match = matchOpening(["e2e4", "c7c5", "g1f3"], index);
    expect(match?.name).toBe("Sicilian Defense");
  });

  it("does not match a line that merely shares a first move", () => {
    // A shorter line is a false match unless it is a genuine PREFIX. 1.e4 e5
    // must never be labelled a Sicilian just because both start 1.e4.
    const match = matchOpening(["e2e4", "e7e5"], index);
    expect(match?.name).toBe("King's Pawn Game");
  });

  it("returns undefined when nothing matches", () => {
    expect(matchOpening(["d2d4", "d7d5"], index)).toBeUndefined();
  });

  it("returns undefined for a game with no moves", () => {
    expect(matchOpening([], index)).toBeUndefined();
  });

  it("matches a game shorter than the deepest known line", () => {
    expect(matchOpening(["e2e4", "c7c5"], index)?.name).toBe("Sicilian Defense");
  });
});

describe("importOpenings", () => {
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

describe("labelGames", () => {
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

describe("the bundled dataset", () => {
  it("groups thousands of lines into a usable number of families", () => {
    // The whole point for the weakness dashboard: per-variation groups are
    // near-unique per game, so the family is what makes the opening
    // dimension rankable at all.
    const lines = loadOpeningLines();
    const families = new Set(lines.map((l) => l.family));

    expect(lines.length).toBeGreaterThan(3000);
    expect(families.size).toBeLessThan(400);
    expect(families.has("Sicilian Defense")).toBe(true);
  });

  it("has no duplicate uci prefixes, so the key is unambiguous", () => {
    const lines = loadOpeningLines();
    const prefixes = new Set(lines.map((l) => l.uciPrefix));
    expect(prefixes.size).toBe(lines.length);
  });
});
