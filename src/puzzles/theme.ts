import { Chess, type Square } from "chess.js";
import type { Dests, Key } from "chessground/types";
import { KNOWN_THEMES } from "@/insights/validate";

/**
 * Turning a weakness into something practisable.
 *
 * Motif keys are Lichess's exact theme strings, which is what makes matching a
 * weakness to puzzles a direct lookup with no translation table. The gate
 * below is the whole reason this is a function rather than reading `.key`:
 *
 * A `phase` weakness has the key "opening" or "endgame", and BOTH are real
 * Lichess puzzle themes. Looking up puzzles by a bare key would quietly serve
 * endgame puzzles for a weakness about how someone handles endgames — a
 * different claim entirely — and the page would look like it was working.
 * Only `dimension === "motif"` carries a theme.
 */

/** The theme to drill for this weakness, or undefined if it is not drillable. */
export function practiceTheme(weakness: {
  dimension: string;
  key: string;
}): string | undefined {
  if (weakness.dimension !== "motif") return undefined;
  // A motif no detector emits has no puzzles behind it, and a practice link
  // to an empty set is worse than no link at all.
  if (!KNOWN_THEMES.has(weakness.key)) return undefined;
  return weakness.key;
}

/**
 * Every legal move in a position, as chessground wants it.
 *
 * chessground permits any move it is not told is illegal. Without this a
 * solver can drag a bishop like a rook and be told they got the puzzle wrong,
 * which reads as a broken board rather than a failed attempt.
 */
export function legalDests(fen: string): Dests {
  const board = new Chess(fen);
  const dests: Dests = new Map();

  for (const move of board.moves({ verbose: true })) {
    const from = move.from as Square as Key;
    const existing = dests.get(from);
    if (existing) {
      existing.push(move.to as Square as Key);
    } else {
      dests.set(from, [move.to as Square as Key]);
    }
  }

  return dests;
}
