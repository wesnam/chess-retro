/**
 * The arithmetic every number in the app is derived from.
 *
 * Two conventions matter more than anything else here:
 *
 * 1. **Perspective.** Engines report from the side-to-move's point of view, and
 *    that flips every ply. Everything in this module works in the *mover's*
 *    perspective — positive means good for the player who just moved.
 * 2. **Win probability, not centipawns.** A three-pawn drop in an already
 *    overwhelming position is not a blunder. Classification keys on how much
 *    win probability a move threw away, never on the raw centipawn delta.
 */

/** An engine verdict for one position, in the perspective of the side to move. */
export type Score =
  | { kind: "cp"; cp: number }
  | { kind: "mate"; moves: number };

/** Centipawn value a forced mate stands in for when arithmetic needs a number. */
export const MATE_CP = 10_000;

/**
 * Lichess clamps to ±1000 before converting: beyond about ten pawns the
 * practical win probability stops moving.
 */
const WIN_PCT_CLAMP = 1000;

/** Flip a score to the opposite player's perspective. */
export function invert(score: Score): Score {
  if (score.kind === "cp") return { kind: "cp", cp: -score.cp };

  // `mate 0` is "the side to move is checkmated". Negating zero would leave
  // it unchanged, making the position lost for both players; from the other
  // side it is a delivered mate, which `mate 1` is the nearest expression of.
  if (score.moves === 0) return { kind: "mate", moves: 1 };

  return { kind: "mate", moves: -score.moves };
}

/**
 * A score as a single centipawn number, for comparisons and storage maths.
 * Mate is mapped far beyond any real evaluation, nearer the closer it is.
 */
export function toCp(score: Score): number {
  if (score.kind === "cp") return score.cp;

  // `mate 0` means the side to move is ALREADY checkmated — the worst
  // possible score, not the best. Stockfish emits it for a finished position.
  if (score.moves === 0) return -MATE_CP;

  const magnitude = MATE_CP - Math.min(Math.abs(score.moves), 99);
  return score.moves > 0 ? magnitude : -magnitude;
}

/**
 * Win probability for the side to move, 0-100.
 *
 * Lichess's logistic fit over real game outcomes:
 *   50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)
 */
export function winPct(score: Score): number {
  // `mate 0` is an already-checkmated side to move: certainty of loss.
  if (score.kind === "mate") return score.moves > 0 ? 100 : 0;

  const cp = clamp(score.cp, -WIN_PCT_CLAMP, WIN_PCT_CLAMP);
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

/**
 * Accuracy for a single move, 0-100, from the win percentages before and after
 * it — both in the *mover's* perspective.
 *
 * Lichess's exponential fit:
 *   103.1668 * exp(-0.04354 * drop) - 3.1669
 */
export function moveAccuracy(winPctBefore: number, winPctAfter: number): number {
  const drop = Math.max(0, winPctBefore - winPctAfter);
  const raw = 103.1668 * Math.exp(-0.04354 * drop) - 3.1669;
  return clamp(raw, 0, 100);
}

export type Classification =
  | "best"
  | "excellent"
  | "good"
  | "inaccuracy"
  | "mistake"
  | "blunder";

/**
 * Win-percentage thresholds for each label. Keyed on the drop in win
 * probability, which is what makes a large centipawn swing in an already-won
 * position correctly *not* a blunder.
 */
export const THRESHOLDS = {
  excellent: 2,
  good: 5,
  inaccuracy: 10,
  mistake: 20,
} as const;

export function classify(options: {
  winPctBefore: number;
  winPctAfter: number;
  /** True when the move played was the engine's first choice. */
  isBestMove: boolean;
}): Classification {
  if (options.isBestMove) return "best";

  const drop = Math.max(0, options.winPctBefore - options.winPctAfter);
  if (drop < THRESHOLDS.excellent) return "excellent";
  if (drop < THRESHOLDS.good) return "good";
  if (drop < THRESHOLDS.inaccuracy) return "inaccuracy";
  if (drop < THRESHOLDS.mistake) return "mistake";
  return "blunder";
}

/**
 * Whole-game accuracy from one player's move accuracies, in order.
 *
 * Lichess's method: the mean of a volatility-weighted mean and a harmonic
 * mean. The weighting makes mistakes in sharp positions count for more than
 * mistakes in quiet ones; the harmonic mean stops a run of easy moves from
 * hiding a catastrophe.
 *
 * `winPercents` is every position's win percentage across the whole game, in
 * White's perspective, used to measure volatility around each move.
 */
export function gameAccuracy(
  moves: Array<{ accuracy: number; positionIndex: number }>,
  winPercents: number[],
): number | undefined {
  if (moves.length === 0) return undefined;

  const accuracies = moves.map((m) => m.accuracy);
  const weights = volatilityWeights(moves, winPercents);
  const weighted = weightedMean(accuracies, weights);
  const harmonic = harmonicMean(accuracies);

  return clamp((weighted + harmonic) / 2, 0, 100);
}

/**
 * Standard deviation of win percentage in a window around each move — high
 * where the game was swinging, low where it was quiet.
 *
 * Each move carries its own index into the position sequence. Mapping a
 * colour-filtered list proportionally instead would weight every one of
 * Black's moves by the volatility around White's.
 */
function volatilityWeights(
  moves: Array<{ positionIndex: number }>,
  winPercents: number[],
): number[] {
  if (winPercents.length === 0) return new Array(moves.length).fill(1);

  const windowSize = clamp(Math.floor(winPercents.length / 10), 2, 8);

  return moves.map(({ positionIndex }) => {
    const centre = clamp(positionIndex, 0, winPercents.length - 1);
    const from = Math.max(0, centre - windowSize);
    const to = Math.min(winPercents.length, centre + windowSize + 1);

    // A floor of 0.5 keeps a completely quiet stretch from weighing nothing.
    return Math.max(standardDeviation(winPercents.slice(from, to)), 0.5);
  });
}

function weightedMean(values: number[], weights: number[]): number {
  let total = 0;
  let weightSum = 0;
  for (let i = 0; i < values.length; i += 1) {
    const weight = weights[i] ?? 1;
    total += values[i]! * weight;
    weightSum += weight;
  }
  return weightSum === 0 ? mean(values) : total / weightSum;
}

function harmonicMean(values: number[]): number {
  // A single 0% move would make the harmonic mean 0 and swamp everything, so
  // values are floored just above zero.
  let total = 0;
  for (const value of values) total += 1 / Math.max(value, 0.01);
  return values.length / total;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  const variance =
    values.reduce((sum, v) => sum + (v - average) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
