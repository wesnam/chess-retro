/**
 * Lichess theme strings rendered as something a person can read.
 *
 * The stored identifiers stay exactly as Lichess writes them so puzzle practice
 * matches by direct lookup; only the display text lives here.
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

/**
 * What each tactic is, for someone who does not already know.
 *
 * A dashboard headed "deflection" with four statistics under it assumes the
 * reader can already name their own weakness — which is exactly the thing they
 * came here to find out. `title` is the claim; `what` explains the idea.
 */
type MotifCopy = { title: string; what: string };

const COPY: Record<string, MotifCopy> = {
  fork: {
    title: "You miss forks",
    what: "One piece attacking two targets at once. Knights are the usual culprit, but queens, pawns and even kings do it.",
  },
  pin: {
    title: "You miss pins",
    what: "A piece that cannot move without exposing something more valuable behind it.",
  },
  skewer: {
    title: "You miss skewers",
    what: "A pin in reverse — the valuable piece is in front, and moving it loses what stands behind.",
  },
  discoveredAttack: {
    title: "You miss discovered attacks",
    what: "Moving one piece unleashes an attack from another behind it. Easy to overlook because the moving piece is not the one doing the damage.",
  },
  doubleCheck: {
    title: "You miss double checks",
    what: "Two pieces giving check at once. The king must move — nothing can block or capture its way out.",
  },
  backRankMate: {
    title: "You miss back-rank mates",
    what: "A king trapped on its own back rank by its own pawns, mated by a rook or queen arriving along it.",
  },
  hangingPiece: {
    title: "You miss hanging pieces",
    what: "A piece left undefended and free to take. The most common tactic there is, and the easiest to walk past.",
  },
  deflection: {
    title: "You miss deflections",
    what: "Forcing a defender away from the square or piece it was guarding, so something else falls.",
  },
  trappedPiece: {
    title: "You miss trapped pieces",
    what: "A piece with no safe square to run to. Often a bishop or knight that wandered too deep.",
  },
  sacrifice: {
    title: "You miss sacrifices",
    what: "Giving up material for something worth more — an attack, a mate, or a bigger piece two moves later.",
  },
  quietMove: {
    title: "You miss quiet moves",
    what: "A move that threatens nothing immediately but leaves the opponent without a good answer. Easy to skip when looking only at checks and captures.",
  },
  mateIn1: {
    title: "You miss mate in one",
    what: "A forced checkmate available immediately.",
  },
};

/** The headline claim for a weakness card, e.g. "You miss forks". */
export function motifTitle(motif: string): string {
  return COPY[motif]?.title ?? `You miss ${motifLabel(motif)}s`;
}

/** One sentence explaining what the tactic is. */
export function motifExplanation(motif: string): string | undefined {
  return COPY[motif]?.what;
}
