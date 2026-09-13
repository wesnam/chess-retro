/**
 * Naming a stored ply the way a chess player would.
 *
 * The database counts plies — one per move by either side, starting at 1 —
 * while people count moves, one per pair. Ply 36 is move 18, and because it is
 * even it is Black's, written "18...Nc6".
 *
 * The side matters as much as the number. "18. Nc6" is a real move number
 * belonging to the other player, so a reader following the citation lands on
 * something that was genuinely played and is not the move being discussed —
 * wrongness that reads as correct. It also reached the coaching prompt, where
 * a model either has to infer the convention or quote the ply as a move number
 * and send the reader past the end of the game.
 */

/** The move number a ply falls in. Plies 1 and 2 are both move 1. */
export function moveNumber(ply: number): number {
  return Math.ceil(ply / 2);
}

/** True for plies Black played — the even ones. */
export function isBlackPly(ply: number): boolean {
  return ply % 2 === 0;
}

/** "41. b3" for White, "18...Nc6" for Black. */
export function describeMove(ply: number, san: string): string {
  return isBlackPly(ply)
    ? `${moveNumber(ply)}...${san}`
    : `${moveNumber(ply)}. ${san}`;
}
