import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { puzzles, puzzleThemes } from "@/db/schema";
import { MIN_POPULARITY, parsePuzzleRow } from "./parse";
import { decompressZstdFrames } from "./zstd";

/**
 * Importing the Lichess puzzle database (CC0).
 *
 * The published file is roughly 6.1 million rows — 300MB compressed, about a
 * gigabyte of CSV. That single fact decides the shape of everything here:
 *
 * - **Nothing is ever fully in memory.** The download is piped through zstd
 *   decompression into a line reader, and rows are written in batches. The
 *   `readFileSync`-then-parse approach that `importOpenings` uses for its
 *   390KB of TSV would need a gigabyte of heap here.
 * - **Batched transactions, not one.** A single transaction around six million
 *   inserts grows the WAL without bound and loses everything on a failure at
 *   minute forty. Each batch commits on its own, so an interrupted import
 *   keeps what it had and `force` resumes by overwriting.
 * - **Decompression is `node:zlib`'s**, which has handled zstd since Node 22.
 *   A dependency for this would be a dependency for a stream transform the
 *   runtime already ships.
 *
 * The source is injected rather than opened here, so tests drive the real
 * streaming path with a handful of rows.
 */

/** Where the published database lives. */
export const PUZZLE_DB_URL =
  "https://database.lichess.org/lichess_db_puzzle.csv.zst";

/**
 * Rows per transaction. Large enough that per-transaction overhead disappears
 * against six million rows, small enough that a failure costs seconds of work
 * and the WAL stays bounded.
 */
export const DEFAULT_BATCH_SIZE = 5_000;

export type ImportProgress = {
  /** Rows read from the source so far. */
  read: number;
  /** Rows stored so far. */
  imported: number;
  /** Rows rejected: malformed, unpopular, or outside the requested band. */
  skipped: number;
};

export type ImportResult = ImportProgress & {
  /** True when the database already held an import and nothing was read. */
  skippedImport?: boolean;
};

export type ImportOptions = {
  /**
   * Where the CSV lines come from. A plain line stream — already decompressed.
   * Defaults to downloading and decompressing `PUZZLE_DB_URL`.
   */
  source?: Readable;
  /** Re-import even when the database already holds puzzles. */
  force?: boolean;
  batchSize?: number;
  /**
   * Import only puzzles inside a rating range.
   *
   * The ticket's footprint option. Rating is the honest axis to cut on: a
   * 600-rated player has no use for 2800-rated puzzles, so restricting to a
   * band around their own rating stores a fraction of the rows and loses
   * nothing they would ever have been served.
   */
  minRating?: number;
  maxRating?: number;
  onProgress?: (progress: ImportProgress) => void;
};

/** How many puzzles are stored. */
export function puzzleCount(db: Db): number {
  return db.select({ n: sql<number>`COUNT(*)` }).from(puzzles).get()?.n ?? 0;
}

/**
 * Whether practice has material to work with.
 *
 * Any puzzles at all, rather than an exact count: unlike the bundled openings
 * dataset there is no local file to count against, and the import is
 * deliberately allowed to be partial — a rating-restricted import is a
 * complete import of what the player asked for.
 */
export function isImported(db: Db): boolean {
  return puzzleCount(db) > 0;
}

/** A parsed row ready to be written. */
type Pending = NonNullable<ReturnType<typeof parsePuzzleRow>>;

/**
 * Write one batch.
 *
 * `onConflictDoUpdate` on the puzzle and `onConflictDoNothing` on its themes,
 * so a re-import replaces rather than duplicates and a resumed import can
 * safely overwrite rows it already wrote.
 */
function writeBatch(db: Db, batch: Pending[]): void {
  db.transaction((tx) => {
    for (const puzzle of batch) {
      tx.insert(puzzles)
        .values({
          id: puzzle.id,
          fen: puzzle.fen,
          movesUci: puzzle.movesUci,
          rating: puzzle.rating,
          ratingDeviation: puzzle.ratingDeviation ?? null,
          popularity: puzzle.popularity,
          nbPlays: puzzle.nbPlays ?? null,
          gameUrl: puzzle.gameUrl ?? null,
        })
        .onConflictDoUpdate({
          target: puzzles.id,
          set: {
            fen: puzzle.fen,
            movesUci: puzzle.movesUci,
            rating: puzzle.rating,
            ratingDeviation: puzzle.ratingDeviation ?? null,
            popularity: puzzle.popularity,
            nbPlays: puzzle.nbPlays ?? null,
            gameUrl: puzzle.gameUrl ?? null,
          },
        })
        .run();

      for (const theme of puzzle.themes) {
        tx.insert(puzzleThemes)
          .values({ puzzleId: puzzle.id, theme })
          .onConflictDoNothing()
          .run();
      }
    }
  });
}

/**
 * Download the published database and decompress it into a line stream.
 *
 * Streamed end to end: the response body is piped through zstd into a
 * pass-through, so at no point does a gigabyte of CSV — or 300MB of
 * compressed bytes — exist as a buffer.
 */
export async function downloadPuzzleSource(
  url: string = PUZZLE_DB_URL,
): Promise<Readable> {
  // `decompressZstdFrames` rather than `createZstdDecompress`: the published
  // file is a sequence of frames, and the built-in decompressor both rejects
  // its skippable frames and stops after the first compressed one. See
  // `zstd.ts` — getting this wrong imports 3% of the database and reports
  // success.
  const decompressed = decompressZstdFrames();

  // Fed by a generator rather than piped from one response, so a connection
  // that drops part-way can be resumed instead of costing the whole download.
  // The real file takes over ten minutes to fetch and a reset at minute eleven
  // is not hypothetical — it happened on the first full run.
  void pipeline(Readable.from(resumableBody(url)), decompressed).catch(
    (error: Error) => {
      decompressed.destroy(error);
    },
  );

  return decompressed;
}

/**
 * How many times a download may drop WITHOUT PROGRESS before giving up.
 *
 * Counted consecutively and reset by any byte received, because the budget
 * exists to stop a download that is going nowhere — not to cap how many times
 * a long transfer may be interrupted. The real file drops roughly every 15MB,
 * which is around thirty times across its 300MB; a total cap of any reasonable
 * size would abandon a download that was in fact progressing perfectly well.
 */
const MAX_STALLED_RESUMES = 5;

/**
 * The response body, resumed with a Range request whenever it drops.
 *
 * database.lichess.org advertises `accept-ranges: bytes`, so a reset mid-file
 * costs only the bytes still outstanding. Yielded as chunks so the caller
 * cannot tell a resumed download from an uninterrupted one — the frames
 * reassemble across the seam like any other chunk boundary.
 */
export async function* resumableBody(
  url: string,
  fetcher: typeof fetch = fetch,
): AsyncGenerator<Uint8Array> {
  let received = 0;
  // Consecutive failures that moved no bytes. Reset as soon as any arrive.
  let stalled = 0;

  for (;;) {
    const response = await fetcher(
      url,
      received > 0 ? { headers: { range: `bytes=${received}-` } } : {},
    );

    if (!response.ok || !response.body) {
      throw new Error(
        `Could not download the puzzle database: ${response.status} ${response.statusText}`,
      );
    }

    // A server that ignores the Range header would restart the file and
    // duplicate everything already read. Better to fail loudly than to import
    // a corrupt stream.
    if (received > 0 && response.status !== 206) {
      throw new Error(
        "The puzzle database server does not support resuming; retry the import.",
      );
    }

    try {
      // Read through the web stream's own reader rather than wrapping it in a
      // Node stream. A wrapper reads ahead, so bytes it had buffered when the
      // connection dropped would be counted as received and never yielded —
      // the resumed request would then start past them and lose a chunk.
      const reader = (
        response.body as ReadableStream<Uint8Array>
      ).getReader();

      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        if (!value) continue;
        received += value.byteLength;
        // This attempt is making progress, so it is not a stalled download.
        stalled = 0;
        yield value;
      }
    } catch (error) {
      stalled += 1;
      if (stalled > MAX_STALLED_RESUMES) throw error;
      // Loudly, because a silent resume makes a flaky network look like a slow
      // one and hides a download that is failing repeatedly.
      console.warn(
        `[chess-retro] puzzle download interrupted at ${received} bytes; resuming`,
      );
    }
  }
}

/**
 * Read a local copy instead of downloading.
 *
 * The file is large and the download is slow, so re-importing from a copy
 * already on disk — and importing with no network at all — has to be possible.
 * `.zst` is decompressed; anything else is read as plain CSV.
 */
export function fileSource(file: string): Readable {
  const stream = fs.createReadStream(file);
  if (path.extname(file) !== ".zst") return stream;

  const decompressed = decompressZstdFrames();
  void pipeline(stream, decompressed).catch((error: Error) => {
    decompressed.destroy(error);
  });
  return decompressed;
}

/**
 * Import the puzzle database.
 *
 * Returns what it did rather than throwing on bad rows: over six million rows
 * some are always malformed, and one of them must not cost the import.
 */
export async function importPuzzles(
  db: Db,
  options: ImportOptions = {},
): Promise<ImportResult> {
  // Checked before the source is touched, so an already-imported database
  // never starts a 300MB download.
  if (!options.force && isImported(db)) {
    const imported = puzzleCount(db);
    return { read: 0, imported, skipped: 0, skippedImport: true };
  }

  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const source = options.source ?? (await downloadPuzzleSource());

  const lines = readline.createInterface({
    input: source,
    // A CSV line never contains a bare \r, and treating one as a line ending
    // would split rows in a file written on Windows.
    crlfDelay: Infinity,
  });

  let read = 0;
  let imported = 0;
  let skipped = 0;
  let batch: Pending[] = [];

  const flush = () => {
    if (batch.length === 0) return;
    writeBatch(db, batch);
    imported += batch.length;
    batch = [];
    options.onProgress?.({ read, imported, skipped });
  };

  try {
    for await (const line of lines) {
      read += 1;

      const puzzle = parsePuzzleRow(line);
      if (!puzzle) {
        skipped += 1;
        continue;
      }

      // Filtered before storage, not at selection time. Storing six million
      // rows to serve a few thousand is the footprint the ticket asks to be
      // able to avoid.
      if (puzzle.popularity < MIN_POPULARITY) {
        skipped += 1;
        continue;
      }
      if (options.minRating !== undefined && puzzle.rating < options.minRating) {
        skipped += 1;
        continue;
      }
      if (options.maxRating !== undefined && puzzle.rating > options.maxRating) {
        skipped += 1;
        continue;
      }

      batch.push(puzzle);
      if (batch.length >= batchSize) flush();
    }

    flush();
  } finally {
    // Closed explicitly: leaving the reader open holds the underlying stream
    // and, on the download path, the socket.
    lines.close();
  }

  return { read, imported, skipped };
}
