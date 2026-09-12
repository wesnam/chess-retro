import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { createDb } from "./client";

/**
 * These assert the database a fresh install produces: the pragmas the app
 * depends on, and the tables and indexes every later ticket queries.
 */

const tempDirs: string[] = [];

function tempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chess-retro-test-"));
  tempDirs.push(dir);
  return path.join(dir, "test.db");
}

afterEach(() => {
  let dir: string | undefined;
  while ((dir = tempDirs.pop())) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tableNames(file: string): Set<string> {
  const raw = new Database(file, { readonly: true });
  const rows = raw
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all() as { name: string }[];
  raw.close();
  return new Set(rows.map((r) => r.name));
}

function indexNames(file: string): Set<string> {
  const raw = new Database(file, { readonly: true });
  const rows = raw
    .prepare("SELECT name FROM sqlite_master WHERE type='index'")
    .all() as { name: string }[];
  raw.close();
  return new Set(rows.map((r) => r.name));
}

describe("database creation", () => {
  it("creates the file on first open", () => {
    const file = tempDbPath();
    expect(fs.existsSync(file)).toBe(false);
    createDb(file);
    expect(fs.existsSync(file)).toBe(true);
  });

  it("creates missing parent directories", () => {
    const file = path.join(path.dirname(tempDbPath()), "nested", "deep.db");
    createDb(file);
    expect(fs.existsSync(file)).toBe(true);
  });

  it("enables WAL and foreign keys", () => {
    const file = tempDbPath();
    createDb(file);

    const raw = new Database(file);
    expect(raw.pragma("journal_mode", { simple: true })).toBe("wal");
    raw.close();
  });

  it("enforces foreign keys on the live connection", () => {
    const db = createDb(tempDbPath());
    // A move referencing a game that does not exist must be rejected.
    expect(() =>
      db.run(
        `INSERT INTO moves (game_id, ply, user, time_class, is_user_move, color,
           fen_before, san, uci, piece)
         VALUES ('nope', 1, 'someone', 'blitz', 1, 'w', 'fen', 'e4', 'e2e4', 'p')` as never,
      ),
    ).toThrow();
  });

  it("is idempotent: opening twice does not fail or lose data", () => {
    const file = tempDbPath();
    const first = createDb(file);
    first.run(
      `INSERT INTO settings (key, value, updated_at) VALUES ('k', 'v', 1)` as never,
    );

    const second = createDb(file);
    const row = second
      .all(`SELECT value FROM settings WHERE key = 'k'` as never)
      .at(0) as { value: string } | undefined;
    expect(row?.value).toBe("v");
  });
});

describe("schema", () => {
  const EXPECTED_TABLES = [
    "settings",
    "games",
    "moves",
    "move_motifs",
    "sync_state",
    "analysis_jobs",
    "insights",
    "openings",
    "puzzles",
    "puzzle_themes",
    "puzzle_attempts",
  ];

  it("creates every table the spec calls for", () => {
    const file = tempDbPath();
    createDb(file);
    const tables = tableNames(file);
    for (const name of EXPECTED_TABLES) {
      expect(tables, `missing table: ${name}`).toContain(name);
    }
  });

  it("indexes the username + time-class + recency access pattern", () => {
    const file = tempDbPath();
    createDb(file);
    const indexes = indexNames(file);
    // The dashboard's hot paths: games by recency, moves by classification,
    // and motifs by role — all scoped to one user and time class.
    expect(indexes).toContain("games_user_tc_end");
    expect(indexes).toContain("moves_user_tc_usermove_class");
    expect(indexes).toContain("motifs_user_tc_role_motif");
  });

  it("carries a user column on games and moves", () => {
    const file = tempDbPath();
    createDb(file);
    const raw = new Database(file, { readonly: true });
    for (const table of ["games", "moves"]) {
      const cols = (
        raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
      ).map((c) => c.name);
      expect(cols, `${table} must carry user`).toContain("user");
    }
    raw.close();
  });

  it("denormalises user and time_class onto moves and motifs", () => {
    const file = tempDbPath();
    createDb(file);
    const raw = new Database(file, { readonly: true });
    for (const table of ["moves", "move_motifs"]) {
      const cols = (
        raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
      ).map((c) => c.name);
      expect(cols, `${table} must carry user`).toContain("user");
      expect(cols, `${table} must carry time_class`).toContain("time_class");
    }
    raw.close();
  });
});
