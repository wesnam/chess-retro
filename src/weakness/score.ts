/**
 * Ranking weaknesses against each other.
 *
 * Sorting by how often something went wrong surfaces whatever is most common,
 * which is not the same as what costs the most games. Four corrections turn a
 * count into a ranking worth acting on:
 *
 * 1. **Exposure.** Every candidate is paired with how often the opportunity
 *    arose at all. Without that denominator a failure count says nothing.
 * 2. **Personal baseline.** Severity is measured against the player's own
 *    average, so a weakness is what they do worse than they usually do rather
 *    than what they do worse than a grandmaster.
 * 3. **Shrinkage.** Small samples are pulled toward the mean, so two failures
 *    out of three chances cannot outrank forty out of two hundred.
 * 4. **Damping.** Total cost enters logarithmically, so one catastrophic game
 *    cannot dominate a pattern seen across dozens.
 */

/** Which axis a candidate came from. All five compete in one pool. */
export type WeaknessDimension =
  | "motif"
  | "phase"
  | "time"
  | "opening"
  | "piece";

export type WeaknessCandidate = {
  dimension: WeaknessDimension;
  /** Stable identifier — a Lichess motif string, a phase name, an ECO family. */
  key: string;
  /** Human-facing name for the dashboard. */
  label: string;
  /** How often the opportunity arose at all. The denominator. */
  opportunities: number;
  /** How often it went wrong. */
  failures: number;
  /** Total win probability thrown away across those failures. */
  winPctLost: number;
  /**
   * Total win probability thrown away across EVERY opportunity, not only the
   * failures.
   *
   * The two must be measured over the same population or dimensions are not
   * comparable. A phase slice accrues cost on every move it contains; a motif
   * slice accrued cost only on the plies tagged `missed`, while counting every
   * ply the tactic appeared on as an opportunity. Dividing a partial cost by a
   * full exposure made every motif look mild — `hangingPiece` read 1.78
   * against a 5.62 baseline not because the player handles hanging pieces well
   * but because 397 of its 437 sightings cost nothing and still sat in the
   * denominator. No motif could ever out-rank a phase.
   */
  winPctLostAcrossAll: number;
  /**
   * How many distinct games this candidate was seen in.
   *
   * Opportunities alone cannot separate a pattern from an event: one game
   * supplies dozens of moves, so a single disastrous game clears any
   * move-count threshold on its own. On the real corpus every opening family
   * came from exactly one game and ranked above motifs seen across all six.
   */
  games: number;
};

export type ScoredWeakness = WeaknessCandidate & {
  /** Win probability bled per opportunity, as observed. */
  severity: number;
  /**
   * Shrunken severity relative to the player's own baseline. 1 means typical.
   * Shrunken, not raw: thin evidence is pulled toward the baseline so it
   * cannot report an extreme multiple off a handful of observations.
   */
  lift: number;
  /** How much the sample size is trusted, 0-1. */
  confidence: number;
  failureRate: number;
  score: number;
};

/**
 * Opportunities a candidate needs before it can be ranked at all.
 *
 * Below this the failure rate is noise, and presenting it as a finding is
 * worse than showing nothing: it sends the player off to drill something that
 * happened a handful of times by chance.
 */
export const MIN_OPPORTUNITIES = 8;

/**
 * Distinct games a candidate must appear in before it can be ranked.
 *
 * The companion to `MIN_OPPORTUNITIES`, and the real protection against one
 * catastrophic game: a weakness confined to a single game is an event, not a
 * pattern, however many moves that game contributed. Without this the opening
 * dimension ranks first on every corpus, since one game supplies an entire
 * opening's worth of moves by itself.
 */
export const MIN_GAMES = 3;

/**
 * Sample size at which a candidate is trusted half as much as an infinite one.
 * Larger values are more conservative about small samples.
 */
export const SHRINKAGE_PRIOR = 25;

export function scoreCandidate(
  candidate: WeaknessCandidate,
  options: { baselineSeverity: number },
): ScoredWeakness {
  const { opportunities, failures, winPctLost } = candidate;

  // Nothing to divide by, and nothing to conclude.
  if (opportunities <= 0) {
    return {
      ...candidate,
      severity: 0,
      lift: 0,
      confidence: 0,
      failureRate: 0,
      score: 0,
    };
  }

  // Cost across the whole slice over opportunities across the whole slice —
  // the same population on both sides, so a motif and a phase mean the same
  // thing by this measure. `winPctLost` remains what the card shows, because
  // "this cost you N points" is about the failures.
  const severity = candidate.winPctLostAcrossAll / opportunities;
  const failureRate = failures / opportunities;

  const { baselineSeverity } = options;
  const confidence = opportunities / (opportunities + SHRINKAGE_PRIOR);

  /**
   * Shrink the OBSERVED severity toward the baseline before taking lift,
   * rather than scaling the finished score by confidence.
   *
   * Applying confidence as a separate multiplier does not work: lift is
   * unbounded and linear, so ten observations averaging a 35-point blunder
   * reach lift ~20 against a corpus baseline near 2, while confidence can only
   * ever divide by about 3.5. Severity wins every time and one catastrophic
   * game dominates the ranking — exactly what the design forbids.
   *
   * Pulling severity toward the baseline in proportion to the evidence behind
   * it is the standard empirical-Bayes correction, and it makes thin evidence
   * incapable of producing an extreme lift at all.
   */
  const adjustedSeverity =
    confidence * severity + (1 - confidence) * baselineSeverity;

  // A baseline of zero means this player never loses anything anywhere, so
  // there is no "worse than usual" to measure against.
  const lift = baselineSeverity > 0 ? adjustedSeverity / baselineSeverity : 0;

  // Doing something better than your own standard is not a weakness. Clamped
  // at zero rather than left negative: a negative excess multiplied through
  // the rest would otherwise re-emerge as a positive score.
  const excess = Math.max(0, lift - 1);

  /**
   * Both factors enter logarithmically.
   *
   * Damping the total alone is not enough. Lift is a ratio against a small
   * baseline — the real corpus sits near 3 win-probability points per move —
   * so a couple of blunders on one theme reach a lift of 10 or more while a
   * genuine repeated leak sits near 2. Left linear, lift alone decides the
   * ranking and the thinnest evidence wins, because the highest severities
   * come from the fewest observations.
   *
   * Damped, a 10x lift counts a little over three times a 2x lift rather than
   * five times, which is enough for evidence to matter.
   */
  const score = Math.log1p(excess) * Math.log1p(winPctLost);

  return { ...candidate, severity, lift, confidence, failureRate, score };
}

/**
 * Rank every candidate against every other, worst first.
 *
 * `baselineSeverity` is how much win probability this player throws away per
 * move across their whole corpus — their own standard, which lift is measured
 * against. It is supplied rather than pooled from the candidates on purpose:
 * averaging the candidates would make the comparison self-referential, putting
 * roughly half of any set below "average" by construction and scoring a lone
 * candidate at exactly zero no matter how badly it went.
 *
 * Omitting it falls back to the pooled mean, which is the best available
 * answer when no corpus-wide figure has been computed — but callers with a
 * real corpus should pass one.
 */
export function rankWeaknesses(
  candidates: WeaknessCandidate[],
  options: { baselineSeverity?: number } = {},
): ScoredWeakness[] {
  const eligible = candidates.filter(
    (c) => c.opportunities >= MIN_OPPORTUNITIES && c.games >= MIN_GAMES,
  );
  if (eligible.length === 0) return [];

  const baselineSeverity =
    options.baselineSeverity ?? pooledSeverity(eligible);

  return eligible
    .map((c) => scoreCandidate(c, { baselineSeverity }))
    // A candidate at or below the player's own standard is not a weakness;
    // listing it would fill the dashboard with things they do fine.
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
}

function pooledSeverity(candidates: WeaknessCandidate[]): number {
  const opportunities = candidates.reduce((sum, c) => sum + c.opportunities, 0);
  if (opportunities <= 0) return 0;
  return candidates.reduce((sum, c) => sum + c.winPctLost, 0) / opportunities;
}
