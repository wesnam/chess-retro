import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDb, type Db } from "@/db/client";
import { games, moveMotifs, moves } from "@/db/schema";
import { weaknessReport } from "./report";
import { corpusBaseline, motifCandidates, timeCandidates } from "./queries";

/**
 * The highest seam available: a report built from a seeded database, covering
 * the queries, the scoring and the evidence lookup together.
 */

const tempDirs: string[] = [];

function tempDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chess-retro-report-"));
  tempDirs.push(dir);
  return createDb(path.join(dir, "test.db"));
}

afterEach(() => {
  let dir: string | undefined;
  while ((dir = tempDirs.pop())) fs.rmSync(dir, { recursive: true, force: true });
});

const FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

type MoveSpec = {
  ply: number;
  drop: number;
  piece?: string;
  phase?: string;
  clockMs?: number;
  classification?: string;
  motif?: { motif: string; role: string };
};

/**
 * Seed moves for one player, spread across several games.
 *
 * Spread rather than piled into one game because a weakness confined to a
 * single game is an event rather than a pattern, and the ranking excludes it
 * by design. Real corpora have each theme recurring across games, and a
 * fixture that does not would only ever test the suppression path.
 */
function seedGames(
  db: Db,
  options: {
    id: string;
    user?: string;
    timeClass?: string;
    openingFamily?: string;
    /** How many games to spread the moves over. */
    across?: number;
    moves: MoveSpec[];
  },
): void {
  const user = options.user ?? "alice";
  const timeClass = options.timeClass ?? "blitz";
  const across = options.across ?? 4;

  const gameId = (n: number) => `${options.id}-${n}`;

  for (let n = 0; n < across; n += 1) {
    db.insert(games)
      .values({
        id: gameId(n),
        user,
        pgn: "[pgn]",
        timeClass,
        userColor: "w",
        userResult: "loss",
        endTime: 1_700_000_000 + n,
        openingFamily: options.openingFamily ?? "Sicilian Defense",
        opponentUsername: "bob",
        analysisStatus: "done",
      })
      .run();
  }

  for (const [index, spec] of options.moves.entries()) {
    const before = 60;
    // Round-robin, so every theme appears in every game rather than each
    // game holding a contiguous block of one theme.
    const id = gameId(index % across);

    db.insert(moves)
      .values({
        gameId: id,
        ply: spec.ply,
        user,
        timeClass,
        isUserMove: true,
        color: "w",
        fenBefore: FEN,
        san: "e4",
        uci: "e2e4",
        piece: spec.piece ?? "p",
        phase: spec.phase ?? "middlegame",
        clockMs: spec.clockMs ?? 120_000,
        winPctBefore: before,
        winPctAfter: before - spec.drop,
        classification: spec.classification ?? "good",
      })
      .run();

    if (spec.motif) {
      db.insert(moveMotifs)
        .values({
          gameId: id,
          ply: spec.ply,
          user,
          timeClass,
          motif: spec.motif.motif,
          role: spec.motif.role,
        })
        .run();
    }
  }
}

/** A run of moves, every one carrying the same motif in the same role. */
function motifMoves(
  count: number,
  drop: number,
  motif: string,
  role: string,
  startPly = 1,
): MoveSpec[] {
  return Array.from({ length: count }, (_, i) => ({
    ply: startPly + i,
    drop,
    motif: { motif, role },
  }));
}

/**
 * Clean moves, carrying no motif and costing nothing.
 *
 * Every dimension partitions the same moves, so a corpus where each one costs
 * the same amount has every candidate sitting exactly at the baseline and
 * nothing can rank. Real play is mostly unremarkable moves with the damage
 * concentrated in a few, and the fixtures have to reflect that or they test a
 * corpus that cannot exist.
 */
function quietMoves(count: number, startPly: number): MoveSpec[] {
  return Array.from({ length: count }, (_, i) => ({
    ply: startPly + i,
    drop: 0,
    classification: "best",
  }));
}

describe("weaknessReport", () => {
  it("ranks a costly motif above a cheap one", () => {
    const db = tempDb();
    seedGames(db, {
      id: "g1",
      moves: [
        ...motifMoves(12, 18, "fork", "missed", 1),
        ...motifMoves(12, 1, "pin", "missed", 20),
        ...quietMoves(60, 100),
      ],
    });

    const report = weaknessReport(db, { user: "alice", timeClass: "blitz" });

    expect(report.weaknesses[0]?.key).toBe("fork");
  });

  it("never mixes time controls", () => {
    // The load-bearing filter: a blitz problem and a rapid problem are
    // different problems, and averaging them describes nobody.
    const db = tempDb();
    seedGames(db, {
      id: "blitz-game",
      timeClass: "blitz",
      moves: [...motifMoves(12, 20, "fork", "missed"), ...quietMoves(40, 100)],
    });
    seedGames(db, {
      id: "rapid-game",
      timeClass: "rapid",
      moves: [...motifMoves(12, 20, "skewer", "missed"), ...quietMoves(40, 100)],
    });

    const blitz = weaknessReport(db, { user: "alice", timeClass: "blitz" });
    const keys = blitz.weaknesses.map((w) => w.key);

    expect(keys).toContain("fork");
    expect(keys).not.toContain("skewer");
  });

  it("never mixes users", () => {
    const db = tempDb();
    seedGames(db, {
      id: "hers",
      user: "alice",
      moves: [...motifMoves(12, 20, "fork", "missed"), ...quietMoves(40, 100)],
    });
    seedGames(db, {
      id: "his",
      user: "bob",
      moves: [...motifMoves(12, 20, "skewer", "missed"), ...quietMoves(40, 100)],
    });

    const report = weaknessReport(db, { user: "alice", timeClass: "blitz" });

    expect(report.weaknesses.map((w) => w.key)).not.toContain("skewer");
  });

  it("suppresses a weakness with too little evidence and says so", () => {
    const db = tempDb();
    seedGames(db, {
      id: "g1",
      moves: [
        // Three sightings of a disaster: not enough to call it a pattern.
        ...motifMoves(3, 40, "fork", "missed", 1),
        ...motifMoves(12, 6, "pin", "missed", 10),
        ...quietMoves(40, 100),
      ],
    });

    const report = weaknessReport(db, { user: "alice", timeClass: "blitz" });

    expect(report.weaknesses.map((w) => w.key)).not.toContain("fork");
    expect(report.suppressed).toBeGreaterThan(0);
  });

  it("attaches real example positions to each weakness", () => {
    const db = tempDb();
    seedGames(db, {
      id: "g1",
      moves: [...motifMoves(12, 15, "fork", "missed"), ...quietMoves(40, 100)],
    });

    const [top] = weaknessReport(db, { user: "alice", timeClass: "blitz" })
      .weaknesses;

    expect(top?.examples.length).toBeGreaterThan(0);
    for (const example of top!.examples) {
      expect(example.gameId).toMatch(/^g1-\d+$/);
      expect(example.ply).toBeGreaterThan(0);
      expect(example.fenBefore).toBe(FEN);
    }
  });

  it("puts the worst example first, so the evidence leads with its strongest case", () => {
    const db = tempDb();
    seedGames(db, {
      id: "g1",
      moves: [
        ...motifMoves(11, 5, "fork", "missed", 1),
        { ply: 50, drop: 40, motif: { motif: "fork", role: "missed" } },
        ...quietMoves(40, 100),
      ],
    });

    const [top] = weaknessReport(db, { user: "alice", timeClass: "blitz" })
      .weaknesses;

    expect(top?.examples[0]?.ply).toBe(50);
  });

  it("reports opportunities, failures, rate and cost for each weakness", () => {
    const db = tempDb();
    seedGames(db, {
      id: "g1",
      moves: [
        // Ten chances at the motif, four of them missed.
        ...motifMoves(4, 20, "fork", "missed", 1),
        ...motifMoves(6, 0, "fork", "played", 10),
        ...quietMoves(40, 100),
      ],
    });

    const [top] = weaknessReport(db, { user: "alice", timeClass: "blitz" })
      .weaknesses;

    expect(top?.opportunities).toBe(10);
    expect(top?.failures).toBe(4);
    expect(top?.failureRate).toBeCloseTo(0.4, 6);
    expect(top?.winPctLost).toBeCloseTo(80, 6);
  });

  it("counts what it suppressed, so an empty dashboard can say why", () => {
    // A small corpus legitimately produces no weakness at all. Saying nothing
    // would read as "you have none", which is never the finding — the honest
    // message is that there is not yet enough evidence to tell one from noise.
    const db = tempDb();
    seedGames(db, {
      id: "g1",
      across: 1,
      moves: [...motifMoves(4, 30, "fork", "missed"), ...quietMoves(20, 100)],
    });

    const report = weaknessReport(db, { user: "alice", timeClass: "blitz" });

    expect(report.weaknesses).toEqual([]);
    expect(report.suppressed).toBeGreaterThan(0);
    expect(report.analysedMoves).toBeGreaterThan(0);
  });

  it("returns nothing rather than noise on an unanalysed corpus", () => {
    const db = tempDb();
    const report = weaknessReport(db, { user: "nobody", timeClass: "blitz" });

    expect(report.weaknesses).toEqual([]);
    expect(report.analysedMoves).toBe(0);
  });

  it("limits the dashboard to the top few weaknesses", () => {
    const db = tempDb();
    seedGames(db, {
      id: "g1",
      moves: [
        ...motifMoves(12, 20, "fork", "missed", 1),
        ...motifMoves(12, 15, "pin", "missed", 20),
        ...motifMoves(12, 12, "skewer", "missed", 40),
        ...motifMoves(12, 10, "deflection", "missed", 60),
        ...quietMoves(80, 100),
      ],
    });

    const report = weaknessReport(db, { user: "alice", timeClass: "blitz" }, { limit: 3 });

    expect(report.weaknesses).toHaveLength(3);
  });
});

describe("dimension queries", () => {
  it("counts motif exposure across every role, not just missed", () => {
    // Counting only missed tags in both numerator and denominator would make
    // every failure rate exactly 1 and every motif look equally bad.
    const db = tempDb();
    seedGames(db, {
      id: "g1",
      moves: [
        ...motifMoves(3, 20, "fork", "missed", 1),
        ...motifMoves(7, 0, "fork", "played", 10),
      ],
    });

    const [fork] = motifCandidates(db, { user: "alice", timeClass: "blitz" });

    expect(fork?.opportunities).toBe(10);
    expect(fork?.failures).toBe(3);
  });

  it("buckets time pressure by clock remaining", () => {
    const db = tempDb();
    seedGames(db, {
      id: "g1",
      moves: [
        { ply: 1, drop: 30, clockMs: 5_000, classification: "blunder" },
        { ply: 2, drop: 2, clockMs: 20_000 },
        { ply: 3, drop: 1, clockMs: 90_000 },
      ],
    });

    const buckets = timeCandidates(db, { user: "alice", timeClass: "blitz" });
    const byKey = new Map(buckets.map((b) => [b.key, b]));

    expect(byKey.get("scramble")?.opportunities).toBe(1);
    expect(byKey.get("scramble")?.failures).toBe(1);
    expect(byKey.get("low")?.opportunities).toBe(1);
    expect(byKey.get("comfortable")?.opportunities).toBe(1);
  });

  it("measures the baseline as cost per move over the whole corpus", () => {
    const db = tempDb();
    seedGames(db, {
      id: "g1",
      moves: [
        { ply: 1, drop: 10 },
        { ply: 2, drop: 0 },
        { ply: 3, drop: 2 },
        { ply: 4, drop: 0 },
      ],
    });

    expect(corpusBaseline(db, { user: "alice", timeClass: "blitz" })).toBeCloseTo(3, 6);
  });

  it("floors a win-probability gain at zero rather than crediting it", () => {
    // An engine can rate a position better after a move than before. That is
    // not negative cost, and letting it subtract would mask real errors.
    const db = tempDb();
    seedGames(db, {
      id: "g1",
      moves: [
        { ply: 1, drop: -20 },
        { ply: 2, drop: 10 },
      ],
    });

    expect(corpusBaseline(db, { user: "alice", timeClass: "blitz" })).toBeCloseTo(5, 6);
  });
});
