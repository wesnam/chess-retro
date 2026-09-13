import { Chess } from "chess.js";
import type { Color, Square } from "chess.js";
import { pieceValue } from "@/analysis/motifs/board-utils";

/**
 * What actually went wrong on the board.
 *
 * "Cost 61.6 points of win probability" is not a reason — it is the mark
 * restated in different units. A reader still does not know what they did,
 * and cannot do anything differently next time. These checks look at the two
 * positions and name the concrete thing: a piece left hanging, a capture
 * passed over, a mate missed.
 *
 * Deliberately conservative. A wrong explanation is worse than none, because
 * it teaches something false about a position the reader is studying. Every
 * check here is verified against the board, and anything uncertain is left
 * unsaid — the win-probability figure remains as the honest fallback.
 */

export type Diagnosis = {
  /** What went wrong, in one sentence. */
  problem: string;
  /** What the better move would have done, when it can be named. */
  betterIdea?: string;
};

const PIECE_NAMES: Record<string, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

export function diagnoseMove(options: {
  fenBefore: string;
  uci: string;
  bestMoveUci: string | null;
  /**
   * The engine's expected continuation from the position this move REACHED —
   * that is, the refutation. Stored on the following ply.
   */
  refutation?: string | null;
}): Diagnosis | undefined {
  const { fenBefore, uci, bestMoveUci } = options;

  let before: Chess;
  try {
    before = new Chess(fenBefore);
  } catch {
    return undefined;
  }

  const after = new Chess(fenBefore);
  let played;
  try {
    played = after.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci.slice(4) : undefined,
    });
  } catch {
    return undefined;
  }
  if (!played) return undefined;

  const betterIdea = describeBestMove(before, bestMoveUci, uci);

  // Checked worst-first: being mated matters more than hanging a queen, and
  // hanging a queen matters more than passing up a capture.
  // Ordered by how certain the claim is, not by how bad it sounds. A mate is
  // proved by search; a capture the engine itself chose is proved by the
  // engine; a hanging piece is a static guess and goes last.
  const problem =
    mateAllowed(after) ??
    // Before the static checks: the engine's own continuation is evidence,
    // and it catches refutations that take more than one move — an attack
    // now, the loss next move. Those are invisible to anything looking at a
    // single position, and they are most of what actually goes wrong.
    refutedBy(after, options.refutation) ??
    captureMissed(before, bestMoveUci, uci) ??
    hangingAfter(after, played.color) ??
    undefined;

  if (!problem && !betterIdea) return undefined;
  return { problem: problem ?? "The engine saw something better.", betterIdea };
}

/** The opponent can now force mate immediately. */
function mateAllowed(after: Chess): string | undefined {
  for (const move of after.moves({ verbose: true })) {
    const probe = new Chess(after.fen());
    probe.move(move);
    if (probe.isCheckmate()) {
      return `It allows mate in one — ${move.san}.`;
    }
  }
  return undefined;
}

/**
 * The most valuable piece left undefended and attacked after the move.
 *
 * Reported only when the attacker is worth less than the target or the target
 * is undefended outright, so a fair trade is never described as a blunder.
 */
function hangingAfter(after: Chess, moverColor: "w" | "b"): string | undefined {
  const opponent: Color = moverColor === "w" ? "b" : "w";
  let worst: { square: string; type: string; net: number } | undefined;

  for (const rank of after.board()) {
    for (const square of rank) {
      if (!square || square.color !== moverColor || square.type === "k") continue;

      const attackers = after.attackers(square.square as Square, opponent);
      if (attackers.length === 0) continue;

      // What the opponent nets by taking, after the cheapest recapture.
      // Comparing attacker value to target value is not enough: a queen
      // taking a defended queen still wins a queen when the recapture only
      // regains one, which is exactly the position this was missing.
      const value = pieceValue(square.type);
      const cheapestAttacker = Math.min(
        ...attackers
          .map((sq) => after.get(sq))
          .filter((piece) => piece !== undefined)
          .map((piece) => pieceValue(piece.type)),
      );
      const defenders = after.attackers(square.square as Square, moverColor);
      // Undefended: the whole piece is lost. Defended: the exchange costs the
      // opponent their attacker, so only the difference is lost.
      const net = defenders.length === 0 ? value : value - cheapestAttacker;

      if (net < 3) continue;
      if (!worst || net > worst.net) {
        worst = { square: square.square, type: square.type, net };
      }
    }
  }

  if (!worst) return undefined;
  return `It leaves your ${PIECE_NAMES[worst.type] ?? worst.type} on ${worst.square} to be taken.`;
}

/** The engine's move was a capture the player passed over. */
function captureMissed(
  before: Chess,
  bestMoveUci: string | null,
  uci: string,
): string | undefined {
  if (!bestMoveUci || bestMoveUci === uci) return undefined;

  const target = before.get(bestMoveUci.slice(2, 4) as never);
  if (!target) return undefined;

  const value = pieceValue(target.type);
  if (value < 3) return undefined;

  return `There was a ${PIECE_NAMES[target.type] ?? target.type} on ${bestMoveUci.slice(2, 4)} you could have taken.`;
}

/** What the engine's move would have done, named concretely. */
function describeBestMove(
  before: Chess,
  bestMoveUci: string | null,
  uci: string,
): string | undefined {
  if (!bestMoveUci || bestMoveUci === uci) return undefined;

  const probe = new Chess(before.fen());
  let best;
  try {
    best = probe.move({
      from: bestMoveUci.slice(0, 2),
      to: bestMoveUci.slice(2, 4),
      promotion: bestMoveUci.length > 4 ? bestMoveUci.slice(4) : undefined,
    });
  } catch {
    return undefined;
  }
  if (!best) return undefined;

  if (probe.isCheckmate()) return `${best.san} was mate.`;

  if (best.captured) {
    const name = PIECE_NAMES[best.captured] ?? best.captured;
    return `${best.san} takes the ${name}.`;
  }

  if (probe.isCheck()) return `${best.san} gives check.`;

  return `${best.san} was better.`;
}

/**
 * What the opponent does about it, from the engine's own continuation.
 *
 * A single position cannot show a two-move refutation: after Qh6 nothing is
 * hanging and no mate is available, yet Bg5 attacks the queen and wins it next
 * move. The line names that, and it is the engine's line rather than a guess.
 *
 * Only the first two plies are used. Beyond that a continuation is the
 * engine's expectation rather than anything forced, and presenting it as
 * "what happens" would overstate it.
 */
function refutedBy(after: Chess, refutation: string | null | undefined): string | undefined {
  if (!refutation) return undefined;

  const plies = refutation.split(/\s+/).filter(Boolean);
  if (plies.length === 0) return undefined;

  const board = new Chess(after.fen());
  // The side to move here is the OPPONENT: this is the position our move
  // reached. Their reply is ply 0; ours is ply 1.
  const opponent = board.turn();

  let reply;
  try {
    reply = board.move({
      from: plies[0]!.slice(0, 2),
      to: plies[0]!.slice(2, 4),
      promotion: plies[0]!.length > 4 ? plies[0]!.slice(4) : undefined,
    });
  } catch {
    return undefined;
  }
  if (!reply) return undefined;

  if (board.isCheckmate()) {
    return `The opponent answers ${reply.san} — mate.`;
  }

  // What their reply attacks that we cannot adequately answer. Reported only
  // when the target is worth something and is either undefended or attacked
  // by something cheaper, so a fair trade is never called a refutation.
  const threatened = biggestThreat(board, opponent);
  if (threatened) {
    return `The opponent answers ${reply.san}, hitting your ${threatened.piece} on ${threatened.square}.`;
  }

  if (reply.captured) {
    const taken = PIECE_NAMES[reply.captured] ?? reply.captured;
    return `The opponent answers ${reply.san}, taking your ${taken}.`;
  }

  return undefined;
}

/**
 * The most valuable piece the side to move is attacking and we cannot hold.
 *
 * `attackerColor` is whoever just moved — the threat is theirs.
 */
function biggestThreat(
  board: Chess,
  attackerColor: Color,
): { piece: string; square: string } | undefined {
  const victimColor: Color = attackerColor === "w" ? "b" : "w";
  let worst: { piece: string; square: string; net: number } | undefined;

  for (const rank of board.board()) {
    for (const square of rank) {
      if (!square || square.color !== victimColor || square.type === "k") continue;

      const attackers = board.attackers(square.square as Square, attackerColor);
      if (attackers.length === 0) continue;

      const value = pieceValue(square.type);
      const defenders = board.attackers(square.square as Square, victimColor);
      const cheapestAttacker = Math.min(
        ...attackers
          .map((sq) => board.get(sq))
          .filter((piece) => piece !== undefined)
          .map((piece) => pieceValue(piece.type)),
      );
      const net = defenders.length === 0 ? value : value - cheapestAttacker;
      if (net < 3) continue;

      if (!worst || net > worst.net) {
        worst = {
          piece: PIECE_NAMES[square.type] ?? square.type,
          square: square.square,
          net,
        };
      }
    }
  }

  return worst;
}
