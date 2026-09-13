import { motifExplanation, motifTitle } from "@/analysis/motifs/labels";
import type { ScoredWeakness } from "./score";

/**
 * Turning a scored weakness into something a person can act on.
 *
 * The dashboard previously led with a bare identifier — "deflection" — and
 * four statistics. That assumes the reader can already name their own
 * weakness, which is the thing they came to find out. Every card now states a
 * claim, says what the idea is, and says how it was measured.
 */

export type WeaknessCopy = {
  /** The claim, e.g. "You miss deflections". */
  title: string;
  /** What the idea is, for someone who does not already know. */
  explanation: string | undefined;
  /** How this was measured, in one sentence. */
  evidence: string;
};

const PHASE_TITLES: Record<string, string> = {
  opening: "You go wrong in the opening",
  middlegame: "You go wrong in the middlegame",
  endgame: "You go wrong in the endgame",
};

const PHASE_WHAT: Record<string, string> = {
  opening:
    "The first dozen moves, while pieces are still coming out. Errors here are usually a repertoire gap rather than a calculation slip.",
  middlegame:
    "Once both sides have developed and the position is sharp. The longest phase, and where most games are decided.",
  endgame:
    "Few pieces left, kings active. Errors here are technique — knowing the winning method rather than finding a tactic.",
};

const PIECE_TITLES: Record<string, string> = {
  p: "Your pawn moves go wrong",
  n: "Your knight moves go wrong",
  b: "Your bishop moves go wrong",
  r: "Your rook moves go wrong",
  q: "Your queen moves go wrong",
  k: "Your king moves go wrong",
};

const PIECE_WHAT: Record<string, string> = {
  p: "Pawn moves are permanent — a pawn cannot come back. Structural mistakes here last the whole game.",
  n: "Knights move unlike everything else, so their forks and retreats are the easiest to miscount.",
  b: "Bishops are long-range and easy to leave hanging on a diagonal you stopped watching.",
  r: "Rooks need open files and back-rank safety; misplaced ones sit idle or fall to a skewer.",
  q: "The queen is the most valuable piece and the easiest to trap by chasing material with it.",
  k: "King moves decide safety. Errors here are castling too late, walking into checks, or activating the king at the wrong moment.",
};

const TIME_TITLES: Record<string, string> = {
  scramble: "You go wrong under ten seconds",
  low: "You go wrong under thirty seconds",
  comfortable: "You go wrong with time on the clock",
};

const TIME_WHAT: Record<string, string> = {
  scramble:
    "Moves played with almost no clock left. Errors here are a time-management problem, not a chess one.",
  low: "Moves played while short of time but not yet desperate.",
  comfortable:
    "Moves played with time to think. Errors here cannot be blamed on the clock — they are genuine gaps in judgement.",
};

export function weaknessCopy(weakness: ScoredWeakness): WeaknessCopy {
  const { dimension, key, label } = weakness;

  const title =
    dimension === "motif"
      ? motifTitle(key)
      : dimension === "phase"
        ? (PHASE_TITLES[key] ?? `You go wrong in ${label}`)
        : dimension === "piece"
          ? (PIECE_TITLES[key] ?? `Your ${label} go wrong`)
          : dimension === "time"
            ? (TIME_TITLES[key] ?? `You go wrong ${label}`)
            : `You score badly from the ${label}`;

  const explanation =
    dimension === "motif"
      ? motifExplanation(key)
      : dimension === "phase"
        ? PHASE_WHAT[key]
        : dimension === "piece"
          ? PIECE_WHAT[key]
          : dimension === "time"
            ? TIME_WHAT[key]
            : `Games that began with this opening. Errors here may be a repertoire gap rather than a general weakness.`;

  return { title, explanation, evidence: evidenceSentence(weakness) };
}

/**
 * How the claim was measured, said plainly.
 *
 * Two different sentences because the two ranking paths answer different
 * questions, and conflating them would misrepresent the weaker one. A peer
 * comparison says "worse than players like you"; the fallback can only say
 * "worse than you usually play", which is a lesser claim and should read like
 * one.
 */
function evidenceSentence(weakness: ScoredWeakness): string {
  const yours = Math.round(weakness.failureRate * 100);
  const chances = weakness.opportunities.toLocaleString();
  const cost = Math.round(weakness.winPctLost).toLocaleString();

  if (weakness.referenceMissRate !== undefined) {
    const peers = Math.round(weakness.referenceMissRate * 100);
    const gap = yours - peers;
    return `It came up ${chances} times and you got it wrong ${yours}% of them. Players at your rating get it wrong ${peers}% of the time, so you are ${gap} point${gap === 1 ? "" : "s"} worse. Cost you ${cost} points of win probability.`;
  }

  return `It came up ${chances} times and you got it wrong ${yours}% of them, costing ${cost} points of win probability — ${weakness.lift.toFixed(1)}× what an average move of yours costs. No comparison against other players is available for this one yet.`;
}
