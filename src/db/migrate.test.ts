import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { createDb } from "./client";
import { SCHEMA_VERSION } from "./migrate";

/**
 * An existing database keeps its tables when the DDL is all
 * CREATE TABLE IF NOT EXISTS, so a changed key has to be migrated explicitly.
 */

let dir: string | undefined;

afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function tempDbPath(): string {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "chess-retro-migrate-"));
  return path.join(dir, "chess-retro.db");
}

/** A database as an earlier build left it: games keyed on id alone. */
function seedVersion1(file: string): void {
  const raw = new Database(file);
  raw.pragma("journal_mode = WAL");
  raw.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE games (
      id TEXT PRIMARY KEY, user TEXT NOT NULL, pgn TEXT NOT NULL,
      time_class TEXT NOT NULL, user_color TEXT NOT NULL,
      user_result TEXT NOT NULL, end_time INTEGER NOT NULL,
      analysis_status TEXT NOT NULL DEFAULT 'pending'
    );
    INSERT INTO settings VALUES ('chesscom.username', 'alice', 1);
    INSERT INTO games (id, user, pgn, time_class, user_color, user_result, end_time)
      VALUES ('shared', 'alice', '[pgn]', 'blitz', 'w', 'win', 1);
  `);
  raw.close();
}

describe("upgrading an existing database", () => {
  it("rekeys games so both players of one game can be stored", () => {
    const file = tempDbPath();
    seedVersion1(file);

    const db = createDb(file);

    // The old key would reject this as a duplicate id.
    expect(() =>
      db.run(
        `INSERT INTO games (id, user, pgn, time_class, user_color, user_result, end_time)
         VALUES ('shared', 'alice', '[pgn]', 'blitz', 'w', 'win', 1),
                ('shared', 'bob',   '[pgn]', 'blitz', 'b', 'loss', 1)` as never,
      ),
    ).not.toThrow();

    const n = (
      db.all(`SELECT COUNT(*) AS n FROM games WHERE id='shared'` as never).at(0) as {
        n: number;
      }
    ).n;
    expect(n).toBe(2);
  });

  it("keeps settings, which are not affected by the rekey", () => {
    const file = tempDbPath();
    seedVersion1(file);

    const db = createDb(file);

    const row = db
      .all(
        `SELECT value FROM settings WHERE key='chesscom.username'` as never,
      )
      .at(0) as { value: string } | undefined;
    expect(row?.value).toBe("alice");
  });

  it("records the schema version, so the rebuild happens once", () => {
    const file = tempDbPath();
    seedVersion1(file);

    createDb(file);

    const raw = new Database(file, { readonly: true });
    expect(raw.pragma("user_version", { simple: true })).toBe(SCHEMA_VERSION);
    raw.close();
  });

  it("leaves an already-current database alone", () => {
    const file = tempDbPath();

    const first = createDb(file);
    first.run(
      `INSERT INTO games (id, user, pgn, time_class, user_color, user_result, end_time)
       VALUES ('g1', 'alice', '[pgn]', 'blitz', 'w', 'win', 1)` as never,
    );

    // Reopening must not wipe downloaded games.
    const second = createDb(file);
    const n = (
      second.all(`SELECT COUNT(*) AS n FROM games` as never).at(0) as {
        n: number;
      }
    ).n;
    expect(n).toBe(1);
  });

  it("stamps a brand new database at the current version", () => {
    const file = tempDbPath();
    createDb(file);

    const raw = new Database(file, { readonly: true });
    expect(raw.pragma("user_version", { simple: true })).toBe(SCHEMA_VERSION);
    raw.close();
  });
});
