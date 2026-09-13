import type { Db } from "@/db/client";
import {
  allCandidates,
  corpusBaseline,
  countAnalysedMoves,
  examplesFor,
  type WeaknessExample,
} from "./queries";
import { RAPID_600_REFERENCE } from "./reference-data";
import { referenceTable } from "./reference";
import { referenceFit, type ReferenceFit } from "./band";
import { typicalRating } from "./rating";
import {
  MIN_GAMES,
  MIN_OPPORTUNITIES,
  rankWeaknesses,
  type ScoredWeakness,
} from "./score";

/**
 * The dashboard's answer: what this player keeps getting wrong, ranked, with
 * the evidence behind each claim.
 */

export type RankedWeakness = ScoredWeakness & {
  examples: WeaknessExample[];
};

export type WeaknessReport = {
  timeClass: string;
  /** Cost per move across the corpus, the standard each weakness is judged against. */
  baseline: number;
  weaknesses: RankedWeakness[];
  /**
   * Candidates that were measured but had too little evidence to rank. Shown
   * so the dashboard can say WHY it is empty rather than implying the player
   * has no weaknesses.
   */
  suppressed: number;
  analysedMoves: number;
  /**
   * Whether the baked-in peer cohort describes this player at all.
   *
   * Carried on the report rather than worked out by the page, because the
   * ranking it qualifies is computed here: a player outside the band is being
   * measured against the wrong population, and the number that comes back is
   * confident and wrong rather than merely imprecise.
   */
  fit: ReferenceFit;
  /** The rating the fit was judged on, so the caller can show its working. */
  rating: number | undefined;
};

export function weaknessReport(
  db: Db,
  scope: { user: string; timeClass: string },
  options: { limit?: number; examplesPer?: number } = {},
): WeaknessReport {
  const { limit = 3, examplesPer = 3 } = options;

  const candidates = allCandidates(db, scope);
  const baseline = corpusBaseline(db, scope);

  // Judged before ranking, and reported alongside it. The rates are still
  // applied when they do not fit — dropping to lift would silently change
  // what the ranking means — so the caveat travels with the answer instead.
  const rating = typicalRating(db, scope);
  const fit = referenceFit({ rating, timeClass: scope.timeClass });

  // Ranked against players of similar strength where a peer rate exists.
  // Lift — cost against the player's OWN average — cannot answer "what am I
  // bad at", because it divides out their skill level: a 3352 and a 590 both
  // come out near 1.5x. Dimensions with no peer rate fall back to lift.
  const ranked = rankWeaknesses(candidates, {
    baselineSeverity: baseline,
    referenceMissRates: referenceTable(RAPID_600_REFERENCE),
  });

  // Both gates, not just the opportunity one: a pattern confined to one game
  // is suppressed too, and the empty state would otherwise under-report why
  // it has nothing to show.
  const suppressed = candidates.filter(
    (c) =>
      c.opportunities > 0 &&
      (c.opportunities < MIN_OPPORTUNITIES || c.games < MIN_GAMES),
  ).length;

  // Counted directly rather than summed out of the piece dimension. That
  // happened to give the same number — `moves.piece` is NOT NULL and the
  // piece query adds no extra filter — but it made a headline figure depend
  // on an unrelated query keeping no filters of its own.
  const analysedMoves = countAnalysedMoves(db, scope);

  return {
    timeClass: scope.timeClass,
    baseline,
    suppressed,
    analysedMoves,
    fit,
    rating,
    weaknesses: ranked.slice(0, limit).map((weakness) => ({
      ...weakness,
      examples: examplesFor(db, scope, weakness, examplesPer),
    })),
  };
}
