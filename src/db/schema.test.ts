import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { createDb } from "./client";
import { SCHEMA_VERSION } from "./migrate";

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

  it("enables WAL, so the dashboard can read while a job writes", () => {
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

  it("removes a game's moves and motifs along with the game", () => {
    // Motif rows that outlive their game would quietly inflate the weakness
    // counts on the dashboard, which is the whole point of the project.
    const db = createDb(tempDbPath());
    const seed = (sql: string) => db.run(sql as never);

    seed(`INSERT INTO games (id, user, pgn, time_class, user_color, user_result, end_time)
          VALUES ('g1', 'someone', '[pgn]', 'blitz', 'w', 'win', 1)`);
    seed(`INSERT INTO moves (game_id, ply, user, time_class, is_user_move, color,
            fen_before, san, uci, piece)
          VALUES ('g1', 1, 'someone', 'blitz', 1, 'w', 'fen', 'e4', 'e2e4', 'p')`);
    seed(`INSERT INTO move_motifs (game_id, ply, user, time_class, motif, role)
          VALUES ('g1', 1, 'someone', 'blitz', 'fork', 'missed')`);

    seed(`DELETE FROM games WHERE id = 'g1' AND user = 'someone'`);

    const count = (table: string) =>
      (db.all(`SELECT COUNT(*) AS n FROM ${table}` as never).at(0) as { n: number }).n;

    expect(count("moves")).toBe(0);
    expect(count("move_motifs")).toBe(0);
  });

  it("stores one chess.com game once per tracked player", () => {
    // Both players of the same game may be tracked in one database. The
    // chess.com id is shared, so the row identity is (id, user).
    const db = createDb(tempDbPath());
    const seed = (sql: string) => db.run(sql as never);

    const game = (user: string, color: string, result: string) =>
      `INSERT INTO games (id, user, pgn, time_class, user_color, user_result, end_time)
       VALUES ('shared', '${user}', '[pgn]', 'blitz', '${color}', '${result}', 1)`;

    seed(game("alice", "w", "win"));
    expect(() => seed(game("bob", "b", "loss"))).not.toThrow();

    const count = (db.all(
      `SELECT COUNT(*) AS n FROM games WHERE id = 'shared'` as never,
    ).at(0) as { n: number }).n;
    expect(count).toBe(2);
  });

  it("rejects the same game stored twice for the same player", () => {
    const db = createDb(tempDbPath());
    const seed = (sql: string) => db.run(sql as never);
    const game = `INSERT INTO games (id, user, pgn, time_class, user_color, user_result, end_time)
                  VALUES ('shared', 'alice', '[pgn]', 'blitz', 'w', 'win', 1)`;

    seed(game);
    expect(() => seed(game)).toThrow();
  });

  it("deleting one player's copy leaves the other player's intact", () => {
    const db = createDb(tempDbPath());
    const seed = (sql: string) => db.run(sql as never);

    for (const [user, color] of [
      ["alice", "w"],
      ["bob", "b"],
    ]) {
      seed(`INSERT INTO games (id, user, pgn, time_class, user_color, user_result, end_time)
            VALUES ('shared', '${user}', '[pgn]', 'blitz', '${color}', 'win', 1)`);
      seed(`INSERT INTO moves (game_id, ply, user, time_class, is_user_move, color,
              fen_before, san, uci, piece)
            VALUES ('shared', 1, '${user}', 'blitz', 1, 'w', 'fen', 'e4', 'e2e4', 'p')`);
    }

    seed(`DELETE FROM games WHERE id = 'shared' AND user = 'alice'`);

    const remaining = db
      .all(`SELECT user FROM moves` as never)
      .map((r) => (r as { user: string }).user);
    expect(remaining).toEqual(["bob"]);
  });

  it("rejects a motif row for a game that does not exist", () => {
    const db = createDb(tempDbPath());
    expect(() =>
      db.run(
        `INSERT INTO move_motifs (game_id, ply, user, time_class, motif, role)
         VALUES ('nope', 1, 'someone', 'blitz', 'fork', 'missed')` as never,
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

  it("carries the analysis owner, so orphan reclaim can tell runs apart", () => {
    const file = tempDbPath();
    createDb(file);
    const raw = new Database(file, { readonly: true });
    const cols = (
      raw.prepare("PRAGMA table_info(games)").all() as { name: string }[]
    ).map((c) => c.name);
    raw.close();

    expect(cols).toContain("analysis_owner");
  });

  it("upgrades a version-2 database without losing its games", () => {
    // An analysed corpus costs hours of engine time, so version 3 adds its
    // column in place. Rebuilding the table the way version 2 did would throw
    // all of that away.
    const file = tempDbPath();
    createDb(file);

    const seed = new Database(file);
    seed
      .prepare(
        `INSERT INTO games (id, user, pgn, time_class, user_color, user_result, end_time, analysis_status)
         VALUES ('g1', 'alice', 'pgn', 'blitz', 'w', 'win', 1700000000, 'done')`,
      )
      .run();
    // Pretend this database predates the analysis_owner column.
    seed.exec("ALTER TABLE games DROP COLUMN analysis_owner");
    seed.exec("ALTER TABLE games DROP COLUMN motifs_tagged_at");
    seed.pragma("user_version = 2");
    seed.close();

    createDb(file);

    const raw = new Database(file, { readonly: true });
    const cols = (
      raw.prepare("PRAGMA table_info(games)").all() as { name: string }[]
    ).map((c) => c.name);
    const { n } = raw
      .prepare("SELECT COUNT(*) AS n FROM games")
      .get() as { n: number };
    const version = raw.pragma("user_version", { simple: true });
    raw.close();

    expect(cols).toContain("analysis_owner");
    expect(cols).toContain("motifs_tagged_at");
    expect(n, "the existing game must survive the upgrade").toBe(1);
    // Asserted against the constant, so a later bump does not need this test
    // edited — only its column expectations extended.
    expect(version).toBe(SCHEMA_VERSION);
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
