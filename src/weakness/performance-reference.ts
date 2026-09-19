import type { AccuracyRatingPair } from "./performance-rating";

/**
 * Mean chess.com accuracy per rating band, rapid.
 *
 * Harvested from chess.com's own published `accuracies` field rather than
 * measured with Stockfish: the games API ships an accuracy for roughly 15% of
 * games (those where a Game Review was run), which makes a wide cohort
 * affordable by download alone. 5,002 observations across 91 players.
 *
 * Accuracies here are CHESS.COM's formula, not this project's. The two agree
 * closely — r = 0.712 across 95 games where both exist, means 75.7 and 74.2 —
 * but they are not the same number, which is why this table calibrates an
 * estimate labelled as chess.com-style rather than feeding any internal
 * aggregate.
 *
 * Two honest limits:
 *
 * 1. **The relationship is not linear, and not even monotonic.** It was once
 *    fitted as a straight line, which understated the middle and overstated
 *    the top: fed each band's own mean accuracy it returned 1245 for band
 *    1400-1599 (-255), 1421 for 1600-1799 (-279) and 3273 for 2800+ (+373)
 *    — error larger than the +/-200 band quoted around it, so the true value
 *    fell OUTSIDE the range shown. `fitPerformanceCurve` now joins the band
 *    means instead, which is exact at every band.
 *
 *    Two pairs in this table INVERT: band 800-999 averages 69.1% against
 *    600-799's 69.2%, and 1400-1599 averages 73.6% against 1200-1399's
 *    74.6%. Accuracy genuinely does not separate those players. The fit
 *    pools each inverted pair rather than sloping through it, so both bands
 *    in a pair return their shared value — vaguer, but not wrong, and it
 *    keeps a more accurate game from ever scoring below a less accurate one.
 *
 * 2. **The top and bottom bands are thin.** 2200 rests on 17 observations and
 *    2600 on 22, against 2,443 at band 400. `referencePairs` still expands
 *    each band by its observation count, but the curve pools observations by
 *    accuracy before fitting, so a band measured on 2,443 games contributes
 *    one point like any other and no longer drags the fit through itself.
 *    The ends remain the least trustworthy part of the curve: they rest on
 *    the fewest games, and beyond them the curve holds its end value rather
 *    than extrapolating.
 *
 * Sampling bias worth naming: a game only carries an accuracy when someone ran
 * a Game Review on it, and players plausibly review their interesting games
 * more often than their routine ones. Whether that skews accuracy up or down
 * is not established here.
 */
export const RAPID_ACCURACY_BY_BAND: readonly {
  /** Lower edge of a 200-point band. */
  band: number;
  observations: number;
  meanAccuracy: number;
}[] = [
  { band: 200, observations: 162, meanAccuracy: 62.3 },
  { band: 400, observations: 2443, meanAccuracy: 66.0 },
  { band: 600, observations: 1276, meanAccuracy: 69.2 },
  { band: 800, observations: 118, meanAccuracy: 69.1 },
  { band: 1000, observations: 154, meanAccuracy: 72.5 },
  { band: 1200, observations: 135, meanAccuracy: 74.6 },
  { band: 1400, observations: 267, meanAccuracy: 73.6 },
  { band: 1600, observations: 121, meanAccuracy: 75.4 },
  { band: 1800, observations: 157, meanAccuracy: 77.8 },
  { band: 2000, observations: 76, meanAccuracy: 80.9 },
  { band: 2200, observations: 17, meanAccuracy: 86.5 },
  { band: 2600, observations: 22, meanAccuracy: 91.8 },
  { band: 2800, observations: 54, meanAccuracy: 94.3 },
];

/**
 * The table as fitting input, one pair per observation.
 *
 * Expanded by observation count so a band measured on 17 games does not carry
 * the same weight as one measured on 2,443. Each band is represented at its
 * CENTRE — a band labelled 1400 holds players from 1400 to 1599.
 */
export function referencePairs(): AccuracyRatingPair[] {
  return RAPID_ACCURACY_BY_BAND.flatMap(({ band, observations, meanAccuracy }) =>
    Array.from({ length: observations }, () => ({
      rating: band + 100,
      accuracy: meanAccuracy,
    })),
  );
}
