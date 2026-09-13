import { describe, it, expect } from "vitest";
import { parseInfo } from "./uci-engine";

describe("reading engine info lines", () => {
  it("reads a centipawn score", () => {
    const parsed = parseInfo(
      "info depth 16 seldepth 20 multipv 1 score cp 720 nodes 84200 nps 1336507 time 63 pv a8e8",
    );
    expect(parsed).toEqual({
      score: { kind: "cp", cp: 720 },
      depth: 16,
      line: "a8e8",
    });
  });

  it("reads a negative score", () => {
    const parsed = parseInfo("info depth 12 multipv 1 score cp -761 pv g1f1");
    expect(parsed!.score).toEqual({ kind: "cp", cp: -761 });
  });

  it("reads a forced mate, distinctly from centipawns", () => {
    const parsed = parseInfo("info depth 16 seldepth 2 multipv 1 score mate 1 pv a1a8");
    expect(parsed!.score).toEqual({ kind: "mate", moves: 1 });
  });

  it("reads being mated as a negative distance", () => {
    const parsed = parseInfo("info depth 10 multipv 1 score mate -3 pv h7h8");
    expect(parsed!.score).toEqual({ kind: "mate", moves: -3 });
  });

  it("ignores lines with no score", () => {
    expect(parseInfo("info string NNUE evaluation using nn-1a298aa.nnue")).toBeUndefined();
    expect(parseInfo("info depth 5 currmove e2e4 currmovenumber 1")).toBeUndefined();
  });

  it("ignores anything but the principal variation", () => {
    // Only multipv 1 carries the evaluation of the position itself.
    expect(parseInfo("info depth 16 multipv 2 score cp 45 pv d2d4")).toBeUndefined();
    expect(parseInfo("info depth 16 multipv 1 score cp 45 pv e2e4")).toBeDefined();
  });

  it("accepts a line with no multipv field", () => {
    expect(parseInfo("info depth 8 score cp 12 pv e2e4")).toBeDefined();
  });

  it("keeps the whole principal variation, not only its first move", () => {
    // The search computes the continuation anyway and reports it for free.
    // Keeping only the first move discards the reasoning behind the score —
    // the evaluation is the assessment at the END of this line.
    const parsed = parseInfo(
      "info depth 18 seldepth 23 multipv 1 score cp 1376 nodes 117466 nps 645417 time 182 pv g6c2 e7d6 c2h7 b7b5",
    );
    expect(parsed?.line).toBe("g6c2 e7d6 c2h7 b7b5");
  });

  it("reports no line when the engine sent none", () => {
    const parsed = parseInfo("info depth 4 score cp 12 nodes 100");
    expect(parsed?.line).toBeUndefined();
  });

  it("does not mistake other numbers for the score", () => {
    const parsed = parseInfo(
      "info depth 20 seldepth 30 multipv 1 score cp 5 nodes 1000000 nps 500000 hashfull 999 tbhits 0 time 2000 pv e2e4",
    );
    expect(parsed).toEqual({
      score: { kind: "cp", cp: 5 },
      depth: 20,
      line: "e2e4",
    });
  });
});

describe("line framing", () => {
  it("is the reason stdout is read by line rather than by chunk", async () => {
    // A long info line routinely arrives split across two chunks. Parsing raw
    // chunks would discard both halves; readline reassembles them.
    const readline = await import("node:readline");
    const { Readable } = await import("node:stream");

    const full =
      "info depth 16 seldepth 20 multipv 1 score cp 720 nodes 84200 pv a8e8";
    const split = [full.slice(0, 30), `${full.slice(30)}\nbestmove a8e8\n`];

    const stream = Readable.from(split);
    const reader = readline.createInterface({ input: stream });

    const lines: string[] = [];
    for await (const line of reader) lines.push(line);

    expect(lines[0]).toBe(full);
    expect(parseInfo(lines[0]!)).toEqual({
      score: { kind: "cp", cp: 720 },
      depth: 16,
      line: "a8e8",
    });
  });
});
