import { Chess, type Square } from "chess.js";

/**
 * Solving one puzzle: a pure state machine over a published puzzle line.
 *
 * Kept apart from React so the rule the ticket warns about is testable on its
 * own. The Lichess database stores the position BEFORE the opponent's setup
 * move, and `movesUci[0]` is that move. Showing `fen` directly displays the
 * puzzle one move too early, which makes every puzzle nonsense — so this
 * module is the ONLY place allowed to read the stored FEN, and it never hands
 * it back without the setup move applied.
 *
 * The whole line is scripted: the solver's moves and the opponent's replies
 * alternate through `movesUci`, so a "correct" move is string equality against
 * the next entry rather than an engine judgement. That is what lets practice
 * work with no network and no Stockfish.
 */

export type PuzzleLine = {
  id: string;
  /** The stored position, BEFORE the setup move. */
  fen: string;
  /** Space-separated UCI: [0] is the setup move, then solution/reply pairs. */
  movesUci: string;
  rating: number;
};

export type PuzzleStatus = "solving" | "solved" | "failed";

export type PuzzlePosition = {
  puzzle: PuzzleLine;
  /** The position to DISPLAY: the setup move is already applied. */
  fen: string;
  /** The move that led here, for the board's highlight. */
  lastMove: [Square, Square] | undefined;
  /** Whose turn it is, and therefore which way the board must face. */
  orientation: "white" | "black";
  status: PuzzleStatus;
  /** How many plies of the line have been played since the setup move. */
  solvedPlies: number;
  /** On a failure, the move that was right — so it can be shown. */
  solution: [Square, Square] | undefined;
};

/** One UCI move, split into the parts chess.js wants. */
function parseUci(uci: string): {
  from: Square;
  to: Square;
  promotion: string | undefined;
} {
  return {
    from: uci.slice(0, 2) as Square,
    to: uci.slice(2, 4) as Square,
    // The database records which piece a promotion becomes, so the solver is
    // never asked: picking a different piece would be a different move from
    // the one the line scores as correct.
    promotion: uci.length > 4 ? uci.slice(4, 5) : undefined,
  };
}

function movesOf(puzzle: PuzzleLine): string[] {
  return puzzle.movesUci.split(/\s+/).filter((move) => move !== "");
}

/**
 * The position to show, with the opponent's setup move already played.
 *
 * This is the detail the ticket singles out, and it is applied here so no
 * caller can forget it.
 */
export function openPuzzle(puzzle: PuzzleLine): PuzzlePosition | undefined {
  // Undefined rather than thrown, for the same reason `playMove` swallows an
  // illegal move: nothing validates a row's FEN or moves at import, so one
  // corrupt row among six million reaches the page. A throw here happens
  // inside a render effect with no error boundary above it, which blanks the
  // practice page — and because puzzles are drawn at random, refreshing
  // appears to fix it.
  let board: Chess;
  try {
    board = new Chess(puzzle.fen);
  } catch {
    return undefined;
  }

  const [setup] = movesOf(puzzle);

  let lastMove: [Square, Square] | undefined;
  if (setup) {
    const { from, to, promotion } = parseUci(setup);
    try {
      board.move({ from, to, promotion: promotion ?? "q" });
    } catch {
      return undefined;
    }
    lastMove = [from, to];
  }

  return {
    puzzle,
    fen: board.fen(),
    lastMove,
    // Read from the board after the setup move, never from the stored FEN:
    // the side to move there is the OPPONENT, so orienting from it would face
    // the board the wrong way on every puzzle.
    orientation: board.turn() === "w" ? "white" : "black",
    status: "solving",
    solvedPlies: 0,
    solution: undefined,
  };
}

/**
 * Play the solver's move.
 *
 * A correct move is followed immediately by the opponent's scripted reply, so
 * the returned position is always back on the solver's turn — the solver never
 * sees a board where it is not their move.
 *
 * A wrong move does NOT advance the board. The position stays where it was and
 * `solution` names the move that was right, so the answer can be shown on the
 * position it belongs to.
 */
export function playMove(
  position: PuzzlePosition,
  from: string,
  to: string,
): PuzzlePosition {
  // A finished puzzle is finished. Without this a failed attempt could be
  // walked forward into a pass after its result was already recorded.
  if (position.status !== "solving") return position;

  const line = movesOf(position.puzzle);
  // Index 0 is the setup move, so the solver's first move is index 1.
  const expected = line[position.solvedPlies + 1];
  if (!expected) return position;

  const { from: wantFrom, to: wantTo, promotion } = parseUci(expected);

  if (from !== wantFrom || to !== wantTo) {
    return {
      ...position,
      status: "failed",
      solution: [wantFrom, wantTo],
    };
  }

  const board = new Chess(position.fen);
  try {
    board.move({ from: wantFrom, to: wantTo, promotion: promotion ?? "q" });
  } catch {
    // The line says this move is legal here; if chess.js disagrees the stored
    // puzzle is malformed. Treated as a failure rather than thrown so one bad
    // row cannot break the practice page.
    return { ...position, status: "failed", solution: [wantFrom, wantTo] };
  }

  let solvedPlies = position.solvedPlies + 1;
  let lastMove: [Square, Square] = [wantFrom, wantTo];

  // The opponent's scripted answer, played at once so the solver is handed a
  // board on their own turn.
  const reply = line[solvedPlies + 1];
  if (reply) {
    const { from: replyFrom, to: replyTo, promotion: replyPromo } =
      parseUci(reply);
    board.move({ from: replyFrom, to: replyTo, promotion: replyPromo ?? "q" });
    solvedPlies += 1;
    lastMove = [replyFrom, replyTo];
  }

  return {
    ...position,
    fen: board.fen(),
    lastMove,
    solvedPlies,
    // Solved once the line runs out: every move of it has been played.
    status: solvedPlies + 1 >= line.length ? "solved" : "solving",
    solution: undefined,
  };
}
