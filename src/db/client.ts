import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";
import { MIGRATION_SQL, SCHEMA_VERSION, V2_REBUILD_TABLES } from "./migrate";

export type Db = ReturnType<typeof createDb>;

/**
 * Open a database at `file`, applying pragmas and creating the schema if absent.
 * Pass ":memory:" for tests.
 */
export function createDb(file: string) {
  if (file !== ":memory:") {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  const sqlite = new Database(file);

  // WAL lets the dashboard read while a batch analysis job writes. It is not
  // available for in-memory databases.
  if (file !== ":memory:") {
    sqlite.pragma("journal_mode = WAL");
  }
  sqlite.pragma("foreign_keys = ON");

  migrate(sqlite);
  sqlite.exec(MIGRATION_SQL);
  sqlite.pragma(`user_version = ${SCHEMA_VERSION}`);

  return drizzle(sqlite, { schema });
}

/**
 * Bring an older database up to the current schema before the DDL runs.
 *
 * `CREATE TABLE IF NOT EXISTS` cannot change the shape of a table that already
 * exists, so a database created by an earlier build would silently keep its old
 * keys. Everything rebuilt here is downloaded or derived data that re-syncing
 * restores.
 */
function migrate(sqlite: Database.Database): void {
  const existing = sqlite.pragma("user_version", { simple: true }) as number;

  if (existing >= SCHEMA_VERSION) return;

  // A database with no games table is new rather than stale: the DDL below
  // builds it correctly and there is nothing to rebuild.
  const { n: hasGames } = sqlite
    .prepare(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='games'",
    )
    .get() as { n: number };
  if (hasGames === 0) return;

  // Version 2 rekeyed games, moves and motifs on (id, user).
  if (existing < 2) {
    const drop = sqlite.transaction(() => {
      for (const table of V2_REBUILD_TABLES) {
        sqlite.exec(`DROP TABLE IF EXISTS ${table}`);
      }
    });
    drop();
  }
}

const DEFAULT_PATH = path.join(process.cwd(), "data", "chess-retro.db");

/**
 * Process-wide database handle.
 *
 * Stashed on `globalThis` so Next's dev-mode hot reload reuses one connection
 * instead of opening a new one on every module reevaluation.
 */
declare global {
  // eslint-disable-next-line no-var
  var __chessRetroDb: Db | undefined;
}

export function getDb(): Db {
  if (!globalThis.__chessRetroDb) {
    globalThis.__chessRetroDb = createDb(
      process.env.CHESS_RETRO_DB ?? DEFAULT_PATH,
    );
  }
  return globalThis.__chessRetroDb;
}
