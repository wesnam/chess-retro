/**
 * How well one game was played, placed among games that were measured.
 *
 * This is NOT a rating, and the distinction is the whole reason the module
 * exists. It replaced an estimate that claimed one, which the data could not
 * support: 271 games were crawled across chess.com rating bands 800-2400 and
 * analysed with this project's own engine pipeline, and the best formula over
 * these six marks explains 6% of the variance in rating (r = 0.24). The
 * optimal weighting of all six marks PLUS whole-game accuracy reaches 7%.
 * Per-game blunder rate barely separates the bands at all — 0.056 at band 800
 * against 0.031 at 2400, with a within-band SD of 0.042, larger than the
 * difference it would have to carry.
 *
 * So a single game does not tell you who played it. What it does tell you is
 * how this game went relative to other real games, which is what this reports.
 */

import type { MoveMarks } from "./move-marks";

/**
 * The score behind the percentile: the engine's own choices, less the moves
 * that threw something away.
 *
 * Chosen by measurement, not taste. Against whole-game accuracy (r = 0.20)
 * this scores r = 0.24 on the same 271 games — the best of every combination
 * tried, and within a whisker of the optimal weighting of all six marks.
 * Ratio and log forms of the same marks were tested and all did WORSE
 * (log(best)-log(blunder) reached only r^2 = 0.025 against this one's 0.058):
 * a ratio amplifies small differences, and at the per-game level those
 * differences are mostly noise.
 *
 * Undefined for a game with no classified moves, since a rate needs a
 * denominator and zero of six marks is an unanalysed game, not a bad one.
 */
export function qualityScore(marks: MoveMarks): number | undefined {
  const total =
    marks.best +
    marks.excellent +
    marks.good +
    marks.inaccuracy +
    marks.mistake +
    marks.blunder;
  if (total === 0) return undefined;

  return (marks.best - marks.blunder - marks.mistake) / total;
}

/**
 * The score distribution of the reference corpus, every 5th percentile.
 *
 * 271 rated rapid games, 30 players per band across 800-2400, one game each —
 * one game per PLAYER rather than several from a few, because the spread
 * between players of the same strength is real and does not shrink by taking
 * more games from one of them.
 *
 * Quantiles rather than the raw scores: 21 numbers interpolate to within 2.8
 * percentile points of the true rank, and the corpus itself is not something
 * this app needs to carry.
 */
const QUALITY_QUANTILES = [
  -0.1818, 0.0882, 0.1667, 0.1944, 0.2143, 0.2326, 0.2655, 0.2778, 0.2941,
  0.3125, 0.3333, 0.3636, 0.381, 0.4063, 0.4167, 0.439, 0.46, 0.5, 0.52,
  0.5714, 0.7273,
] as const;

/** Percentile spacing of the table above. */
const QUANTILE_STEP = 100 / (QUALITY_QUANTILES.length - 1);

/**
 * Where a score falls among the measured games, 0-100.
 *
 * Clamped at both ends rather than extrapolated: a game cleaner than anything
 * in the corpus is "better than all of them", which is 100, and inventing 104
 * would claim a precision the corpus cannot give.
 */
export function qualityPercentile(score: number | undefined): number | undefined {
  if (score === undefined || !Number.isFinite(score)) return undefined;

  const first = QUALITY_QUANTILES[0]!;
  const last = QUALITY_QUANTILES[QUALITY_QUANTILES.length - 1]!;
  if (score <= first) return 0;
  if (score >= last) return 100;

  for (let i = 0; i < QUALITY_QUANTILES.length - 1; i += 1) {
    const low = QUALITY_QUANTILES[i]!;
    const high = QUALITY_QUANTILES[i + 1]!;
    if (score >= low && score <= high) {
      const span = high - low;
      const within = span === 0 ? 0 : (score - low) / span;
      return Math.round((i + within) * QUANTILE_STEP);
    }
  }

  return 100;
}

/** How many games the percentile is measured against. */
export const QUALITY_CORPUS_SIZE = 271;

/**
 * The percentile as a phrase.
 *
 * The corpus travels with the number: "64th percentile" alone invites "of
 * what?", and the answer — 271 rated games across a wide range of strengths —
 * is what makes the figure mean anything.
 */
export function describeQuality(percentile: number | undefined): string | undefined {
  if (percentile === undefined) return undefined;

  return `better than ${percentile}% of ${QUALITY_CORPUS_SIZE} rated games`;
}
