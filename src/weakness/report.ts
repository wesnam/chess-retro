import type { Db } from "@/db/client";
import { allCandidates, corpusBaseline, examplesFor, type WeaknessExample } from "./queries";
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
};

export function weaknessReport(
  db: Db,
  scope: { user: string; timeClass: string },
  options: { limit?: number; examplesPer?: number } = {},
): WeaknessReport {
  const { limit = 3, examplesPer = 3 } = options;

  const candidates = allCandidates(db, scope);
  const baseline = corpusBaseline(db, scope);

  const ranked = rankWeaknesses(candidates, { baselineSeverity: baseline });

  // Both gates, not just the opportunity one: a pattern confined to one game
  // is suppressed too, and the empty state would otherwise under-report why
  // it has nothing to show.
  const suppressed = candidates.filter(
    (c) =>
      c.opportunities > 0 &&
      (c.opportunities < MIN_OPPORTUNITIES || c.games < MIN_GAMES),
  ).length;

  const analysedMoves = candidates
    .filter((c) => c.dimension === "piece")
    .reduce((sum, c) => sum + c.opportunities, 0);

  return {
    timeClass: scope.timeClass,
    baseline,
    suppressed,
    analysedMoves,
    weaknesses: ranked.slice(0, limit).map((weakness) => ({
      ...weakness,
      examples: examplesFor(db, scope, weakness, examplesPer),
    })),
  };
}
