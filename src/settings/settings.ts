import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { settings } from "@/db/schema";

/**
 * The query surface these helpers need. Both a database handle and a
 * transaction satisfy it, so the same functions work inside and outside a
 * transaction without casting between the two.
 */
type SettingsStore = Pick<Db, "select" | "insert">;

export const SETTING_KEYS = {
  chesscomUsername: "chesscom.username",
  /** How many games back a sync should reach. */
  corpusLimit: "corpus.limit",
} as const;

export const DEFAULT_CORPUS_LIMIT = 500;

export function getSetting(db: SettingsStore, key: string): string | undefined {
  const row = db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, key))
    .get();
  return row?.value;
}

export function setSetting(db: SettingsStore, key: string, value: string): void {
  db.insert(settings)
    .values({ key, value, updatedAt: Date.now() })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedAt: Date.now() },
    })
    .run();
}

/**
 * chess.com usernames are case-insensitive, and the API lowercases them. Since
 * `user` is the column that keeps two accounts' games apart, it has to be
 * normalised on the way in — otherwise "WesNam" and "wesnam" would be treated
 * as two different players.
 */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/** chess.com allows 3-25 chars: letters, digits, underscore and hyphen. */
const USERNAME_PATTERN = /^[a-z0-9_-]{3,25}$/;

export function isValidUsername(raw: string): boolean {
  return USERNAME_PATTERN.test(normalizeUsername(raw));
}

export function getUsername(db: SettingsStore): string | undefined {
  return getSetting(db, SETTING_KEYS.chesscomUsername);
}

export function setUsername(db: SettingsStore, raw: string): string {
  const username = normalizeUsername(raw);
  if (!isValidUsername(username)) {
    throw new Error(`Not a valid chess.com username: "${raw}"`);
  }
  setSetting(db, SETTING_KEYS.chesscomUsername, username);
  return username;
}

export function getCorpusLimit(db: SettingsStore): number {
  const raw = getSetting(db, SETTING_KEYS.corpusLimit);
  if (raw === undefined) return DEFAULT_CORPUS_LIMIT;

  // `Number` rather than `parseInt`, which accepts a numeric prefix and would
  // silently read a corrupt "12abc" as 12.
  const parsed = Number(raw.trim());
  return Number.isFinite(parsed) && parsed >= 1
    ? Math.floor(parsed)
    : DEFAULT_CORPUS_LIMIT;
}

export function setCorpusLimit(db: SettingsStore, limit: number): void {
  if (!Number.isFinite(limit) || limit < 1) {
    throw new Error(`Corpus limit must be a positive number, got ${limit}`);
  }
  setSetting(db, SETTING_KEYS.corpusLimit, String(Math.floor(limit)));
}

/**
 * Write both settings together. Saving the username and then failing on the
 * limit would leave the app configured while telling the person it had not
 * saved, so the two move as one.
 */
export function saveUsernameAndLimit(
  db: Db,
  rawUsername: string,
  limit: number,
): string {
  return db.transaction((tx) => {
    const username = setUsername(tx, rawUsername);
    setCorpusLimit(tx, limit);
    return username;
  });
}
