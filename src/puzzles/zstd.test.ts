import { describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import { zstdCompressSync } from "node:zlib";
import { decompressZstdFrames, isSkippableMagic, isZstdMagic } from "./zstd";

/**
 * The two failures these tests exist for, both found by importing the real
 * published file and neither visible from a fixture:
 *
 * 1. The file opens with a skippable frame, which `node:zlib` rejects
 *    outright — the import stored nothing.
 * 2. The file is a SEQUENCE of frames, and `node:zlib` stops after the first
 *    one and reports a clean end of stream — the import stored 181,225 rows of
 *    6.1 million and reported success.
 *
 * The second is the dangerous one, so it is the one most heavily covered.
 */

/** A skippable frame carrying `payload`, as the real file interleaves. */
function skippableFrame(payload: Buffer, magic = 0x184d2a50): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32LE(magic, 0);
  header.writeUInt32LE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

async function decompress(chunks: Buffer[]): Promise<string> {
  const out: Buffer[] = [];
  const stream = Readable.from(chunks).pipe(decompressZstdFrames());
  for await (const chunk of stream) out.push(chunk as Buffer);
  return Buffer.concat(out).toString();
}

describe("frame magic", () => {
  it("tells the two kinds of frame apart", () => {
    expect(isSkippableMagic(0x184d2a50)).toBe(true);
    expect(isSkippableMagic(0x184d2a5f)).toBe(true);
    expect(isSkippableMagic(0x184d2a60)).toBe(false);
    expect(isZstdMagic(0xfd2fb528)).toBe(true);
    // The two ranges must never be confused for one another.
    expect(isZstdMagic(0x184d2a50)).toBe(false);
    expect(isSkippableMagic(0xfd2fb528)).toBe(false);
  });
});

describe("decompressZstdFrames", () => {
  it("decompresses an ordinary single-frame stream", async () => {
    const body = zstdCompressSync(Buffer.from("hello\nworld\n"));
    expect(await decompress([body])).toBe("hello\nworld\n");
  });

  /**
   * The shape the published file really has: a skippable frame, then a
   * compressed one, repeating. Every frame's content must reach the output.
   */
  it("reads every frame of a multi-frame file, not only the first", async () => {
    const input = Buffer.concat([
      skippableFrame(Buffer.from([0x32, 0x02, 0x8a, 0x00])),
      zstdCompressSync(Buffer.from("one\n")),
      skippableFrame(Buffer.from([0x01, 0x02, 0x03, 0x04])),
      zstdCompressSync(Buffer.from("two\n")),
      skippableFrame(Buffer.from([0x05, 0x06, 0x07, 0x08])),
      zstdCompressSync(Buffer.from("three\n")),
    ]);

    expect(await decompress([input])).toBe("one\ntwo\nthree\n");
  });

  it("reads consecutive compressed frames with nothing between them", async () => {
    const input = Buffer.concat([
      zstdCompressSync(Buffer.from("a\n")),
      zstdCompressSync(Buffer.from("b\n")),
    ]);

    expect(await decompress([input])).toBe("a\nb\n");
  });

  it("skips a leading skippable frame", async () => {
    const input = Buffer.concat([
      skippableFrame(Buffer.from("metadata")),
      zstdCompressSync(Buffer.from("data\n")),
    ]);

    expect(await decompress([input])).toBe("data\n");
  });

  /**
   * A download arrives in arbitrary chunks, so both kinds of frame header can
   * be split across two of them. Reading a length out of a half-arrived header
   * would consume the wrong number of bytes and corrupt everything after it.
   */
  it("handles frames split across chunk boundaries", async () => {
    const input = Buffer.concat([
      skippableFrame(Buffer.from([0x32, 0x02, 0x8a, 0x00])),
      zstdCompressSync(Buffer.from("first\n")),
      skippableFrame(Buffer.from([0x01, 0x02, 0x03, 0x04])),
      zstdCompressSync(Buffer.from("second\n")),
    ]);

    for (const size of [1, 2, 3, 5, 7, 8, 9, 11, 13, 17, 23]) {
      const chunks: Buffer[] = [];
      for (let i = 0; i < input.length; i += size) {
        chunks.push(input.subarray(i, i + size));
      }
      expect(await decompress(chunks)).toBe("first\nsecond\n");
    }
  });

  it("handles a large payload spread over many frames", async () => {
    const frames: Buffer[] = [];
    let expected = "";
    for (let i = 0; i < 25; i += 1) {
      const text = `row ${i}\n`;
      expected += text;
      frames.push(skippableFrame(Buffer.from([i, 0, 0, 0])));
      frames.push(zstdCompressSync(Buffer.from(text)));
    }

    expect(await decompress(frames)).toBe(expected);
  });

  /**
   * The decompressor consumes a truncated frame's bytes happily, emits
   * nothing, and reports NO error — so a cut-short download would otherwise
   * look exactly like a complete one that simply had fewer rows. That is the
   * silent-truncation failure this whole module exists to prevent.
   */
  it("fails on a stream whose last frame is cut short", async () => {
    const whole = zstdCompressSync(Buffer.from("x".repeat(5000)));

    await expect(
      decompress([whole.subarray(0, whole.length - 10)]),
    ).rejects.toThrow(/truncated/i);
  });

  it("emits nothing for an empty stream rather than failing", async () => {
    expect(await decompress([])).toBe("");
  });

  /**
   * Every frame boundary lands mid-chunk at some byte size, so the extreme
   * case is worth pinning: one byte at a time must still reassemble exactly.
   */
  it("reassembles frames delivered one byte at a time", async () => {
    const input = Buffer.concat([
      zstdCompressSync(Buffer.from("alpha\n")),
      zstdCompressSync(Buffer.from("beta\n")),
      zstdCompressSync(Buffer.from("gamma\n")),
    ]);

    expect(await decompress([...input].map((b) => Buffer.from([b])))).toBe(
      "alpha\nbeta\ngamma\n",
    );
  });

  /**
   * Errors must surface. The bug this replaced failed by succeeding — a
   * truncated read that looked like a complete one — so a stream that is not
   * zstd at all has to be loud.
   */
  it("fails on input that is not a zstd stream", async () => {
    await expect(decompress([Buffer.from("not compressed at all")])).rejects.toThrow(
      /not a zstd stream/i,
    );
  });
});
