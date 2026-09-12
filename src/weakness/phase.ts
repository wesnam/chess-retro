import { Chess } from "chess.js";

/**
 * Which phase of the game a position belongs to.
 *
 * Derived from the material on the board rather than the move number. A
 * queenless simplified position reached on move 12 is an endgame and a full
 * board on move 40 is not, so a move-number cutoff mislabels both — and every
 * error in a mislabelled position is attributed to the wrong phase.
 *
 * The rule follows the common convention: count the non-pawn, non-king
 * material each side has developed out of the opening, and treat the queens
 * coming off alongside light material as the start of the endgame.
 */
export type Phase = "opening" | "middlegame" | "endgame";

/** Piece weights for the phase judgement; pawns and kings are not counted. */
const PHASE_WEIGHTS: Record<string, number> = { n: 1, b: 1, r: 2, q: 4 };

/** Total weight on a full board: (2 knights + 2 bishops + 2 rooks*2 + queen*4) x 2. */
const FULL_PHASE_MATERIAL = 24;

/** At or below this much remaining material the position is an endgame. */
const ENDGAME_MATERIAL = 6;

/** Plies before which a position with near-full material is still the opening. */
const OPENING_MAX_PLY = 20;

/**
 * Minor pieces still on their home square for the position to count as the
 * opening. Of the eight minors, more than half still at home means the sides
 * are still developing. A lower bar catches ordinary castled middlegames,
 * where a queen's bishop routinely sits at home long after the opening ends.
 */
const OPENING_MIN_UNDEVELOPED = 5;

export function phaseOf(fen: string): Phase | undefined {
  let board;
  let ply: number;
  try {
    const chess = new Chess(fen);
    board = chess.board();
    // Full moves are 1-based and cover two plies each.
    ply = (chess.moveNumber() - 1) * 2 + (chess.turn() === "b" ? 1 : 0);
  } catch {
    // An unreadable position must not default into a phase; a wrong label is
    // worse than an absent one, because it silently skews the dimension.
    return undefined;
  }

  let material = 0;
  let backRankUndeveloped = 0;
  for (const rank of board) {
    for (const square of rank) {
      if (!square) continue;
      material += PHASE_WEIGHTS[square.type] ?? 0;

      // Minor pieces still sitting on their original rank: the marker that
      // the opening is not yet finished.
      const homeRank = square.color === "w" ? "1" : "8";
      if (
        (square.type === "n" || square.type === "b") &&
        square.square.endsWith(homeRank)
      ) {
        backRankUndeveloped += 1;
      }
    }
  }

  if (material <= ENDGAME_MATERIAL) return "endgame";

  // Still early, nearly everything still on, and most minors still at home:
  // the opening is not over.
  if (
    ply < OPENING_MAX_PLY &&
    material >= FULL_PHASE_MATERIAL - 2 &&
    backRankUndeveloped >= OPENING_MIN_UNDEVELOPED
  ) {
    return "opening";
  }

  return "middlegame";
}
