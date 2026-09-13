import { describe, it, expect } from "vitest";
import {
  applyInfo,
  emptyLive,
  liveArrow,
  formatLiveScore,
  principalVariationSan,
  numberVariation,
} from "./live-analysis";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
// Black to move, after 1. e4.
const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";

describe("accumulating engine info", () => {
  it("starts with nothing to show", () => {
    const live = emptyLive();
    expect(live.depth).toBe(0);
    expect(live.score).toBeUndefined();
    expect(live.pv).toEqual([]);
  });

  it("takes the score, depth and line from an info event", () => {
    const live = applyInfo(emptyLive(), {
      depth: 12,
      score: { kind: "cp", cp: 34 },
      pv: "e2e4 e7e5 g1f3",
    });
    expect(live.depth).toBe(12);
    expect(live.score).toEqual({ kind: "cp", cp: 34 });
    expect(live.pv).toEqual(["e2e4", "e7e5", "g1f3"]);
  });

  it("ignores a shallower result arriving after a deeper one", () => {
    // Stockfish can report a lower depth mid-search; accepting it would make
    // the panel flicker backwards through evaluations already superseded.
    let live = applyInfo(emptyLive(), {
      depth: 20,
      score: { kind: "cp", cp: 34 },
      pv: "e2e4",
    });
    live = applyInfo(live, { depth: 14, score: { kind: "cp", cp: -200 }, pv: "d2d4" });
    expect(live.depth).toBe(20);
    expect(live.score).toEqual({ kind: "cp", cp: 34 });
  });

  it("accepts a new evaluation at the same depth, which is the search revising itself", () => {
    let live = applyInfo(emptyLive(), { depth: 18, score: { kind: "cp", cp: 34 }, pv: "e2e4" });
    live = applyInfo(live, { depth: 18, score: { kind: "cp", cp: 51 }, pv: "d2d4" });
    expect(live.score).toEqual({ kind: "cp", cp: 51 });
  });

  it("keeps the line already captured when a deeper event carries none", () => {
    let live = applyInfo(emptyLive(), { depth: 10, score: { kind: "cp", cp: 5 }, pv: "e2e4 e7e5" });
    live = applyInfo(live, { depth: 11, score: { kind: "cp", cp: 7 }, pv: undefined });
    expect(live.pv).toEqual(["e2e4", "e7e5"]);
  });
});

describe("the arrow for the engine's choice", () => {
  it("points along the first move of the line", () => {
    const live = applyInfo(emptyLive(), { depth: 8, score: { kind: "cp", cp: 0 }, pv: "g1f3 b8c6" });
    expect(liveArrow(live)).toEqual(["g1", "f3"]);
  });

  it("is absent before the engine has said anything", () => {
    expect(liveArrow(emptyLive())).toBeUndefined();
  });

  it("drops a promotion suffix, which is not part of a square", () => {
    const live = applyInfo(emptyLive(), { depth: 8, score: { kind: "cp", cp: 0 }, pv: "a7a8q" });
    expect(liveArrow(live)).toEqual(["a7", "a8"]);
  });
});

describe("reading the line as moves rather than coordinates", () => {
  it("renders the variation in the notation players read", () => {
    const san = principalVariationSan(START, ["e2e4", "e7e5", "g1f3", "b8c6"]);
    expect(san).toEqual(["e4", "e5", "Nf3", "Nc6"]);
  });

  it("stops at the first move that does not fit the position", () => {
    // A line that has outrun its position is truncated rather than dropped:
    // the moves before the break are still the engine's real intention.
    const san = principalVariationSan(START, ["e2e4", "e2e4"]);
    expect(san).toEqual(["e4"]);
  });

  it("returns nothing for a position it cannot read", () => {
    expect(principalVariationSan("not a fen", ["e2e4"])).toEqual([]);
  });
});

describe("showing the evaluation", () => {
  it("is written from White's perspective, as players read it", () => {
    // The engine reports from the side to move. With Black to move, a score
    // of +34 for Black is −0.34 on the board — the single easiest thing to
    // get wrong, and it silently inverts the whole panel.
    expect(formatLiveScore({ kind: "cp", cp: 34 }, AFTER_E4)).toBe("−0.34");
    expect(formatLiveScore({ kind: "cp", cp: 34 }, START)).toBe("+0.34");
  });

  it("writes a forced mate as a distance, not a number of pawns", () => {
    expect(formatLiveScore({ kind: "mate", moves: 3 }, START)).toBe("+M3");
    expect(formatLiveScore({ kind: "mate", moves: 3 }, AFTER_E4)).toBe("−M3");
  });

  it("reads mate 0 as the side to move being mated, never as a win", () => {
    // `score mate 0` means the side to move is ALREADY checkmated — the worst
    // possible score, not the best. Reading the sign off the number alone
    // gives `+M0` either way, which announces a win for whoever just lost.
    expect(formatLiveScore({ kind: "mate", moves: 0 }, START)).toBe("−M0");
    expect(formatLiveScore({ kind: "mate", moves: 0 }, AFTER_E4)).toBe("+M0");
  });

  it("has nothing to show before the first evaluation", () => {
    expect(formatLiveScore(undefined, START)).toBe("—");
  });
});

describe("numbering a variation", () => {
  const WHITE_TO_MOVE = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const BLACK_TO_MOVE = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";

  it("numbers from the position's own move counter, not from one", () => {
    const fen = "8/8/8/4k3/8/4K3/8/8 w - - 0 14";
    expect(numberVariation(["Kd3", "Kd5", "Kc3"], fen)).toBe("14. Kd3 Kd5 15. Kc3");
  });

  it("pairs White's and Black's moves under one number", () => {
    expect(numberVariation(["e4", "e5", "Nf3", "Nc6"], WHITE_TO_MOVE)).toBe(
      "1. e4 e5 2. Nf3 Nc6",
    );
  });

  it("marks a line that opens on Black's move with an ellipsis", () => {
    // Without it the first move reads as White's, and every pairing after it
    // is attributed to the wrong player.
    expect(numberVariation(["e5", "Nf3", "Nc6"], BLACK_TO_MOVE)).toBe(
      "1... e5 2. Nf3 Nc6",
    );
  });

  it("has nothing to write for an empty line", () => {
    expect(numberVariation([], WHITE_TO_MOVE)).toBe("");
  });
});
