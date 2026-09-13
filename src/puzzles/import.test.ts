import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "@/db/client";
import { puzzles, puzzleThemes } from "@/db/schema";
import {
  importPuzzles,
  isImported,
  puzzleCount,
  resumableBody,
  type ImportProgress,
} from "./import";

/**
 * The importer against a real database and a real stream.
 *
 * The source is injected as a line stream so a five-row fixture exercises the
 * same path a 300MB download does — the streaming IS the thing being tested,
 * and a version that took an array would not be the code that ships.
 */

const tempDirs: string[] = [];

function tempDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chess-retro-puzzles-"));
  tempDirs.push(dir);
  return createDb(path.join(dir, "test.db"));
}

afterEach(() => {
  let dir: string | undefined;
  while ((dir = tempDirs.pop())) fs.rmSync(dir, { recursive: true, force: true });
});

const HEADER =
  "PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags,DailyDate";

/** Real rows, so the importer is tested against published data. */
const ROWS = [
  "00008,r6k/pp2r2p/4Rp1Q/3p4/8/1N1P2R1/PqP2bPP/7K b - - 0 24,f2g3 e6e7 b2b1 b3c1 b1c1 h6c1,1797,76,95,10183,crushing hangingPiece long middlegame,https://lichess.org/787zsVup/black#48,,",
  "0000D,5rk1/1p3ppp/pq3b2/8/8/1P1Q1N2/P4PPP/3R2K1 w - - 2 27,d3d6 f8d8 d6d8 f6d8,1468,75,96,37410,advantage endgame short,https://lichess.org/F8M8OS71#53,,",
  "0008Q,8/4R3/1p2P3/p4r2/P6p/1P3Pk1/4K3/8 w - - 1 64,e7f7 f5e5 e2f1 e5e6,1383,81,92,768,advantage endgame rookEndgame short,https://lichess.org/MQSyb3KW#127,,",
];

function source(lines: string[]): Readable {
  return Readable.from(lines.map((line) => `${line}\n`));
}

describe("importPuzzles", () => {
  it("stores every usable row with its themes", async () => {
    const db = tempDb();
    const result = await importPuzzles(db, { source: source([HEADER, ...ROWS]) });

    expect(result.imported).toBe(3);
    expect(puzzleCount(db)).toBe(3);

    const stored = db
      .select()
      .from(puzzles)
      .where(eq(puzzles.id, "00008"))
      .all();
    expect(stored[0]).toMatchObject({
      id: "00008",
      rating: 1797,
      popularity: 95,
      nbPlays: 10183,
      gameUrl: "https://lichess.org/787zsVup/black#48",
    });

    const themes = db.select().from(puzzleThemes).all();
    expect(themes.filter((t) => t.puzzleId === "00008").map((t) => t.theme).sort())
      .toEqual(["crushing", "hangingPiece", "long", "middlegame"]);
  });

  /**
   * The header arrives through the stream like any other line. Without an
   * explicit reject it becomes a puzzle called "PuzzleId" with a rating of
   * NaN.
   */
  it("does not store the header as a puzzle", async () => {
    const db = tempDb();
    await importPuzzles(db, { source: source([HEADER, ...ROWS]) });

    const ids = db.select({ id: puzzles.id }).from(puzzles).all().map((p) => p.id);
    expect(ids).not.toContain("PuzzleId");
  });

  /**
   * Six million rows means a malformed one is a certainty, and it must cost
   * that row rather than the import.
   */
  it("skips malformed rows and keeps going", async () => {
    const db = tempDb();
    const result = await importPuzzles(db, {
      source: source([HEADER, ROWS[0]!, "garbage,row", "", ROWS[1]!]),
    });

    expect(result.imported).toBe(2);
    // The header, the garbage row and the blank line — every non-puzzle line
    // is a skip, including the header.
    expect(result.skipped).toBe(3);
  });

  it("is idempotent: importing twice does not duplicate rows", async () => {
    const db = tempDb();
    await importPuzzles(db, { source: source([HEADER, ...ROWS]) });
    await importPuzzles(db, { source: source([HEADER, ...ROWS]), force: true });

    expect(puzzleCount(db)).toBe(3);
    // Themes are keyed on (puzzle, theme), so they must not double either.
    expect(db.select().from(puzzleThemes).all()).toHaveLength(11);
  });

  /**
   * The ticket asks for an option to reduce the footprint. Rating is the
   * honest axis: a 600-rated player has no use for 2800-rated puzzles, and
   * dropping them cuts the import substantially.
   */
  it("can restrict the import to a rating range", async () => {
    const db = tempDb();
    const result = await importPuzzles(db, {
      source: source([HEADER, ...ROWS]),
      minRating: 1400,
      maxRating: 1500,
    });

    expect(result.imported).toBe(1);
    expect(db.select({ id: puzzles.id }).from(puzzles).all()[0]?.id).toBe("0000D");
  });

  it("drops unpopular puzzles at import rather than storing them", async () => {
    const db = tempDb();
    const disliked = ROWS[0]!.replace(",95,10183,", ",10,10183,");
    const result = await importPuzzles(db, { source: source([HEADER, disliked]) });

    expect(result.imported).toBe(0);
    // The disliked puzzle and the header.
    expect(result.skipped).toBe(2);
  });

  /**
   * A 300MB download gives no sign of life for minutes without this, and the
   * ticket asks for clear progress.
   */
  it("reports progress as it goes", async () => {
    const db = tempDb();
    const seen: ImportProgress[] = [];

    await importPuzzles(db, {
      source: source([HEADER, ...ROWS]),
      batchSize: 1,
      onProgress: (progress) => seen.push(progress),
    });

    expect(seen.length).toBeGreaterThan(0);
    expect(seen.at(-1)?.imported).toBe(3);
    // Monotonic, so a progress bar never runs backwards.
    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i]!.imported).toBeGreaterThanOrEqual(seen[i - 1]!.imported);
    }
  });

  /**
   * Batching is what keeps a six-million-row import off the heap and out of
   * one enormous transaction. Asserted through the progress callback because
   * the batch boundary is otherwise invisible.
   */
  it("writes in batches rather than one transaction at the end", async () => {
    const db = tempDb();
    const seen: ImportProgress[] = [];

    await importPuzzles(db, {
      source: source([HEADER, ...ROWS]),
      batchSize: 1,
      onProgress: (progress) => seen.push(progress),
    });

    expect(seen.length).toBeGreaterThanOrEqual(3);
  });

  it("skips the work when the database already holds an import", async () => {
    const db = tempDb();
    await importPuzzles(db, { source: source([HEADER, ...ROWS]) });

    // A source that would throw if it were read at all.
    const second = await importPuzzles(db, {
      source: Readable.from(
        (function* () {
          throw new Error("the source must not be read when already imported");
          // eslint-disable-next-line no-unreachable
          yield "";
        })(),
      ),
    });

    expect(second.skippedImport).toBe(true);
    expect(puzzleCount(db)).toBe(3);
  });

  it("re-imports when forced", async () => {
    const db = tempDb();
    await importPuzzles(db, { source: source([HEADER, ROWS[0]!]) });
    const second = await importPuzzles(db, {
      source: source([HEADER, ...ROWS]),
      force: true,
    });

    expect(second.skippedImport).toBeFalsy();
    expect(puzzleCount(db)).toBe(3);
  });
});

describe("isImported", () => {
  it("is false on an empty database and true once puzzles are stored", async () => {
    const db = tempDb();
    expect(isImported(db)).toBe(false);

    await importPuzzles(db, { source: source([HEADER, ...ROWS]) });
    expect(isImported(db)).toBe(true);
  });
});

describe("resumableBody", () => {
  /**
   * The real download takes over ten minutes, and the first full run of it
   * died with ECONNRESET at minute eleven. Without resuming, every such
   * failure costs the entire download.
   */
  function bodyOf(chunks: string[], failAfter?: number): ReadableStream {
    let index = 0;
    return new ReadableStream({
      pull(controller) {
        if (failAfter !== undefined && index === failAfter) {
          controller.error(new Error("ECONNRESET"));
          return;
        }
        if (index >= chunks.length) {
          controller.close();
          return;
        }
        controller.enqueue(new TextEncoder().encode(chunks[index]!));
        index += 1;
      },
    });
  }

  async function collect(source: AsyncGenerator<Uint8Array>): Promise<string> {
    let out = "";
    for await (const chunk of source) out += new TextDecoder().decode(chunk);
    return out;
  }

  it("passes an uninterrupted download straight through", async () => {
    const fetcher = (async () =>
      new Response(bodyOf(["abc", "def"]), { status: 200 })) as typeof fetch;

    expect(await collect(resumableBody("http://x", fetcher))).toBe("abcdef");
  });

  it("resumes from where it stopped, asking only for the rest", async () => {
    const ranges: (string | null)[] = [];
    let call = 0;

    const fetcher = (async (_url: string, init?: RequestInit) => {
      ranges.push(
        new Headers(init?.headers).get("range"),
      );
      call += 1;
      // The first attempt delivers "abc" then drops; the second serves the
      // remainder as a partial response.
      return call === 1
        ? new Response(bodyOf(["abc", "def"], 1), { status: 200 })
        : new Response(bodyOf(["def"]), { status: 206 });
    }) as unknown as typeof fetch;

    expect(await collect(resumableBody("http://x", fetcher))).toBe("abcdef");
    // The resumed request asks for byte 3 onward — exactly what was missing.
    expect(ranges).toEqual([null, "bytes=3-"]);
  });

  /**
   * A server that ignores the Range header restarts the file, which would
   * duplicate everything already read and corrupt the import. Failing is the
   * only safe answer.
   */
  it("refuses to continue when the server ignores the range request", async () => {
    let call = 0;
    const fetcher = (async () => {
      call += 1;
      return call === 1
        ? new Response(bodyOf(["abc", "def"], 1), { status: 200 })
        : // 200, not 206: the whole file again.
          new Response(bodyOf(["abcdef"]), { status: 200 });
    }) as typeof fetch;

    await expect(collect(resumableBody("http://x", fetcher))).rejects.toThrow(
      /does not support resuming/i,
    );
  });

  it("gives up on a download that fails without ever moving a byte", async () => {
    // Fails on the first read every time: nothing is ever received, so the
    // retries are getting nowhere and must stop.
    const fetcher = (async () =>
      new Response(bodyOf(["abc"], 0), { status: 200 })) as typeof fetch;

    await expect(collect(resumableBody("http://x", fetcher))).rejects.toThrow(
      /ECONNRESET/,
    );
  });

  /**
   * The real download drops roughly every 15MB — about thirty times across the
   * 300MB file. A budget counted over the whole transfer would abandon a
   * download that was progressing perfectly well, so progress resets it.
   */
  it("survives more interruptions than the budget when each one makes progress", async () => {
    const chunks = Array.from({ length: 30 }, (_, i) => `${i},`);
    let call = 0;

    const fetcher = (async (_url: string, init?: RequestInit) => {
      const range = new Headers(init?.headers).get("range");
      const from = range ? Number(/bytes=(\d+)-/.exec(range)?.[1] ?? 0) : 0;

      // Work out which chunk that byte offset lands on.
      let offset = 0;
      let start = 0;
      while (start < chunks.length && offset + chunks[start]!.length <= from) {
        offset += chunks[start]!.length;
        start += 1;
      }

      call += 1;
      const remaining = chunks.slice(start);
      // Every attempt delivers one chunk and then drops — thirty times over,
      // far past MAX_STALLED_RESUMES.
      return new Response(bodyOf(remaining, remaining.length > 1 ? 1 : undefined), {
        status: from > 0 ? 206 : 200,
      });
    }) as unknown as typeof fetch;

    expect(await collect(resumableBody("http://x", fetcher))).toBe(chunks.join(""));
    expect(call).toBeGreaterThan(5);
  });
});
