import { describe, it, expect } from "vitest";
import {
  startExploration,
  playExploration,
  undoExploration,
  type Exploration,
} from "./exploration";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
// After 1. e4 e5.
const OPEN = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 3";

describe("starting an exploration", () => {
  it("begins at the position on the board, with nothing played", () => {
    const line = startExploration(START)!;
    expect(line.moves).toEqual([]);
    expect(line.fen).toBe(START);
    expect(line.root).toBe(START);
  });

  it("refuses a position it cannot read, rather than exploring a wrong board", () => {
    expect(startExploration("not a fen")).toBeUndefined();
  });
});

describe("playing a move", () => {
  it("advances the position and records the move in both notations", () => {
    const line = playExploration(startExploration(START)!, "e2", "e4")!;
    expect(line.moves).toHaveLength(1);
    expect(line.moves[0]).toMatchObject({ san: "e4", uci: "e2e4" });
    expect(line.fen).toContain("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP");
  });

  it("keeps the moves in order as a line is built", () => {
    let line = startExploration(START)!;
    line = playExploration(line, "e2", "e4")!;
    line = playExploration(line, "e7", "e5")!;
    line = playExploration(line, "g1", "f3")!;
    expect(line.moves.map((m) => m.san)).toEqual(["e4", "e5", "Nf3"]);
  });

  it("rejects an illegal move rather than corrupting the line", () => {
    const line = startExploration(START)!;
    expect(playExploration(line, "e2", "e5")).toBeUndefined();
    // The original is untouched: these are values, not mutable state.
    expect(line.moves).toEqual([]);
  });

  it("promotes to a queen, since a board drag carries no choice of piece", () => {
    const line = startExploration("8/P6k/8/8/8/8/7K/8 w - - 0 1")!;
    const promoted = playExploration(line, "a7", "a8")!;
    expect(promoted.moves[0]).toMatchObject({ san: "a8=Q", uci: "a7a8q" });
  });
});

describe("taking a move back", () => {
  it("returns to the previous position", () => {
    let line = startExploration(OPEN)!;
    line = playExploration(line, "g1", "f3")!;
    const back = undoExploration(line);
    expect(back.moves).toEqual([]);
    expect(back.fen).toBe(OPEN);
  });

  it("at the root, stays at the root", () => {
    const line = startExploration(OPEN)!;
    expect(undoExploration(line).moves).toEqual([]);
    expect(undoExploration(line).fen).toBe(OPEN);
  });
});

describe("the move that led to the shown position", () => {
  it("is the last explored move, so the board highlights where you just went", () => {
    let line: Exploration = startExploration(OPEN)!;
    expect(line.lastMove).toBeUndefined();
    line = playExploration(line, "g1", "f3")!;
    expect(line.lastMove).toEqual(["g1", "f3"]);
  });
});
