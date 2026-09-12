import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDb, type Db } from "@/db/client";
import { games, moves } from "@/db/schema";
import { backfillPhases } from "./backfill-phase";

const tempDirs: string[] = [];

function tempDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chess-retro-phase-"));
  tempDirs.push(dir);
  return createDb(path.join(dir, "test.db"));
}

afterEach(() => {
  let dir: string | undefined;
  while ((dir = tempDirs.pop())) fs.rmSync(dir, { recursive: true, force: true });
});

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const BARE_ENDGAME = "8/5k2/8/8/3P4/8/5K2/8 w - - 0 50";

function seed(db: Db, rows: Array<{ ply: number; fen: string }>): void {
  db.insert(games)
    .values({
      id: "g1",
      user: "alice",
      pgn: "[pgn]",
      timeClass: "blitz",
      userColor: "w",
      userResult: "win",
      endTime: 1,
    })
    .run();

  for (const row of rows) {
    db.insert(moves)
      .values({
        gameId: "g1",
        ply: row.ply,
        user: "alice",
        timeClass: "blitz",
        isUserMove: true,
        color: "w",
        fenBefore: row.fen,
        san: "e4",
        uci: "e2e4",
        piece: "p",
      })
      .run();
  }
}

function phases(db: Db): (string | null)[] {
  return db
    .select({ phase: moves.phase })
    .from(moves)
    .orderBy(moves.ply)
    .all()
    .map((r) => r.phase);
}

describe("backfillPhases", () => {
  it("labels stored moves from their position", () => {
    const db = tempDb();
    seed(db, [
      { ply: 1, fen: START },
      { ply: 2, fen: BARE_ENDGAME },
    ]);

    const filled = backfillPhases(db, "alice");

    expect(filled).toBe(2);
    expect(phases(db)).toEqual(["opening", "endgame"]);
  });

  it("skips rows that already carry a phase", () => {
    // The backfill runs after every analysis pass, so re-walking every FEN in
    // the corpus each time would make it progressively slower for no gain.
    const db = tempDb();
    seed(db, [{ ply: 1, fen: START }]);

    expect(backfillPhases(db, "alice")).toBe(1);
    expect(backfillPhases(db, "alice")).toBe(0);
  });

  it("re-labels everything when asked", () => {
    // Improving the classifier must be able to correct existing rows.
    const db = tempDb();
    seed(db, [{ ply: 1, fen: START }]);
    backfillPhases(db, "alice");

    expect(backfillPhases(db, "alice", { refill: true })).toBe(1);
  });

  it("leaves an unreadable position unlabelled rather than guessing", () => {
    const db = tempDb();
    seed(db, [{ ply: 1, fen: "not a fen" }]);

    expect(backfillPhases(db, "alice")).toBe(0);
    expect(phases(db)).toEqual([null]);
  });

  it("touches only the named user's moves", () => {
    const db = tempDb();
    seed(db, [{ ply: 1, fen: START }]);

    expect(backfillPhases(db, "someone-else")).toBe(0);
    expect(phases(db)).toEqual([null]);
  });
});
