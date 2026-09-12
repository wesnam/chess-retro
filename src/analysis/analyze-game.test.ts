import { describe, it, expect } from "vitest";
import { analyseGame, type Analyser } from "./analyze-game";
import type { Score } from "./accuracy";
import type { PositionAnalysis } from "@/engine/uci-engine";

/**
 * A stand-in engine returning recorded evaluations, so the analysis maths is
 * tested without the slowness and version-dependence of a real search.
 */
function stubEngine(
  scores: Array<{ score: Score; bestMove?: string }>,
  depth = 18,
): Analyser & { calls: string[] } {
  const calls: string[] = [];
  let index = 0;

  return {
    depth,
    calls,
    async newGame() {},
    async analyse(fen: string): Promise<PositionAnalysis> {
      calls.push(fen);
      const entry = scores[index] ?? scores.at(-1)!;
      index += 1;
      return {
        score: entry.score,
        bestMove: entry.bestMove,
        depth,
      };
    },
  };
}

const cp = (n: number): Score => ({ kind: "cp", cp: n });
const mate = (n: number): Score => ({ kind: "mate", moves: n });

const pgn = (moves: string) => `[Event "Test"]\n\n${moves}`;

describe("analysing a game", () => {
  it("returns nothing for a game with no moves", async () => {
    const result = await analyseGame(pgn("*"), "w", stubEngine([{ score: cp(0) }]));
    expect(result.moves).toEqual([]);
    expect(result.accuracyUser).toBeUndefined();
  });

  it("evaluates each position exactly once, not once per candidate move", async () => {
    // Three plies need four evaluations: the position before each move, plus
    // the final one. Evaluating played and best separately would need six.
    const engine = stubEngine([{ score: cp(0) }]);
    await analyseGame(pgn("1. e4 e5 2. Nf3 *"), "w", engine);

    expect(engine.calls).toHaveLength(4);
  });

  it("never evaluates the same position twice", async () => {
    const engine = stubEngine([{ score: cp(0) }]);
    await analyseGame(pgn("1. e4 e5 2. Nf3 Nc6 *"), "w", engine);

    expect(new Set(engine.calls).size).toBe(engine.calls.length);
  });

  it("numbers plies from one and alternates colour", async () => {
    const result = await analyseGame(
      pgn("1. e4 e5 2. Nf3 *"),
      "w",
      stubEngine([{ score: cp(0) }]),
    );

    expect(result.moves.map((m) => [m.ply, m.color])).toEqual([
      [1, "w"],
      [2, "b"],
      [3, "w"],
    ]);
  });

  it("reports the depth the verdicts came from", async () => {
    const result = await analyseGame(
      pgn("1. e4 *"),
      "w",
      stubEngine([{ score: cp(0) }], 22),
    );
    expect(result.depth).toBe(22);
  });
});

describe("perspective normalisation", () => {
  it("stores the evaluation after a move in the mover's perspective", async () => {
    // The engine reports +30 before White's move (White to move), then +30
    // after it — but that second reading is from Black's perspective, so in
    // White's terms the position is -30.
    const result = await analyseGame(
      pgn("1. e4 *"),
      "w",
      stubEngine([{ score: cp(30) }, { score: cp(30) }]),
    );

    const [move] = result.moves;
    expect(move!.evalBefore).toBe(30);
    expect(move!.evalAfter).toBe(-30);
  });

  it("charges a losing blunder to the player who made it", async () => {
    // White is level, plays a horror, and the opponent now sees +800 — which
    // means White stands at -800.
    const result = await analyseGame(
      pgn("1. e4 *"),
      "w",
      stubEngine([{ score: cp(0) }, { score: cp(800) }]),
    );

    const [move] = result.moves;
    expect(move!.evalAfter).toBe(-800);
    expect(move!.cpLoss).toBe(800);
    expect(move!.cpLoss).toBeGreaterThan(0);
    expect(move!.classification).toBe("blunder");
  });

  it("charges nothing when the mover held the position", async () => {
    // +20 before; opponent then sees -20, so the mover is still +20.
    const result = await analyseGame(
      pgn("1. e4 *"),
      "w",
      stubEngine([{ score: cp(20) }, { score: cp(-20) }]),
    );

    expect(result.moves[0]!.cpLoss).toBe(0);
  });

  it("applies the same convention to Black's moves", async () => {
    // Black to move at +50 (good for Black), after which White sees +200,
    // so Black is at -200 and lost 250.
    const result = await analyseGame(
      pgn("1. e4 e5 *"),
      "b",
      stubEngine([
        { score: cp(0) },
        { score: cp(50) },
        { score: cp(200) },
      ]),
    );

    const blackMove = result.moves.find((m) => m.color === "b")!;
    expect(blackMove.evalBefore).toBe(50);
    expect(blackMove.evalAfter).toBe(-200);
    expect(blackMove.cpLoss).toBe(250);
  });
});

describe("mate scores", () => {
  it("stores mate distinctly from centipawns", async () => {
    const result = await analyseGame(
      pgn("1. e4 *"),
      "w",
      stubEngine([{ score: mate(3) }, { score: cp(100) }]),
    );

    const [move] = result.moves;
    expect(move!.mateBefore).toBe(3);
    expect(move!.evalBefore).toBeNull();
    expect(move!.evalAfter).toBe(-100);
    expect(move!.mateAfter).toBeNull();
  });

  it("treats throwing away a forced mate as a blunder", async () => {
    // Mate in 2 for the mover, then the opponent is simply better.
    const result = await analyseGame(
      pgn("1. e4 *"),
      "w",
      stubEngine([{ score: mate(2) }, { score: cp(300) }]),
    );

    expect(result.moves[0]!.classification).toBe("blunder");
    expect(result.moves[0]!.winPctBefore).toBe(100);
  });

  it("inverts a mate score for the mover", async () => {
    // After the move the opponent has mate in 1, so the mover is being mated.
    const result = await analyseGame(
      pgn("1. e4 *"),
      "w",
      stubEngine([{ score: cp(0) }, { score: mate(1) }]),
    );

    expect(result.moves[0]!.mateAfter).toBe(-1);
    expect(result.moves[0]!.winPctAfter).toBe(0);
  });
});

describe("best-move detection", () => {
  it("labels the engine's own choice best", async () => {
    const result = await analyseGame(
      pgn("1. e4 *"),
      "w",
      stubEngine([
        { score: cp(30), bestMove: "e2e4" },
        { score: cp(-30) },
      ]),
    );

    expect(result.moves[0]!.classification).toBe("best");
    expect(result.moves[0]!.bestMoveUci).toBe("e2e4");
  });

  it("does not label a different move best", async () => {
    const result = await analyseGame(
      pgn("1. e4 *"),
      "w",
      stubEngine([
        { score: cp(30), bestMove: "d2d4" },
        { score: cp(-30) },
      ]),
    );

    expect(result.moves[0]!.classification).not.toBe("best");
  });

  it("matches a promotion by its promotion piece", async () => {
    // "a7a8" and "a7a8q" are different moves; ignoring the suffix would
    // credit a player for a move the engine did not recommend.
    const result = await analyseGame(
      `[Event "Test"]\n[FEN "8/P6k/8/8/8/8/8/7K w - - 0 1"]\n[SetUp "1"]\n\n1. a8=Q+ *`,
      "w",
      stubEngine([
        { score: cp(900), bestMove: "a7a8q" },
        { score: cp(-900) },
      ]),
    );

    expect(result.moves[0]!.classification).toBe("best");
  });

  it("does not credit a promotion to the wrong piece", async () => {
    const result = await analyseGame(
      `[Event "Test"]\n[FEN "8/P6k/8/8/8/8/8/7K w - - 0 1"]\n[SetUp "1"]\n\n1. a8=N *`,
      "w",
      stubEngine([
        { score: cp(900), bestMove: "a7a8q" },
        { score: cp(-900) },
      ]),
    );

    expect(result.moves[0]!.classification).not.toBe("best");
  });
});

describe("game accuracy", () => {
  it("is reported for both players", async () => {
    const result = await analyseGame(
      pgn("1. e4 e5 2. Nf3 Nc6 *"),
      "w",
      stubEngine([{ score: cp(20) }]),
    );

    expect(result.accuracyUser).toBeTypeOf("number");
    expect(result.accuracyOpponent).toBeTypeOf("number");
  });

  it("credits the user's own colour", async () => {
    // White plays perfectly; Black throws the game away.
    const scores = [
      { score: cp(0), bestMove: "e2e4" }, // before White's move
      { score: cp(0) }, // before Black's move
      { score: cp(900) }, // after Black's blunder: White is winning
    ];

    const asWhite = await analyseGame(pgn("1. e4 e5 *"), "w", stubEngine(scores));
    const asBlack = await analyseGame(pgn("1. e4 e5 *"), "b", stubEngine(scores));

    expect(asWhite.accuracyUser!).toBeGreaterThan(asWhite.accuracyOpponent!);
    // The same game from the other side: the figures swap.
    expect(asBlack.accuracyUser!).toBeLessThan(asBlack.accuracyOpponent!);
  });
});
