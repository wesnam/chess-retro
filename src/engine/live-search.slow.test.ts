import { describe, it, expect, afterEach } from "vitest";
import { UciEngine } from "./uci-engine";
import { emptyLive, applyInfo, liveArrow } from "@/games/live-analysis";

/**
 * The live search against a real Stockfish.
 *
 * The fast suite drives a fake engine, which proves the protocol discipline
 * but not that Stockfish agrees with our reading of it. This is the test that
 * would catch `go infinite` never being stopped, or the score coming back in a
 * perspective we did not expect.
 */

const engines: UciEngine[] = [];

function engine(): UciEngine {
  const created = new UciEngine();
  engines.push(created);
  return created;
}

afterEach(() => {
  for (const created of engines.splice(0)) created.dispose();
});

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
// White to move and mate in one: Qxf7#.
const MATE_IN_ONE =
  "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4";

describe("a real engine, searching live", () => {
  it("deepens over time rather than answering once", async () => {
    const stockfish = engine();
    await stockfish.start();

    const depths: number[] = [];
    const controller = new AbortController();

    await stockfish.analyseLive(START, {
      signal: controller.signal,
      onInfo: (info) => {
        depths.push(info.depth);
        // Deep enough to be sure it is iterating, shallow enough to be quick.
        if (info.depth >= 10) controller.abort();
      },
    });

    expect(depths.length).toBeGreaterThan(1);
    expect(Math.max(...depths)).toBeGreaterThanOrEqual(10);
  });

  it("finds the mate and points the arrow at it", async () => {
    const stockfish = engine();
    await stockfish.start();

    const controller = new AbortController();
    let live = emptyLive();

    await stockfish.analyseLive(MATE_IN_ONE, {
      signal: controller.signal,
      onInfo: (info) => {
        live = applyInfo(live, info);
        if (live.score?.kind === "mate") controller.abort();
      },
    });

    expect(live.score).toEqual({ kind: "mate", moves: 1 });
    expect(liveArrow(live)).toEqual(["f3", "f7"]);
  });

  it("is still usable for the next position after being stopped", async () => {
    // The drain, against the real thing: without it the second search resolves
    // on the first one's `bestmove` and reports one position under another's.
    const stockfish = engine();
    await stockfish.start();

    for (const fen of [START, MATE_IN_ONE]) {
      const controller = new AbortController();
      let depth = 0;
      await stockfish.analyseLive(fen, {
        signal: controller.signal,
        onInfo: (info) => {
          depth = info.depth;
          if (depth >= 8) controller.abort();
        },
      });
      expect(depth).toBeGreaterThanOrEqual(8);
    }
  });

  it("still answers a stored analysis afterwards, sharing one engine", async () => {
    // Live searches and stored analyses share the queue. A live search that
    // failed to clean up would leave `analyse` waiting forever.
    const stockfish = engine();
    await stockfish.start();

    const controller = new AbortController();
    await stockfish.analyseLive(START, {
      signal: controller.signal,
      onInfo: (info) => {
        if (info.depth >= 6) controller.abort();
      },
    });

    const analysis = await stockfish.analyse(MATE_IN_ONE);
    expect(analysis.score).toEqual({ kind: "mate", moves: 1 });
    expect(analysis.bestMove).toBe("f3f7");
  });
});
