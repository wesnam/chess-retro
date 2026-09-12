import { describe, it, expect, afterEach } from "vitest";
import { UciEngine, EngineError } from "./uci-engine";
import { winPct } from "@/analysis/accuracy";

/**
 * These spawn a real Stockfish. They are slow and excluded from the default
 * run (`*.slow.test.ts`); run them with:
 *
 *     npx vitest run --exclude '' src/engine/uci-engine.slow.test.ts
 *
 * Assertions are deliberately loose. Exact evaluations vary by engine version
 * and hardware, so pinning a centipawn number here would make the suite fail
 * on a Stockfish upgrade without anything actually being wrong.
 */

const STARTING_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

let engine: UciEngine | undefined;

afterEach(() => {
  engine?.dispose();
  engine = undefined;
});

async function startEngine(depth = 12): Promise<UciEngine> {
  engine = new UciEngine({ depth, timeoutMs: 60_000 });
  await engine.start();
  return engine;
}

describe("a real engine", () => {
  it("completes the UCI handshake", async () => {
    const uci = await startEngine();
    // Reaching here at all means uciok and readyok both arrived.
    expect(uci.depth).toBe(12);
  });

  it("finds a mate in one and reports it as mate, not centipawns", async () => {
    const uci = await startEngine();
    // Back-rank mate: Ra1-a8 is mate.
    const result = await uci.analyse("6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1");

    expect(result.score.kind).toBe("mate");
    if (result.score.kind === "mate") {
      expect(result.score.moves).toBe(1);
    }
    expect(result.bestMove).toBe("a1a8");
  });

  it("evaluates a clearly winning position as clearly winning", async () => {
    const uci = await startEngine();
    // Black is a whole rook up.
    const result = await uci.analyse("r5k1/5ppp/8/8/8/8/8/6K1 b - - 0 1");

    expect(winPct(result.score)).toBeGreaterThan(85);
  });

  it("reports scores from the side-to-move's perspective", async () => {
    const uci = await startEngine();
    // The same position, read from each side. Black is a rook up, so the
    // evaluation must flip sign with the side to move. This is the convention
    // the whole analysis pipeline normalises away.
    const forBlack = await uci.analyse("r5k1/5ppp/8/8/8/8/8/6K1 b - - 0 1");
    const forWhite = await uci.analyse("r5k1/5ppp/8/8/8/8/8/6K1 w - - 0 1");

    expect(winPct(forBlack.score)).toBeGreaterThan(85);
    expect(winPct(forWhite.score)).toBeLessThan(15);
  });

  it("evaluates the starting position as roughly balanced", async () => {
    const uci = await startEngine();
    const result = await uci.analyse(STARTING_FEN);

    expect(winPct(result.score)).toBeGreaterThan(40);
    expect(winPct(result.score)).toBeLessThan(60);
  });

  it("reports no best move in a finished position", async () => {
    const uci = await startEngine();
    // Black is checkmated on the back rank and has no legal move.
    const result = await uci.analyse("R5k1/5ppp/8/8/8/8/8/6K1 b - - 0 1");

    expect(result.bestMove).toBeUndefined();
  });

  it("searches to the depth it was asked for", async () => {
    const uci = await startEngine(10);
    const result = await uci.analyse(STARTING_FEN);
    expect(result.depth).toBeGreaterThanOrEqual(10);
  });

  it("keeps working across many positions on one process", async () => {
    const uci = await startEngine(8);
    await uci.newGame();

    for (const fen of [
      STARTING_FEN,
      "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
      "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
    ]) {
      const result = await uci.analyse(fen);
      expect(result.score).toBeDefined();
    }
  });

  it("fails rather than hanging on a malformed position", async () => {
    const uci = new UciEngine({ depth: 8, timeoutMs: 3_000 });
    engine = uci;
    await uci.start();

    // Stockfish ignores a FEN it cannot parse, so no bestmove ever arrives.
    // The timeout is what stops one bad position stalling an entire job.
    await expect(uci.analyse("not-a-fen")).rejects.toThrow(EngineError);
  }, 20_000);

  it("refuses to analyse once disposed", async () => {
    const uci = await startEngine(8);
    uci.dispose();

    await expect(uci.analyse(STARTING_FEN)).rejects.toThrow(EngineError);
  });
});
