import type { ReferenceRate } from "./reference";

/**
 * Peer miss rates for the ~600-rated rapid band.
 *
 * Measured from 127 analysed games across 5 chess.com players rated 596-682,
 * drawn from opponents the first user actually faced. 4,553 tactical
 * opportunities in total.
 *
 * Baked in rather than computed on demand so a fresh install ranks against
 * peers immediately, without first analysing a cohort of strangers' games —
 * which costs hours of engine time. `referenceRates()` recomputes this from
 * stored games when a better cohort is available.
 *
 * These rates come from this project's own detectors, so any detector bias
 * cancels on both sides of the comparison. That makes them meaningful only
 * within this tool: they are not comparable to Lichess's or chess.com's
 * published figures.
 *
 * Band: rapid, 596-682. A player far outside that range is being compared
 * against the wrong population — see `referenceRates` for rebuilding.
 */
export const RAPID_600_REFERENCE: ReferenceRate[] = [
  { motif: "hangingPiece", opportunities: 1070, failures: 62, missRate: 0.058, players: 5 },
  { motif: "quietMove", opportunities: 1020, failures: 157, missRate: 0.154, players: 5 },
  { motif: "pin", opportunities: 765, failures: 115, missRate: 0.150, players: 5 },
  { motif: "fork", opportunities: 413, failures: 69, missRate: 0.167, players: 5 },
  { motif: "skewer", opportunities: 386, failures: 63, missRate: 0.163, players: 5 },
  { motif: "trappedPiece", opportunities: 262, failures: 55, missRate: 0.210, players: 5 },
  { motif: "deflection", opportunities: 255, failures: 28, missRate: 0.110, players: 5 },
  { motif: "sacrifice", opportunities: 210, failures: 35, missRate: 0.167, players: 5 },
  { motif: "discoveredAttack", opportunities: 172, failures: 11, missRate: 0.064, players: 5 },
];
