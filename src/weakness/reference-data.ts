import type { ReferenceRate } from "./reference";

/**
 * Peer miss rates for the ~600-rated rapid band.
 *
 * Measured from 270 analysed games across 9 chess.com players rated 596-682,
 * drawn from opponents the first user actually faced. 9,239 tactical
 * opportunities in total.
 *
 * Cohort size matters more than it looks. At 5 players `discoveredAttack` read
 * 6.4% off 172 opportunities; at 9 it reads 10.7% off 346, which moved one
 * player's headline weakness from first place to fourth. Rates drawn from a
 * few hundred sightings are not yet stable — widen the cohort before trusting
 * a narrow gap.
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
  { motif: "hangingPiece", opportunities: 2199, failures: 144, missRate: 0.065, players: 9 },
  { motif: "quietMove", opportunities: 1998, failures: 351, missRate: 0.176, players: 9 },
  { motif: "pin", opportunities: 1488, failures: 215, missRate: 0.144, players: 9 },
  { motif: "fork", opportunities: 831, failures: 142, missRate: 0.171, players: 9 },
  { motif: "skewer", opportunities: 815, failures: 127, missRate: 0.156, players: 9 },
  { motif: "trappedPiece", opportunities: 554, failures: 95, missRate: 0.171, players: 9 },
  { motif: "deflection", opportunities: 539, failures: 49, missRate: 0.091, players: 9 },
  { motif: "sacrifice", opportunities: 385, failures: 75, missRate: 0.195, players: 9 },
  { motif: "discoveredAttack", opportunities: 346, failures: 37, missRate: 0.107, players: 9 },
  { motif: "mateIn1", opportunities: 76, failures: 6, missRate: 0.079, players: 9 },
];
