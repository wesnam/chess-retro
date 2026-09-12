import { Chess } from "chess.js";
import {
  classify,
  gameAccuracy,
  invert,
  moveAccuracy,
  toCp,
  winPct,
  type Classification,
  type Score,
} from "./accuracy";
import type { UciEngine } from "@/engine/uci-engine";

export type AnalysedMove = {
  ply: number;
  color: "w" | "b";
  /** Evaluation before the move, in the mover's perspective. */
  evalBefore: number | null;
  /** Evaluation after the move, in the mover's perspective. */
  evalAfter: number | null;
  mateBefore: number | null;
  mateAfter: number | null;
  bestMoveUci: string | undefined;
  /** Centipawns the mover threw away. A bad move gives a large positive. */
  cpLoss: number;
  winPctBefore: number;
  winPctAfter: number;
  moveAccuracy: number;
  classification: Classification;
};

export type GameAnalysis = {
  moves: AnalysedMove[];
  /** Accuracy for whichever colour the user played. */
  accuracyUser: number | undefined;
  accuracyOpponent: number | undefined;
  depth: number;
};

/** The engine surface the analyzer needs, so tests can supply recorded scores. */
export type Analyser = Pick<UciEngine, "analyse" | "newGame" | "depth">;

/**
 * Analyse one whole game.
 *
 * A game of P plies needs P+1 evaluations, not 2P: each position is evaluated
 * exactly once, and what a move cost is the difference between consecutive
 * evaluations. Evaluating the played move and the best move separately would
 * double the work for the same answer.
 */
export async function analyseGame(
  pgn: string,
  userColor: "w" | "b",
  engine: Analyser,
): Promise<GameAnalysis> {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const history = chess.history({ verbose: true });

  if (history.length === 0) {
    return {
      moves: [],
      accuracyUser: undefined,
      accuracyOpponent: undefined,
      depth: engine.depth,
    };
  }

  // A fresh transposition table per game; within the game it stays warm,
  // since consecutive positions share nearly all of their search tree.
  await engine.newGame();

  // Every position the game passed through, including the final one.
  const positions = [...history.map((m) => m.before), history.at(-1)!.after];
  const evaluations = [];
  for (const fen of positions) {
    evaluations.push(await engine.analyse(fen));
  }

  const moves: AnalysedMove[] = [];
  // Win percentages in White's perspective, for measuring volatility.
  const whiteWinPercents: number[] = [];

  for (const [index, move] of history.entries()) {
    const color = move.color as "w" | "b";
    const before = evaluations[index]!;
    const after = evaluations[index + 1]!;

    // `before` is already in the mover's perspective: they are to move.
    // `after` is in the opponent's, because the side to move has flipped —
    // so it must be inverted to compare like with like.
    const scoreBefore: Score = before.score;
    const scoreAfter: Score = invert(after.score);

    const pctBefore = winPct(scoreBefore);
    const pctAfter = winPct(scoreAfter);
    const accuracy = moveAccuracy(pctBefore, pctAfter);

    moves.push({
      ply: index + 1,
      color,
      evalBefore: scoreBefore.kind === "cp" ? scoreBefore.cp : null,
      evalAfter: scoreAfter.kind === "cp" ? scoreAfter.cp : null,
      mateBefore: scoreBefore.kind === "mate" ? scoreBefore.moves : null,
      mateAfter: scoreAfter.kind === "mate" ? scoreAfter.moves : null,
      bestMoveUci: before.bestMove,
      cpLoss: Math.max(0, toCp(scoreBefore) - toCp(scoreAfter)),
      winPctBefore: pctBefore,
      winPctAfter: pctAfter,
      moveAccuracy: accuracy,
      classification: classify({
        winPctBefore: pctBefore,
        winPctAfter: pctAfter,
        isBestMove: playedTheBestMove(move, before.bestMove),
      }),
    });

    const inWhitePov = color === "w" ? scoreBefore : invert(scoreBefore);
    whiteWinPercents.push(winPct(inWhitePov));
  }

  const accuracyFor = (color: "w" | "b") =>
    gameAccuracy(
      moves.filter((m) => m.color === color).map((m) => m.moveAccuracy),
      whiteWinPercents,
    );

  return {
    moves,
    accuracyUser: accuracyFor(userColor),
    accuracyOpponent: accuracyFor(userColor === "w" ? "b" : "w"),
    depth: engine.depth,
  };
}

function playedTheBestMove(
  move: { from: string; to: string; promotion?: string },
  bestMoveUci: string | undefined,
): boolean {
  if (!bestMoveUci) return false;
  return `${move.from}${move.to}${move.promotion ?? ""}` === bestMoveUci;
}
