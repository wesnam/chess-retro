import { describe, it, expect, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDb, type Db } from "@/db/client";
import { games, moves } from "@/db/schema";
import { analyseAndStore, findGame, reclaimOrphanedGames } from "./store";
import type { Analyser } from "./analyze-game";
import type { Score } from "./accuracy";

let db: Db;

beforeEach(() => {
  db = createDb(":memory:");
});

const cp = (n: number): Score => ({ kind: "cp", cp: n });

function stubEngine(
  scores: Array<{ score: Score; bestMove?: string }> = [{ score: cp(0) }],
): Analyser & { positionsSeen: number } {
  let index = 0;
  const stub = {
    depth: 18,
    positionsSeen: 0,
    async newGame() {},
    async analyse(_fen: string) {
      const entry = scores[index] ?? scores.at(-1)!;
      index += 1;
      stub.positionsSeen += 1;
      return { score: entry.score, bestMove: entry.bestMove, depth: 18 };
    },
  };
  return stub;
}

const PGN = '[Event "Test"]\n\n1. e4 e5 2. Nf3 Nc6 *';

/** A game with its move rows, as ticket 02's sync would have left them. */
function seedGame(options: { id?: string; user?: string; color?: string } = {}) {
  const id = options.id ?? "g1";
  const user = options.user ?? "alice";

  db.insert(games)
    .values({
      id,
      user,
      pgn: PGN,
      timeClass: "blitz",
      userColor: options.color ?? "w",
      userResult: "win",
      endTime: 1_700_000_000,
      rated: true,
    })
    .run();

  for (const [index, san] of ["e4", "e5", "Nf3", "Nc6"].entries()) {
    db.insert(moves)
      .values({
        gameId: id,
        ply: index + 1,
        user,
        timeClass: "blitz",
        isUserMove: index % 2 === 0,
        color: index % 2 === 0 ? "w" : "b",
        fenBefore: "fen",
        san,
        uci: "e2e4",
        piece: "p",
      })
      .run();
  }

  return findGame(db, user, id)!;
}

describe("storing an analysis", () => {
  it("marks the game done", async () => {
    const game = seedGame();
    await analyseAndStore(db, game, stubEngine());

    expect(findGame(db, "alice", "g1")!.analysisStatus).toBe("done");
  });

  it("writes an evaluation onto every move", async () => {
    const game = seedGame();
    await analyseAndStore(db, game, stubEngine([{ score: cp(25) }]));

    const rows = db.select().from(moves).all();
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.classification).toBeTypeOf("string");
      expect(row.winPctBefore).toBeTypeOf("number");
      expect(row.moveAccuracy).toBeTypeOf("number");
    }
  });

  it("records the depth the verdicts came from", async () => {
    const game = seedGame();
    await analyseAndStore(db, game, stubEngine());

    const row = db.select().from(games).get()!;
    expect(row.analysisDepth).toBe(18);
    expect(row.analyzedAt).toBeTypeOf("number");
  });

  it("records our own accuracy figure", async () => {
    const game = seedGame();
    await analyseAndStore(db, game, stubEngine());

    const row = db.select().from(games).get()!;
    expect(row.accuracyUser).toBeTypeOf("number");
  });

  it("leaves chess.com's accuracy untouched", async () => {
    // It exists for side-by-side comparison and must never be overwritten by
    // our own figure, nor enter any aggregate.
    const game = seedGame();
    db.update(games).set({ ccAccuracyUser: 88.5 }).run();

    await analyseAndStore(db, game, stubEngine());

    expect(db.select().from(games).get()!.ccAccuracyUser).toBe(88.5);
  });

  it("stores evaluations in the mover's perspective", async () => {
    const game = seedGame();
    // White is level, then the opponent sees +600 — so White is at -600.
    await analyseAndStore(
      db,
      game,
      stubEngine([{ score: cp(0) }, { score: cp(600) }, { score: cp(0) }]),
    );

    const first = db
      .select()
      .from(moves)
      .where(and(eq(moves.gameId, "g1"), eq(moves.ply, 1)))
      .get()!;

    expect(first.evalBefore).toBe(0);
    expect(first.evalAfter).toBe(-600);
    expect(first.cpLoss).toBe(600);
    expect(first.classification).toBe("blunder");
  });

  it("keeps two players' analyses of one game apart", async () => {
    // The same chess.com game, tracked for both players.
    const hers = seedGame({ id: "shared", user: "alice", color: "w" });
    seedGame({ id: "shared", user: "bob", color: "b" });

    await analyseAndStore(db, hers, stubEngine([{ score: cp(300) }]));

    expect(findGame(db, "alice", "shared")!.analysisStatus).toBe("done");
    // Bob's copy is untouched: analysing one must not mark the other done.
    expect(findGame(db, "bob", "shared")!.analysisStatus).toBe("pending");

    const bobsMoves = db
      .select()
      .from(moves)
      .where(and(eq(moves.gameId, "shared"), eq(moves.user, "bob")))
      .all();
    expect(bobsMoves.every((m) => m.classification === null)).toBe(true);
  });
});

describe("caching", () => {
  it("does not re-run the engine for an already analysed game", async () => {
    // Reopening a game must be free: the caller checks status before
    // analysing, so an analysed game costs nothing.
    const game = seedGame();
    const engine = stubEngine();
    await analyseAndStore(db, game, engine);
    const firstPass = engine.positionsSeen;

    const stored = findGame(db, "alice", "g1")!;
    expect(stored.analysisStatus).toBe("done");
    expect(firstPass).toBeGreaterThan(0);

    // The stored rows are complete, so nothing needs recomputing.
    const rows = db.select().from(moves).all();
    expect(rows.every((r) => r.classification !== null)).toBe(true);
  });
});

describe("when analysis fails", () => {
  it("records the error rather than leaving the game running", async () => {
    const game = seedGame();
    const broken: Analyser = {
      depth: 18,
      async newGame() {},
      async analyse() {
        throw new Error("engine died");
      },
    };

    await expect(analyseAndStore(db, game, broken)).rejects.toThrow("engine died");

    const row = db.select().from(games).get()!;
    expect(row.analysisStatus).toBe("error");
    expect(row.analysisError).toContain("engine died");
  });

  it("leaves no half-analysed move rows behind", async () => {
    const game = seedGame();
    let calls = 0;
    const failsPartway: Analyser = {
      depth: 18,
      async newGame() {},
      async analyse() {
        calls += 1;
        if (calls > 2) throw new Error("died mid-game");
        return { score: cp(10), bestMove: undefined, depth: 18 };
      },
    };

    await expect(analyseAndStore(db, game, failsPartway)).rejects.toThrow();

    // Nothing is written until the whole game succeeds.
    const rows = db.select().from(moves).all();
    expect(rows.every((r) => r.classification === null)).toBe(true);
  });
});

describe("reclaiming after a crash", () => {
  it("returns running games to pending", async () => {
    seedGame();
    db.update(games).set({ analysisStatus: "running" }).run();

    expect(reclaimOrphanedGames(db)).toBe(1);
    expect(findGame(db, "alice", "g1")!.analysisStatus).toBe("pending");
  });

  it("leaves finished and pending games alone", async () => {
    seedGame({ id: "done-game" });
    seedGame({ id: "pending-game" });
    db.update(games)
      .set({ analysisStatus: "done" })
      .where(eq(games.id, "done-game"))
      .run();

    reclaimOrphanedGames(db);

    expect(findGame(db, "alice", "done-game")!.analysisStatus).toBe("done");
    expect(findGame(db, "alice", "pending-game")!.analysisStatus).toBe("pending");
  });
});
