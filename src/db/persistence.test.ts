import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDb } from "./client";
import { getCorpusLimit, getUsername, setCorpusLimit, setUsername } from "@/settings/settings";

/**
 * The ticket's restart criterion: settings written by one run of the app must
 * still be there for the next one. Each `createDb` here is a separate
 * connection onto the same file, which is what a restart amounts to.
 */

let dir: string | undefined;

afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function freshDbFile(): string {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "chess-retro-persist-"));
  return path.join(dir, "chess-retro.db");
}

describe("settings persistence across restarts", () => {
  it("keeps the username after the connection is closed and reopened", () => {
    const file = freshDbFile();

    setUsername(createDb(file), "hikaru");

    // A new process would see exactly this: a fresh handle on the same file.
    expect(getUsername(createDb(file))).toBe("hikaru");
  });

  it("keeps the corpus limit after reopening", () => {
    const file = freshDbFile();

    setCorpusLimit(createDb(file), 750);

    expect(getCorpusLimit(createDb(file))).toBe(750);
  });

  it("keeps both across several reopens", () => {
    const file = freshDbFile();

    const first = createDb(file);
    setUsername(first, "hikaru");
    setCorpusLimit(first, 1200);

    createDb(file); // an intervening restart that changes nothing

    const third = createDb(file);
    expect(getUsername(third)).toBe("hikaru");
    expect(getCorpusLimit(third)).toBe(1200);
  });

  it("a username changed in a later run replaces the earlier one", () => {
    const file = freshDbFile();

    setUsername(createDb(file), "hikaru");
    setUsername(createDb(file), "magnuscarlsen");

    expect(getUsername(createDb(file))).toBe("magnuscarlsen");
  });
});
