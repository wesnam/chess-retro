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

  // chess.js stops at the first move it cannot read rather than throwing, so a
  // truncated PGN would otherwise yield a short analysis and a wrong accuracy,
  // recorded as if the whole game had been reviewed.
  const expectedPlies = countMovetextPlies(pgn);
  if (expectedPlies !== undefined && history.length < expectedPlies) {
    throw new Error(
      `PGN parsed to ${history.length} plies but its movetext has ${expectedPlies}; refusing to analyse a partial game.`,
    );
  }

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
        isBestMove: playedTheBestMove(
          move,
          before.bestMove,
          legalMoveCount(move.before),
        ),
      }),
    });

    const inWhitePov = color === "w" ? scoreBefore : invert(scoreBefore);
    whiteWinPercents.push(winPct(inWhitePov));
  }

  const accuracyFor = (color: "w" | "b") =>
    gameAccuracy(
      moves
        .filter((m) => m.color === color)
        // ply is 1-based; the position it was played from is ply - 1.
        .map((m) => ({ accuracy: m.moveAccuracy, positionIndex: m.ply - 1 })),
      whiteWinPercents,
    );

  return {
    moves,
    accuracyUser: accuracyFor(userColor),
    accuracyOpponent: accuracyFor(userColor === "w" ? "b" : "w"),
    depth: engine.depth,
  };
}

/** How many legal moves the side to move had in this position. */
function legalMoveCount(fen: string): number {
  try {
    return new Chess(fen).moves().length;
  } catch {
    // An unreadable FEN should not decide whether a move counts as best.
    return 0;
  }
}

/**
 * Count the plies in a PGN's movetext, for comparison against what the parser
 * accepted. Deliberately rough: it only needs to catch a parse that stopped
 * early, not to be a second PGN reader.
 */
function countMovetextPlies(pgn: string): number | undefined {
  // Everything after the header block is movetext.
  const body = pgn.replace(/^\s*(\[[^\]]*\]\s*)*/, "");
  if (body.trim() === "") return undefined;

  const withoutComments = body
    .replace(/\{[^}]*\}/g, " ")
    .replace(/;[^\n]*/g, " ")
    .replace(/\$\d+/g, " ")
    // Recursive annotation variations are alternatives, not moves played.
    .replace(/\([^()]*\)/g, " ");

  const tokens = withoutComments
    .split(/\s+/)
    .filter(
      (token) =>
        token !== "" &&
        // Move numbers, results and ellipses are not moves.
        !/^\d+\.*$/.test(token) &&
        !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(token) &&
        token !== "...",
    )
    .map((token) => token.replace(/^\d+\.+/, ""))
    .filter((token) => token !== "");

  return tokens.length;
}

function playedTheBestMove(
  move: { from: string; to: string; promotion?: string },
  bestMoveUci: string | undefined,
  legalMoveCount: number,
): boolean {
  // With one legal move there was nothing to get wrong. Without this a forced
  // recapture scores as an error whenever the engine reports no best move.
  if (legalMoveCount === 1) return true;
  if (!bestMoveUci) return false;
  return `${move.from}${move.to}${move.promotion ?? ""}` === bestMoveUci;
}
