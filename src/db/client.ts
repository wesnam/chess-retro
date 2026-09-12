import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";
import { MIGRATION_SQL } from "./migrate";

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

  sqlite.exec(MIGRATION_SQL);

  return drizzle(sqlite, { schema });
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
