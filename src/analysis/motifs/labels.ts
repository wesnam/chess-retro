/**
 * Lichess theme strings rendered as something a person can read.
 *
 * The stored identifiers stay exactly as Lichess writes them so ticket 10 can
 * match puzzles by direct lookup; only the display text lives here.
 */
const LABELS: Record<string, string> = {
  fork: "fork",
  pin: "pin",
  skewer: "skewer",
  discoveredAttack: "discovered attack",
  doubleCheck: "double check",
  backRankMate: "back-rank mate",
  hangingPiece: "hanging piece",
  deflection: "deflection",
  trappedPiece: "trapped piece",
  sacrifice: "sacrifice",
  quietMove: "quiet move",
  mateIn1: "mate in one",
};

export function motifLabel(motif: string): string {
  return LABELS[motif] ?? motif;
}

/** "you missed a fork" / "you missed a fork and a pin" */
export function missedSummary(motifs: string[]): string {
  const labels = motifs.map(motifLabel);
  if (labels.length === 0) return "";
  if (labels.length === 1) return `missed a ${labels[0]}`;

  const last = labels.at(-1)!;
  return `missed a ${labels.slice(0, -1).join(", a ")} and a ${last}`;
}
