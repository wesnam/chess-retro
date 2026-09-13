import { practiceTheme } from "./theme";

/**
 * Why a weakness carries no practice link.
 *
 * Puzzles are tagged by tactical motif, so only a motif weakness can be
 * drilled — `practiceTheme` is the gate, and it is deliberately strict: a
 * `phase` weakness has the key "opening" or "endgame" and BOTH are real
 * Lichess themes, so a bare key lookup would serve endgame puzzles for a
 * weakness about how someone handles endgames and the page would look like it
 * was working.
 *
 * Being right is not the same as being legible. A dashboard showing three
 * weaknesses where two have a practice link and the third has nothing reads as
 * a gap, not a decision — and the ones that fall through are often the most
 * actionable, since "your king moves go wrong" usually means king safety. The
 * card should say why the button is absent rather than leave a hole.
 */

const REASONS: Record<string, string> = {
  piece: "There are no puzzles for this: it is a pattern in how you handle one piece across whole games, not a tactic to spot. The examples below are where it cost you most.",
  phase: "There are no puzzles for this: it is about how you play a whole stretch of the game, not a tactic to spot. The examples below are where it cost you most.",
  time: "There are no puzzles for this: it is about how you spend your clock, not a tactic to spot. The examples below are where it cost you most.",
  opening: "There are no puzzles for this: it is about a line you keep scoring badly from, not a tactic to spot. Reviewing the examples below is the way in.",
};

/** A motif with no detector behind it, and anything unforeseen. */
const FALLBACK =
  "There are no puzzles matching this one. The examples below are where it cost you most.";

/**
 * The sentence to show where the practice link would be, or undefined when
 * there is a link to show instead.
 */
export function whyNoPractice(weakness: {
  dimension: string;
  key: string;
}): string | undefined {
  // Asked of the same function that decides the link, so the two can never
  // disagree — a card cannot show both a link and a reason it has none.
  if (practiceTheme(weakness)) return undefined;
  return REASONS[weakness.dimension] ?? FALLBACK;
}
