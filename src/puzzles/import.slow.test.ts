import { describe, it, expect } from "vitest";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  decompressZstdFrames,
  isSkippableMagic,
  isZstdMagic,
} from "./zstd";
import { createDb } from "@/db/client";
import { importPuzzles, PUZZLE_DB_URL, puzzleCount } from "./import";
import { selectPuzzles } from "./select";
import { openPuzzle, playMove } from "./session";

/**
 * The importer against the REAL published database.
 *
 * Excluded from the default run: it downloads from database.lichess.org. It
 * exists because the mocked-stream tests cannot catch the things most likely
 * to break here — a changed column order, a zstd frame the runtime will not
 * decompress, or a URL that has moved. A green unit suite over a hand-written
 * fixture would be perfectly happy while the real import stored nothing.
 *
 * Only the first few megabytes are fetched. That is enough to prove the whole
 * pipeline — fetch, decompress, parse, batch, store — and the last line of the
 * truncated stream is a partial row, which is itself worth exercising.
 */

/**
 * Enough of the file to span several frames without downloading all 300MB.
 * The published file's frames are about 9MB each.
 */
const BYTES = 20_000_000;

/**
 * The real file, cut at a frame boundary.
 *
 * Cut at a BOUNDARY rather than at an arbitrary offset because a stream ending
 * mid-frame is genuinely truncated, and the decompressor is right to refuse
 * it. Finding the boundary is also the point: it proves frames really are laid
 * out as `zstd.ts` claims, against the published bytes.
 */
async function truncatedSource(): Promise<Readable> {
  const response = await fetch(PUZZLE_DB_URL, {
    headers: { Range: `bytes=0-${BYTES}` },
  });
  if (!response.body) throw new Error("no response body");

  const raw = Buffer.from(await response.arrayBuffer());

  // The last frame magic in what arrived: everything before it is whole.
  let cut = 0;
  for (let i = 4; i + 4 <= raw.length; i += 1) {
    const magic = raw.readUInt32LE(i);
    if (isZstdMagic(magic) || isSkippableMagic(magic)) cut = i;
  }
  expect(cut, "no frame boundary found — the file's framing has changed").
    toBeGreaterThan(0);

  const decompressed = decompressZstdFrames();
  void pipeline(Readable.from([raw.subarray(0, cut)]), decompressed).catch(
    () => {},
  );

  return decompressed;
}

describe("importing the real puzzle database", () => {
  it("downloads, decompresses and stores puzzles that can then be served", async () => {
    const db = createDb(":memory:");

    const result = await importPuzzles(db, {
      source: await truncatedSource(),
      batchSize: 2_000,
    });

    // The published file really does hold rows in the shape the parser expects.
    expect(result.imported).toBeGreaterThan(1_000);
    expect(puzzleCount(db)).toBe(result.imported);

    // Most rows are usable: a parser reading the wrong columns would still
    // "work" while skipping almost everything.
    expect(result.skipped).toBeLessThan(result.read / 2);

    // And the point of the whole exercise: a real weakness theme finds real
    // puzzles at a real rating, and each is solvable by playing its own line.
    const found = selectPuzzles(db, {
      user: "nobody",
      theme: "fork",
      rating: 1500,
      limit: 5,
    });
    expect(found.length).toBeGreaterThan(0);

    for (const puzzle of found) {
      // The setup move is applied, so the position shown is never the stored
      // one — the detail the ticket warns about, checked on published data.
      const opened = openPuzzle(puzzle);
      // Every published puzzle must open: a row that cannot is corrupt, and
      // this is the check that would notice the file changing shape.
      expect(opened, `${puzzle.id} could not be opened`).toBeDefined();
      let position = opened!;
      expect(position.fen).not.toBe(puzzle.fen);

      // Playing the recorded line solves it, which is the strongest available
      // check that the stored moves and the state machine agree.
      const line = puzzle.movesUci.split(" ");
      for (let i = 1; i < line.length; i += 2) {
        const move = line[i]!;
        position = playMove(position, move.slice(0, 2), move.slice(2, 4));
      }
      expect(position.status, `${puzzle.id} did not solve`).toBe("solved");
    }
  });
});
