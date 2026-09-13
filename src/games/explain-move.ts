import { THRESHOLDS } from "@/analysis/accuracy";
import type { MoveRow } from "./queries";

/**
 * Why a move earned the mark it did.
 *
 * The scoresheet shows `??` and `!` with nothing to say what they mean or how
 * they were decided. The numbers behind them are already stored — the win
 * probability before and after, and the move the engine preferred — so the
 * reader can be told rather than left to infer.
 *
 * Classification keys on win probability, never on raw centipawns: a
 * three-pawn drop in an already-won position is not a blunder, and saying so
 * in the explanation is the difference between a verdict and a lecture.
 */

export type MoveExplanation = {
  /** What the mark means, e.g. "Blunder". */
  name: string;
  /** Why this move got it, in one sentence. */
  why: string;
  /** The engine's preference, in UCI, when it differed. */
  betterMove: string | undefined;
};

const NAMES: Record<string, string> = {
  best: "Best move",
  excellent: "Excellent",
  good: "Good",
  inaccuracy: "Inaccuracy",
  mistake: "Mistake",
  blunder: "Blunder",
};

/** What each mark means, for a legend. Ordered best to worst. */
export const CLASSIFICATION_LEGEND = [
  {
    key: "best",
    symbol: "★",
    name: "Best move",
    meaning: "Exactly what the engine would have played.",
  },
  {
    key: "excellent",
    symbol: "!",
    name: "Excellent",
    meaning: `Not the engine's first choice, but gave up under ${THRESHOLDS.excellent} points of win probability.`,
  },
  {
    key: "good",
    symbol: "",
    name: "Good",
    meaning: `Gave up under ${THRESHOLDS.good} points. Unmarked, because most moves are fine.`,
  },
  {
    key: "inaccuracy",
    symbol: "?!",
    name: "Inaccuracy",
    meaning: `Gave up ${THRESHOLDS.good}-${THRESHOLDS.inaccuracy} points of win probability.`,
  },
  {
    key: "mistake",
    symbol: "?",
    name: "Mistake",
    meaning: `Gave up ${THRESHOLDS.inaccuracy}-${THRESHOLDS.mistake} points.`,
  },
  {
    key: "blunder",
    symbol: "??",
    name: "Blunder",
    meaning: `Gave up more than ${THRESHOLDS.mistake} points of win probability.`,
  },
] as const;

export function explainMove(move: MoveRow): MoveExplanation | undefined {
  const { classification, winPctBefore, winPctAfter } = move;
  if (!classification) return undefined;

  const name = NAMES[classification] ?? classification;
  const betterMove =
    move.bestMoveUci && move.bestMoveUci !== move.uci
      ? move.bestMoveUci
      : undefined;

  if (classification === "best") {
    return { name, why: "The engine's first choice.", betterMove: undefined };
  }

  if (winPctBefore == null || winPctAfter == null) {
    return { name, why: "No evaluation stored for this move.", betterMove };
  }

  const drop = Math.max(0, winPctBefore - winPctAfter);
  const rounded = drop.toFixed(1);

  // Said in terms of winning chances rather than centipawns, because that is
  // what the classification actually measures — and because "you went from
  // winning to losing" is the fact that matters, not the pawn count.
  const swing = describeSwing(winPctBefore, winPctAfter);
  const why =
    drop < THRESHOLDS.excellent
      ? `Cost ${rounded} points of win probability — barely anything.`
      : `Cost ${rounded} points of win probability${swing ? `: ${swing}` : ""}.`;

  return { name, why, betterMove };
}

/** "you were winning, now it is level" — the swing in plain words. */
function describeSwing(before: number, after: number): string | undefined {
  const from = band(before);
  const to = band(after);
  if (from === to) return undefined;
  return `${from} → ${to}`;
}

function band(winPct: number): string {
  if (winPct >= 85) return "winning";
  if (winPct >= 62) return "clearly better";
  if (winPct >= 55) return "slightly better";
  if (winPct > 45) return "level";
  if (winPct > 38) return "slightly worse";
  if (winPct > 15) return "clearly worse";
  return "losing";
}

/** "e2e4" rendered as "e2-e4", which reads more like a move. */
export function formatUci(uci: string): string {
  if (uci.length < 4) return uci;
  const promotion = uci.length > 4 ? `=${uci.slice(4).toUpperCase()}` : "";
  return `${uci.slice(0, 2)}-${uci.slice(2, 4)}${promotion}`;
}
