/**
 * How many of each mark the player earned in one game.
 *
 * Tallied from move rows the caller already holds rather than queried: the
 * game page loads every move to draw the board and the scoresheet, so counting
 * them costs nothing, while a second grouped query would read the same rows
 * again for a six-number summary.
 */

export type MoveMarks = {
  best: number;
  excellent: number;
  good: number;
  inaccuracy: number;
  mistake: number;
  blunder: number;
};

/** The grades, worst-to-best order being the caller's business, not this one's. */
export const MARK_GRADES = [
  "best",
  "excellent",
  "good",
  "inaccuracy",
  "mistake",
  "blunder",
] as const;

export function emptyMarks(): MoveMarks {
  return {
    best: 0,
    excellent: 0,
    good: 0,
    inaccuracy: 0,
    mistake: 0,
    blunder: 0,
  };
}

export function tallyMarks(
  moves: readonly { classification: string | null; isUserMove: boolean }[],
): MoveMarks {
  const marks = emptyMarks();

  for (const move of moves) {
    if (!move.isUserMove) continue;
    // An unclassified move is an unanalysed one, and a grade this version does
    // not know about cannot be placed in the six — both are skipped rather
    // than bucketed somewhere convenient.
    if (!isGrade(move.classification)) continue;
    marks[move.classification] += 1;
  }

  return marks;
}

export function isGrade(value: string | null): value is keyof MoveMarks {
  return value !== null && (MARK_GRADES as readonly string[]).includes(value);
}
