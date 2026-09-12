import { Chess } from "chess.js";
import type { Key } from "chessground/types";
import { winPct, type Score } from "@/analysis/accuracy";

/**
 * Turns stored move rows into everything the board needs to render.
 *
 * Kept free of React and of chessground so the decisions that matter — which
 * position a step lands on, where an arrow points, how the graph runs — can be
 * asserted directly. The component below it is only wiring.
 */

export type ReviewMoveInput = {
  color: string;
  san: string;
  uci: string;
  fenBefore: string;
  isUserMove: boolean;
  evalBefore: number | null;
  evalAfter: number | null;
  mateBefore: number | null;
  mateAfter: number | null;
  bestMoveUci: string | null;
  classification: string | null;
};

export type ReviewPosition = {
  fen: string;
  /** The move that led here, as [from, to], for last-move highlighting. */
  lastMove: [Key, Key] | undefined;
  /**
   * The engine's preferred move FROM this position, when the reviewer played a
   * serious error here. This is the "you played X, best was Y" arrow.
   */
  bestMove: [Key, Key] | undefined;
};

export type ReviewGraphPoint = {
  /** Index into `positions`, so clicking a point jumps to that position. */
  positionIndex: number;
  /** Win probability for White, 0–100. */
  whiteWinPct: number;
  classification: string | null;
  isUserMove: boolean;
};

export type Review = {
  /**
   * Indexed by ply: position 0 is the starting position, position N is the one
   * reached after ply N. The board, the eval bar, the scoresheet and the graph
   * all address positions by this same number.
   */
  positions: ReviewPosition[];
  graph: ReviewGraphPoint[];
  orientation: "white" | "black";
  lastPositionIndex: number;
};

/** Classifications worth interrupting the reviewer with an arrow. */
const SERIOUS = new Set(["inaccuracy", "mistake", "blunder"]);

export function buildReview({
  moves,
  userColor,
}: {
  moves: ReviewMoveInput[];
  userColor: string;
}): Review {
  const orientation = userColor === "b" ? "black" : "white";

  if (moves.length === 0) {
    return { positions: [], graph: [], orientation, lastPositionIndex: 0 };
  }

  const positions: ReviewPosition[] = moves.map((move) => ({
    fen: move.fenBefore,
    lastMove: undefined,
    bestMove: arrowFor(move),
  }));

  // Rows store the position before each move, so the position the game ended
  // in belongs to no row and has to be played out from the last one.
  const final = finalFen(moves.at(-1)!);
  if (final) {
    positions.push({ fen: final, lastMove: undefined, bestMove: undefined });
  }

  // Each move highlights on the position it produced, which is the next one.
  // The last move has no following position if the final one could not be
  // derived, so this stops at what actually exists.
  for (const [index, move] of moves.entries()) {
    const next = positions[index + 1];
    if (next) next.lastMove = squaresOf(move.uci);
  }

  const graph: ReviewGraphPoint[] = [];
  for (const [index, move] of moves.entries()) {
    const score = whitePovScore(move);
    if (!score) continue;
    graph.push({
      // The position this move led to. Everything — board, eval bar, graph
      // cursor, scoresheet selection — keys off this one number.
      positionIndex: index + 1,
      whiteWinPct: winPct(score),
      classification: move.classification,
      isUserMove: move.isUserMove,
    });
  }

  return { positions, graph, orientation, lastPositionIndex: positions.length - 1 };
}

/**
 * The arrow to draw on the position this move was played from.
 *
 * Only the reviewer's own serious errors get one: the opponent's mistakes are
 * not their lesson, and an arrow pointing at the move actually played would
 * read as "you should have played what you played".
 */
function arrowFor(move: ReviewMoveInput): [Key, Key] | undefined {
  if (!move.isUserMove) return undefined;
  if (!move.classification || !SERIOUS.has(move.classification)) return undefined;
  if (!move.bestMoveUci) return undefined;
  if (move.bestMoveUci === move.uci) return undefined;
  return squaresOf(move.bestMoveUci);
}

const SQUARE = /^[a-h][1-8]$/;

/**
 * Split a UCI move into its two squares.
 *
 * The promotion suffix is dropped: chessground takes squares, and "a7a8q"
 * whole would give it a three-character square that matches nothing. Each half
 * is validated rather than cast, because a malformed square reaching the board
 * highlights nothing at all — harder to notice than a missing arrow.
 */
function squaresOf(uci: string): [Key, Key] | undefined {
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  if (!SQUARE.test(from) || !SQUARE.test(to)) return undefined;
  return [from as Key, to as Key];
}

/**
 * Play the last move out to get the position the game finished in.
 *
 * Returns undefined rather than falling back to the position before the move:
 * a duplicate final position would show the board one move behind while the
 * evaluation beside it described the move that had already been played.
 */
function finalFen(last: ReviewMoveInput): string | undefined {
  try {
    const chess = new Chess(last.fenBefore);
    chess.move(
      last.uci.length >= 4
        ? {
            from: last.uci.slice(0, 2),
            to: last.uci.slice(2, 4),
            promotion: last.uci.slice(4) || undefined,
          }
        : last.san,
    );
    return chess.fen();
  } catch {
    return undefined;
  }
}

/**
 * The evaluation after a move, converted to White's perspective.
 *
 * Stored evaluations are in the MOVER's perspective, which flips every ply. A
 * graph plotting them raw would zig-zag regardless of what happened.
 */
export function whitePovScore(move: {
  evalAfter: number | null;
  mateAfter: number | null;
  color: string;
}): Score | undefined {
  const sign = move.color === "w" ? 1 : -1;

  if (move.mateAfter != null) {
    return { kind: "mate", moves: move.mateAfter * sign };
  }
  if (move.evalAfter != null) {
    return { kind: "cp", cp: move.evalAfter * sign };
  }
  return undefined;
}

/**
 * How much of the eval bar White fills, 0–1.
 *
 * Win probability rather than raw centipawns, so the bar moves where the game
 * moves: the difference between +1 and +3 matters far more than between +8
 * and +10.
 */
export function evalBarFraction(score: Score | undefined): number {
  if (!score) return 0.5;
  return winPct(score) / 100;
}
