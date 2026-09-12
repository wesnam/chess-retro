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

  it("falls back to the default when the limit is not a number", async () => {
    await saveSettings(
      { status: "idle" },
      formData({ username: "hikaru", corpusLimit: "banana" }),
    );
    expect(getCorpusLimit(db)).toBe(500);
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
