import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDb, type Db } from "@/db/client";
import { getCorpusLimit, getUsername } from "@/settings/settings";

/**
 * Covers the path the settings form actually takes: form data in, database
 * write out. `getDb` and `revalidatePath` are stubbed because the first would
 * otherwise open the real application database and the second requires a
 * request context that does not exist in a test.
 */

let db: Db;
let dir: string;

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: () => db };
});

const { saveSettings } = await import("./actions");

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "chess-retro-actions-"));
  db = createDb(path.join(dir, "test.db"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("saving settings", () => {
  it("persists a username entered in the form", async () => {
    const result = await saveSettings(
      { status: "idle" },
      formData({ username: "hikaru", corpusLimit: "500" }),
    );

    expect(result.status).toBe("ok");
    expect(getUsername(db)).toBe("hikaru");
  });

  it("normalises what the person typed", async () => {
    await saveSettings(
      { status: "idle" },
      formData({ username: "  HiKaRu  ", corpusLimit: "500" }),
    );
    expect(getUsername(db)).toBe("hikaru");
  });

  it("persists the corpus limit alongside the username", async () => {
    await saveSettings(
      { status: "idle" },
      formData({ username: "hikaru", corpusLimit: "750" }),
    );
    expect(getCorpusLimit(db)).toBe(750);
  });

  it("reports an invalid username instead of throwing", async () => {
    const result = await saveSettings(
      { status: "idle" },
      formData({ username: "no", corpusLimit: "500" }),
    );

    expect(result.status).toBe("error");
    expect(result.message).toMatch(/valid chess\.com username/i);
    expect(getUsername(db)).toBeUndefined();
  });

  it("rejects a limit that is not a number", async () => {
    const result = await saveSettings(
      { status: "idle" },
      formData({ username: "hikaru", corpusLimit: "banana" }),
    );
    expect(result.status).toBe("error");
  });

  it("uses the default when the limit is left blank", async () => {
    await saveSettings(
      { status: "idle" },
      formData({ username: "hikaru", corpusLimit: "" }),
    );
    expect(getCorpusLimit(db)).toBe(500);
  });

  it("saves nothing at all when the limit is rejected", async () => {
    // A save that reports failure must not leave the app configured: the
    // person would believe nothing happened while the username was stored.
    const result = await saveSettings(
      { status: "idle" },
      formData({ username: "hikaru", corpusLimit: "0" }),
    );

    expect(result.status).toBe("error");
    expect(getUsername(db)).toBeUndefined();
  });

  it("honours an exponent-formatted limit rather than truncating it", async () => {
    // A number input can legitimately submit "1e4"; parseInt would read 1.
    await saveSettings(
      { status: "idle" },
      formData({ username: "hikaru", corpusLimit: "1e4" }),
    );
    expect(getCorpusLimit(db)).toBe(10_000);
  });

  it("does not accept a limit with trailing garbage", async () => {
    const result = await saveSettings(
      { status: "idle" },
      formData({ username: "hikaru", corpusLimit: "12abc" }),
    );
    expect(result.status).toBe("error");
    expect(getUsername(db)).toBeUndefined();
  });

  it("changing the username replaces it rather than keeping both", async () => {
    await saveSettings(
      { status: "idle" },
      formData({ username: "hikaru", corpusLimit: "500" }),
    );
    await saveSettings(
      { status: "idle" },
      formData({ username: "magnuscarlsen", corpusLimit: "500" }),
    );
    expect(getUsername(db)).toBe("magnuscarlsen");
  });
});
