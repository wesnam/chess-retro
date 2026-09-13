/**
 * Mapping a position index to the plies it is about.
 *
 * `buildReview` sets the convention: a move highlights on the position it
 * PRODUCED, so ply N belongs to position N, and position 0 is the starting
 * position with no move behind it. The board, the eval bar, the graph cursor
 * and the scoresheet all key off that single number.
 *
 * These two functions exist because the review pane had drifted off it — the
 * verdict looked up `index + 1`, describing the move about to be played rather
 * than the one that was, so the opening position rated White's first move
 * while the board still showed the untouched starting position. Naming the two
 * meanings apart is what stops them being confused again: a position has a
 * move BEHIND it and a move AHEAD of it, and they are not the same ply.
 */

/**
 * The ply this position is the result of — what a verdict here describes.
 *
 * Undefined at the starting position: nothing has been played, so there is
 * nothing to rate.
 */
export function plyShownAt(positionIndex: number): number | undefined {
  return positionIndex >= 1 ? positionIndex : undefined;
}

/**
 * The ply played FROM this position — what an arrow drawn here points at.
 *
 * Defined at position 0, where the engine's preferred opening move is a real
 * suggestion even though no move has been played.
 */
export function plyPlayedFrom(positionIndex: number): number {
  return positionIndex + 1;
}
