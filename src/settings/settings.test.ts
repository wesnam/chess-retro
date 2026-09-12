import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDb, type Db } from "@/db/client";
import {
  DEFAULT_CORPUS_LIMIT,
  getCorpusLimit,
  getUsername,
  isValidUsername,
  normalizeUsername,
  setCorpusLimit,
  setUsername,
} from "./settings";

let db: Db;
const tempDirs: string[] = [];

function tempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chess-retro-settings-"));
  tempDirs.push(dir);
  return path.join(dir, "test.db");
}

beforeEach(() => {
  db = createDb(":memory:");
});

afterEach(() => {
  let dir: string | undefined;
  while ((dir = tempDirs.pop())) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("username persistence", () => {
  it("returns nothing before one is configured", () => {
    expect(getUsername(db)).toBeUndefined();
  });

  it("saves and reads back a username", () => {
    setUsername(db, "hikaru");
    expect(getUsername(db)).toBe("hikaru");
  });

  it("overwrites rather than accumulating when changed", () => {
    setUsername(db, "hikaru");
    setUsername(db, "magnuscarlsen");
    expect(getUsername(db)).toBe("magnuscarlsen");
  });

  it("survives reopening the database", () => {
    // The restart case from the ticket: a username saved by one process must
    // still be there when the app is started again against the same file.
    const file = tempDbPath();
    setUsername(createDb(file), "hikaru");

    const reopened = createDb(file);
    expect(getUsername(reopened)).toBe("hikaru");
  });
});

describe("username normalisation", () => {
  it("lowercases and trims", () => {
    expect(normalizeUsername("  HiKaRu  ")).toBe("hikaru");
  });

  it("stores the normalised form", () => {
    // `user` is what keeps two accounts apart, so "WesNam" and "wesnam" must
    // not become two different players.
    setUsername(db, "  HiKaRu ");
    expect(getUsername(db)).toBe("hikaru");
  });

  it("accepts the characters chess.com allows", () => {
    expect(isValidUsername("abc")).toBe(true);
    expect(isValidUsername("a_b-c9")).toBe(true);
    expect(isValidUsername("MixedCase")).toBe(true);
  });

  it("rejects usernames that cannot exist", () => {
    expect(isValidUsername("ab")).toBe(false);
    expect(isValidUsername("")).toBe(false);
    expect(isValidUsername("has space")).toBe(false);
    expect(isValidUsername("hasa@symbol")).toBe(false);
    expect(isValidUsername("x".repeat(26))).toBe(false);
  });

  it("refuses to save an invalid username", () => {
    expect(() => setUsername(db, "no")).toThrow();
    expect(getUsername(db)).toBeUndefined();
  });
});

describe("corpus limit", () => {
  it("defaults to roughly a year of games", () => {
    expect(getCorpusLimit(db)).toBe(DEFAULT_CORPUS_LIMIT);
  });

  it("can be raised to pull a fuller history", () => {
    setCorpusLimit(db, 5000);
    expect(getCorpusLimit(db)).toBe(5000);
  });

  it("floors a fractional limit", () => {
    setCorpusLimit(db, 100.7);
    expect(getCorpusLimit(db)).toBe(100);
  });

  it("rejects a nonsensical limit", () => {
    expect(() => setCorpusLimit(db, 0)).toThrow();
    expect(() => setCorpusLimit(db, -5)).toThrow();
  });

  it("falls back to the default if the stored value is corrupt", () => {
    db.run(
      `INSERT INTO settings (key, value, updated_at)
       VALUES ('corpus.limit', 'banana', 1)` as never,
    );
    expect(getCorpusLimit(db)).toBe(DEFAULT_CORPUS_LIMIT);
  });
});
