import { Transform } from "node:stream";
import { createZstdDecompress } from "node:zlib";

/**
 * Decompressing the published puzzle database.
 *
 * The file is not a single zstd stream. It is a sequence of frames — each
 * compressed frame preceded by a SKIPPABLE frame (magic 0x184D2A50-0x184D2A5F,
 * a little-endian payload length, then that payload) — repeating roughly every
 * nine megabytes for the whole 300MB.
 *
 * `node:zlib` handles neither part of that:
 *
 * - A skippable frame makes it fail with "Unknown frame descriptor". Since the
 *   file OPENS with one, piping the download straight into
 *   `createZstdDecompress()` yields nothing at all.
 * - It stops at the end of the FIRST compressed frame and reports a clean end
 *   of stream. That is the worse failure by far: the import succeeds, logs
 *   nothing, and stores the first 181,225 rows of 6.1 million. A green test
 *   suite over a fixture is perfectly happy while 97% of the database is
 *   missing.
 *
 * `zstd` the command-line tool does both transparently, which is why the file
 * decompresses perfectly by hand — and why this could only be caught by
 * importing the real file and counting the rows.
 *
 * So frames are separated here and fed to one decompressor each.
 */

const SKIPPABLE_MAGIC_LOW = 0x184d2a50;
const SKIPPABLE_MAGIC_HIGH = 0x184d2a5f;
const ZSTD_MAGIC = 0xfd2fb528;
/** Magic (4 bytes) plus the payload length (4 bytes). */
const SKIPPABLE_HEADER_BYTES = 8;

/**
 * Backpressure hints, not limits.
 *
 * The write side is sized to hold one compressed frame of the published file
 * (about 9MB), since a frame has to be buffered whole before its length is
 * known. The read side is deliberately SMALL: a frame's output is pushed
 * through in the chunks the decompressor produced, and a large readable buffer
 * would simply let them pile up — the consumer reads line by line and never
 * needs 30MB queued ahead of it.
 */
const FRAME_INPUT_BYTES = 12 * 1024 * 1024;
const FRAME_OUTPUT_BYTES = 1024 * 1024;

/**
 * How much new input to wait for before retrying an incomplete frame.
 *
 * Retrying on every network chunk decompresses a 9MB frame from the top over a
 * hundred times. Measured over the real file's frames, the step trades time
 * against the buffer held: 256KB costs 3.0s and 553MB, 512KB 1.7s and 602MB,
 * 2MB 0.8s and 925MB. 512KB keeps most of the speed without the footprint.
 */
const RETRY_STEP_BYTES = 512 * 1024;

/** Whether these four bytes open a skippable frame. */
export function isSkippableMagic(magic: number): boolean {
  return magic >= SKIPPABLE_MAGIC_LOW && magic <= SKIPPABLE_MAGIC_HIGH;
}

/** Whether these four bytes open a compressed zstd frame. */
export function isZstdMagic(magic: number): boolean {
  return magic === ZSTD_MAGIC;
}

/**
 * Decompress one frame, reporting how many bytes of `input` it consumed.
 *
 * The consumed count is the whole point. A frame header does not record its
 * own compressed size, so the only sound way to find where a frame ends is to
 * let the decompressor tell you: it stops at the end of the first frame and
 * `bytesWritten` is exactly that frame's length.
 *
 * Scanning the bytes for the next frame magic — the obvious alternative — is
 * WRONG, and quietly so. Those four bytes occur inside compressed data often
 * enough to matter: on the real file it split the first frame early and cut
 * 800,455 rows down to 164,238, with no error anywhere.
 *
 * Resolves undefined when `input` does not hold a complete frame, so the
 * caller knows to wait for more rather than treating a partial read as a short
 * file.
 */
function decompressOneFrame(
  input: Buffer<ArrayBufferLike>,
  emit: (chunk: Buffer) => void,
  /**
   * Whether the frame is known to be complete, and so may be emitted. A frame
   * that exactly fills the buffer might still be arriving, so the caller
   * decides: either more input can follow (hold it) or the stream has ended
   * (emit it).
   */
  canEmit: (consumed: number) => boolean,
): Promise<
  { consumed: number; emitted: boolean; bytesOut: number } | undefined
> {
  return new Promise((resolve, reject) => {
    const decompressor = createZstdDecompress();
    // Held rather than emitted immediately: until the frame ends there is no
    // way to know whether it was complete, and a partial frame's output must
    // not reach the consumer only to be produced again when the rest arrives.
    const chunks: Buffer[] = [];

    decompressor.on("data", (chunk: Buffer) => chunks.push(chunk));
    decompressor.on("error", reject);
    decompressor.on("end", () => {
      const consumed = decompressor.bytesWritten;
      // Nothing consumed means not even a frame header arrived yet.
      if (consumed === 0) {
        resolve(undefined);
        return;
      }

      // Pushed through one chunk at a time rather than concatenated. A frame
      // decompresses to about 30MB here, and `Buffer.concat` would hold both
      // the parts and the join at once — on the real file that peaked at 1.8GB
      // for output that is consumed line by line anyway.
      const complete = canEmit(consumed);
      let bytesOut = 0;
      if (complete) {
        for (const chunk of chunks) {
          bytesOut += chunk.length;
          emit(chunk);
        }
      }
      resolve({ consumed, emitted: complete, bytesOut });
    });

    decompressor.end(input);
  });
}

/**
 * Decompress a multi-frame zstd stream.
 *
 * One frame is held at a time — about nine megabytes compressed in this file —
 * so the footprint stays flat regardless of how large the file is, which is
 * what a 300MB download that must not be buffered requires.
 */
export function decompressZstdFrames(): Transform {
  // Typed generally because `concat` and `subarray` widen to `ArrayBufferLike`.
  let buffered: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  /**
   * The buffer size at which it is worth attempting decompression again.
   *
   * A frame is only complete once its final byte has arrived, and there is no
   * way to know which byte that is without trying. Retrying on every chunk
   * means decompressing a 9MB frame from the top over a hundred times, all but
   * the last attempt thrown away. Stepping the threshold up spreads that cost
   * over a handful of attempts instead, at the price of holding a completed
   * frame for at most one step longer.
   */
  let retryAt = 0;

  /**
   * Consume as many complete frames as `buffered` holds.
   *
   * `final` says whether more bytes can still arrive. While they can, a frame
   * that appears complete is left alone unless the decompressor confirms its
   * length, because the next chunk may extend it.
   */
  async function drain(
    push: (chunk: Buffer) => void,
    final: boolean,
  ): Promise<void> {
    for (;;) {
      if (buffered.length < SKIPPABLE_HEADER_BYTES) {
        if (final && buffered.length > 0) {
          throw new Error("Truncated zstd stream: a partial frame remains");
        }
        return;
      }

      const magic = buffered.readUInt32LE(0);

      if (isSkippableMagic(magic)) {
        const frame = SKIPPABLE_HEADER_BYTES + buffered.readUInt32LE(4);
        // The frame has not fully arrived; wait rather than guess its length.
        if (buffered.length < frame) {
          if (final) {
            throw new Error("Truncated zstd stream: a partial skippable frame remains");
          }
          return;
        }
        // Dropped whole: the payload is metadata this importer has no use for.
        buffered = buffered.subarray(frame);
        continue;
      }

      if (!isZstdMagic(magic)) {
        throw new Error(
          `Not a zstd stream: unexpected frame magic 0x${magic
            .toString(16)
            .padStart(8, "0")}`,
        );
      }

      // Not yet worth retrying: the last attempt came up short and too little
      // has arrived since for the answer to have changed.
      if (!final && buffered.length < retryAt) return;

      // A frame whose bytes exactly fill the buffer may still be arriving, so
      // it is emitted only when the stream has ended or another frame follows
      // it. `emit` runs inside, so a frame's output is never held whole.
      const frame = await decompressOneFrame(
        buffered,
        push,
        (consumed) => final || consumed < buffered.length,
      );

      if (!frame || !frame.emitted) {
        // Held back: more input may extend this frame. Wait for a worthwhile
        // amount of it before paying for another full decompression.
        retryAt = buffered.length + RETRY_STEP_BYTES;
        return;
      }

      // A frame that swallowed its bytes and produced none is truncated: the
      // decompressor consumes a partial frame happily and reports NO error,
      // which is the silent-truncation failure this whole module exists to
      // prevent. Only detectable once the input has ended — before that, the
      // rest of the frame may still be coming.
      if (final && frame.bytesOut === 0 && frame.consumed === buffered.length) {
        throw new Error("Truncated zstd stream: the final frame is incomplete");
      }

      buffered = buffered.subarray(frame.consumed);
      retryAt = 0;
    }
  }

  return new Transform({
    // Sized to the file's real shape rather than left at the 16KB default. One
    // frame decompresses to roughly 30MB, and a small output buffer means
    // every `push` returns false while nothing upstream is waiting — the
    // compressed side keeps arriving and the process grows to gigabytes.
    // Declaring the true size lets the stream machinery apply backpressure to
    // the download instead.
    readableHighWaterMark: FRAME_OUTPUT_BYTES,
    writableHighWaterMark: FRAME_INPUT_BYTES,

    transform(chunk: Buffer<ArrayBufferLike>, _encoding, callback) {
      buffered = buffered.length > 0 ? Buffer.concat([buffered, chunk]) : chunk;

      drain((out) => this.push(out), false).then(
        () => callback(),
        (error: Error) => callback(error),
      );
    },

    flush(callback) {
      drain((out) => this.push(out), true).then(
        () => callback(),
        (error: Error) => callback(error),
      );
    },
  });
}
