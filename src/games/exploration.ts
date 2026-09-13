import { Chess } from "chess.js";
import type { Key } from "chessground/types";

/**
 * A line played off a position in the game, to ask "what if I had played
 * this instead?".
 *
 * Kept pure and free of React so the decisions that matter — what is legal,
 * what the position becomes, what taking a move back returns to — are
 * asserted directly rather than through a mounted board.
 *
 * Explorations are VALUES, not mutable state: every operation returns a new
 * one and leaves its input alone. A `Chess` instance is mutable and shared by
 * reference, so threading one through React state would have the board and
 * the engine disagree about the position after any re-render that replayed a
 * move — the move would be applied twice to the same object.
 */

export type ExplorationMove = {
  san: string;
  /** UCI, including a promotion suffix, so the engine can be sent this line. */
  uci: string;
  /** The position AFTER this move. */
  fen: string;
};

export type Exploration = {
  /** The game position this line branches from. */
  root: string;
  moves: ExplorationMove[];
  /** The position currently shown: the root, or the last move's result. */
  fen: string;
  /** The move that led to `fen`, for last-move highlighting. */
  lastMove: [Key, Key] | undefined;
};

/**
 * Begin exploring from a position.
 *
 * Returns undefined on a position chess.js cannot read rather than throwing:
 * the caller is a board that should stay on the game line, not one that
 * should crash.
 */
export function startExploration(fen: string): Exploration | undefined {
  let canonical: string;
  try {
    canonical = new Chess(fen).fen();
  } catch {
    return undefined;
  }

  // The board chess.js actually read, not the string it was handed.
  //
  // Deliberately NOT `canonical !== fen ? undefined : fen`. Every stored FEN
  // round-trips today, but a producer that spells the en-passant or halfmove
  // field differently would make the first drag on a position do nothing at
  // all — while the legal-move dots still showed, so the board would look
  // alive. Normalising keeps it working; only a position chess.js cannot read
  // at all is refused.
  return { root: canonical, moves: [], fen: canonical, lastMove: undefined };
}

/**
 * Play one move onto the end of a line.
 *
 * Returns undefined when the move is illegal, so an impossible drag leaves
 * the line exactly as it was.
 */
export function playExploration(
  line: Exploration,
  from: Key,
  to: Key,
): Exploration | undefined {
  const board = new Chess(line.fen);

  let played;
  try {
    played = board.move({
      from,
      to,
      // A board drag carries no choice of piece, and a promotion with none
      // named is rejected outright. Queen is what a promotion is, short of
      // asking — and being unable to promote at all is the worse failure.
      promotion: "q",
    });
  } catch {
    return undefined;
  }
  if (!played) return undefined;

  const move: ExplorationMove = {
    san: played.san,
    uci: `${played.from}${played.to}${played.promotion ?? ""}`,
    fen: board.fen(),
  };

  return {
    root: line.root,
    moves: [...line.moves, move],
    fen: move.fen,
    lastMove: [played.from as Key, played.to as Key],
  };
}

/** Take the last move back. At the root this is a no-op. */
export function undoExploration(line: Exploration): Exploration {
  if (line.moves.length === 0) return line;

  const moves = line.moves.slice(0, -1);
  const previous = moves.at(-1);

  return {
    root: line.root,
    moves,
    fen: previous?.fen ?? line.root,
    lastMove: previous ? squaresOf(previous.uci) : undefined,
  };
}

function squaresOf(uci: string): [Key, Key] {
  return [uci.slice(0, 2) as Key, uci.slice(2, 4) as Key];
}
