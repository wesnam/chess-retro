import { Chess, type Move, type Square } from "chess.js";
import {
  attackedBy,
  defendersOf,
  isHanging,
  opposite,
  pieceValue,
  slidingBetween,
  winsMaterial,
} from "./board-utils";

/**
 * Tactical motif detectors.
 *
 * Reimplemented from the heuristics described in lichess-puzzler's `cook.py`,
 * which is AGPL: the ideas are reused and none of its code is copied, which is
 * what keeps this project GPL rather than AGPL. Names match Lichess's theme
 * vocabulary exactly so ticket 10 can match puzzles by direct lookup with no
 * translation table.
 *
 * Every detector is deliberately conservative. A false tag becomes a false
 * weakness, which becomes false coaching and wasted practice — the wrong end
 * of the entire pipeline. When a heuristic is unsure, it says nothing.
 *
 * SCOPE: analysis stores the engine's best MOVE, not its full principal
 * variation, so every detector reasons about one move and the position it
 * leads to. That covers the motifs here, which are all properties of a single
 * move. Multi-move themes — `mateIn2`, and deflections that only pay off two
 * moves later — need the PV and are therefore absent rather than guessed at.
 * Storing the PV is the prerequisite if they are ever wanted.
 */

/** Lichess theme strings. */
export type Motif =
  | "fork"
  | "pin"
  | "skewer"
  | "discoveredAttack"
  | "doubleCheck"
  | "backRankMate"
  | "hangingPiece"
  | "deflection"
  | "trappedPiece"
  | "sacrifice"
  | "quietMove"
  | "mateIn1";

/** What a detector sees: the move, and the position either side of it. */
export type DetectorContext = {
  /** The position the move was played from. */
  before: Chess;
  /** The position after it. */
  after: Chess;
  /** The move itself, as chess.js reports it. */
  move: Move;
};

type Detector = {
  motif: Motif;
  detect: (context: DetectorContext) => boolean;
};

/**
 * All motifs a move exhibits.
 *
 * Returns nothing rather than throwing for a position it cannot read or a move
 * that is not legal there: a single bad row must not stop a corpus-wide
 * tagging pass.
 */
export function detectMotifs(fen: string, uci: string): Motif[] {
  const context = buildContext(fen, uci);
  if (!context) return [];

  return DETECTORS.filter((detector) => {
    try {
      return detector.detect(context);
    } catch {
      // A detector that throws on an odd position says nothing about it,
      // rather than taking the other eleven down with it.
      return false;
    }
  }).map((detector) => detector.motif);
}

function buildContext(fen: string, uci: string): DetectorContext | undefined {
  if (uci.length < 4) return undefined;

  try {
    const before = new Chess(fen);
    const after = new Chess(fen);
    const move = after.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.slice(4) || undefined,
    });
    return move ? { before, after, move } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Enemy pieces the moved piece now attacks that are worth winning.
 *
 * "Worth winning" means undefended, or defended but worth more than the
 * attacker — the same test that separates a real fork from an attack on two
 * defended pawns.
 */
function winnableTargets(context: DetectorContext): Square[] {
  const { after, move } = context;
  const landed = move.to as Square;

  return attackedBy(after, landed).filter((square) => {
    const target = after.get(square);
    if (!target || target.color === move.color) return false;

    // The king is always a valuable "target": attacking it is check, which
    // the opponent must answer, so the other target can be taken next.
    if (target.type === "k") return true;

    const defenders = defendersOf(after, square);
    if (defenders.length === 0) return pieceValue(target.type) > 0;

    return pieceValue(target.type) > pieceValue(move.piece);
  });
}

const DETECTORS: Detector[] = [
  {
    motif: "fork",
    detect: (context) => {
      // One piece attacking two things worth winning at once. The king counts,
      // which is what makes a knight check on two pieces the classic case.
      return winnableTargets(context).length >= 2;
    },
  },

  {
    motif: "hangingPiece",
    detect: ({ before, move }) => {
      // A capture that wins material because the target was not adequately
      // defended. An even trade is not a hanging piece.
      if (!move.captured) return false;
      // `move.captured` is passed through for en passant, where the captured
      // pawn is not standing on the destination square.
      return winsMaterial(
        before,
        move.from as Square,
        move.to as Square,
        move.captured,
      );
    },
  },

  {
    motif: "pin",
    detect: (context) => pinOrSkewer(context) === "pin",
  },

  {
    motif: "skewer",
    detect: (context) => pinOrSkewer(context) === "skewer",
  },

  {
    motif: "doubleCheck",
    detect: ({ after, move }) => {
      if (!after.isCheck()) return false;

      // Two different pieces giving check at once can only arise from a
      // discovery: the mover cannot be in two places.
      const enemyKing = findKing(after, opposite(move.color));
      if (!enemyKing) return false;

      return after.attackers(enemyKing, move.color).length >= 2;
    },
  },

  {
    motif: "discoveredAttack",
    detect: ({ before, after, move }) => {
      const enemy = opposite(move.color);

      // A piece that attacks something now, along a line the moved piece was
      // standing in, and did not attack it before.
      for (const from of ownPieces(after, move.color)) {
        if (from === move.to) continue;

        const vacated = move.from as Square;
        // Only lines that ran through the square just vacated.
        const between = slidingBetween(from, vacated);
        if (between.length === 0 && from !== vacated) {
          // Adjacent along a line still counts; unrelated squares do not.
          if (slidingBetween(vacated, from).length === 0 && !aligned(from, vacated)) {
            continue;
          }
        }

        const attacker = after.get(from);
        if (!attacker) continue;

        const beforeAttacked = new Set(attackedBy(before, from));

        for (const square of attackedBy(after, from)) {
          if (beforeAttacked.has(square)) continue;

          const target = after.get(square);
          if (!target || target.color !== enemy) continue;

          // The uncovered attack has to be worth something. Almost every pawn
          // move uncovers *some* line onto *some* defended pawn; tagging those
          // would bury the real discoveries — this fired on 87 of 976 corpus
          // moves before the value test, which no real game contains.
          if (target.type === "k") return true;
          if (defendersOf(after, square).length === 0) {
            if (pieceValue(target.type) > 1) return true;
            continue;
          }
          if (pieceValue(target.type) > pieceValue(attacker.type)) return true;
        }
      }

      return false;
    },
  },

  {
    motif: "backRankMate",
    detect: ({ after, move }) => {
      if (!after.isCheckmate()) return false;

      const enemy = opposite(move.color);
      const king = findKing(after, enemy);
      if (!king) return false;

      // The king is on its own back rank.
      const backRank = enemy === "w" ? "1" : "8";
      if (king[1] !== backRank) return false;

      // And it is boxed in by its own pieces rather than simply surrounded by
      // the attacker's: that is what makes it a back-rank mate specifically.
      const escapeRank = enemy === "w" ? "2" : "7";
      const file = king[0]!;
      const ahead = [-1, 0, 1]
        .map((offset) => shiftFile(file, offset))
        .filter((f): f is string => f !== undefined)
        .map((f) => `${f}${escapeRank}` as Square);

      // EVERY forward escape must be blocked by the king's own pieces. With
      // `some`, Scholar's mate qualified because one pawn still stood on d7 —
      // a mate delivered to the king's face, not along the back rank.
      return ahead.every((square) => after.get(square)?.color === enemy);
    },
  },

  {
    motif: "mateIn1",
    detect: ({ after }) => after.isCheckmate(),
  },

  {
    motif: "sacrifice",
    detect: ({ before, after, move }) => {
      // Stepping onto a square where the piece can be taken for less than it
      // is worth, without capturing anything of comparable value.
      const gained = move.captured ? pieceValue(move.captured) : 0;
      const risked = pieceValue(move.piece);
      if (gained >= risked) return false;

      // Checkmate is not a sacrifice; the game is over.
      if (after.isCheckmate()) return false;

      return isHanging(after, move.to as Square) && risked > gained + 1;
    },
  },

  {
    motif: "trappedPiece",
    detect: ({ before, after, move }) => {
      // A piece worth more than a pawn, attacked, with nowhere safe to go —
      // and trapped BY THIS MOVE. Without that last condition the tag fires on
      // every move while some piece happens to be stuck elsewhere on the
      // board, which is most of the game.
      const enemy = opposite(move.color);

      for (const square of ownPieces(after, enemy)) {
        const piece = after.get(square);
        if (!piece || piece.type === "p" || piece.type === "k") continue;

        // Only worth calling trapped if losing it costs real material.
        if (pieceValue(piece.type) < 3) continue;
        if (after.attackers(square, move.color).length === 0) continue;
        if (!isTrapped(after, square, move.color, enemy)) continue;

        // It must not already have been trapped before the move, or this is
        // simply an ongoing state rather than something this move achieved.
        const wasThere = before.get(square);
        if (
          wasThere &&
          before.attackers(square, move.color).length > 0 &&
          isTrapped(before, square, move.color, enemy)
        ) {
          continue;
        }

        return true;
      }

      return false;
    },
  },

  {
    motif: "deflection",
    detect: ({ before, after, move }) => {
      // Attacking a piece that is currently defending something else, so it
      // cannot stay where it is and keep defending.
      if (!move.captured) return false;

      const enemy = opposite(move.color);
      const captured = move.to as Square;

      // Did the captured piece defend anything that is now loose?
      for (const square of ownPieces(after, enemy)) {
        const wasDefended = defendersOf(before, square).includes(captured);
        if (wasDefended && isHanging(after, square)) return true;
      }

      return false;
    },
  },

  {
    motif: "quietMove",
    detect: (context) => {
      const { after, move } = context;
      // No capture, no check — but it creates a real threat. The hard-to-spot
      // kind of strong move.
      if (move.captured || after.isCheck()) return false;

      // The threat must be worth more than a pawn, or every developing move
      // that eyes a defended pawn qualifies.
      return winnableTargets(context).some((square) => {
        const target = after.get(square);
        return target !== undefined && pieceValue(target.type) > 1;
      });
    },
  },
];

/**
 * Whether the move creates a pin or a skewer, or neither.
 *
 * Both are the same geometry — an attacker, a piece, and a piece behind it on
 * the same line. Which one it is depends on their relative value: a cheaper
 * piece in front is pinned, a dearer one in front is skewered.
 */
function pinOrSkewer(context: DetectorContext): "pin" | "skewer" | undefined {
  const { after, move } = context;
  const landed = move.to as Square;
  const piece = after.get(landed);

  // Only line pieces can pin or skewer; a knight can do neither.
  if (!piece || !["b", "r", "q"].includes(piece.type)) return undefined;

  const enemy = opposite(move.color);

  for (const front of attackedBy(after, landed)) {
    const frontPiece = after.get(front);
    if (!frontPiece || frontPiece.color !== enemy) continue;

    // Keep going along the same line past the front piece.
    const behind = nextAlong(after, landed, front, enemy);
    if (!behind) continue;

    const frontValue = pieceValue(frontPiece.type);
    const backValue = pieceValue(behind.type);

    if (backValue > frontValue) return "pin";
    if (frontValue > backValue) return "skewer";
  }

  return undefined;
}

/**
 * The first enemy piece beyond `through`, continuing away from `from`.
 *
 * This is what makes a pin a pin: something of value standing behind the
 * piece being attacked, on the same line.
 */
function nextAlong(
  chess: Chess,
  from: Square,
  through: Square,
  color: "w" | "b",
) {
  const fileStep = Math.sign(fileIndex(through) - fileIndex(from));
  const rankStep = Math.sign(rankIndex(through) - rankIndex(from));
  if (fileStep === 0 && rankStep === 0) return undefined;

  let file = fileIndex(through) + fileStep;
  let rank = rankIndex(through) + rankStep;

  while (file >= 0 && file < 8 && rank >= 1 && rank <= 8) {
    const square = `${"abcdefgh"[file]}${rank}` as Square;
    const piece = chess.get(square);
    if (piece) return piece.color === color ? piece : undefined;
    file += fileStep;
    rank += rankStep;
  }

  return undefined;
}

/**
 * Has the piece on `square` no square to run to that the enemy does not cover?
 *
 * Escape squares are taken from the piece's own geometry on a board with the
 * check removed. `attackedBy` reads chess.js's legal moves, and under check
 * those are only the king's evasions — so every other piece would report zero
 * escapes and any check that also attacked something read as a trapped piece.
 */
function isTrapped(
  chess: Chess,
  square: Square,
  attacker: "w" | "b",
  owner: "w" | "b",
): boolean {
  const board = withoutCheck(chess, square, owner);
  if (!board) return false;

  const escapes = attackedBy(board, square).filter((to) => {
    const occupant = board.get(to);
    if (occupant && occupant.color === owner) return false;
    // Capturing its way out counts as an escape when the capture is winning.
    if (occupant && winsMaterial(board, square, to)) return true;
    return board.attackers(to, attacker).length === 0;
  });

  return escapes.length === 0;
}

/**
 * The position with the owner's king removed, so a piece's mobility can be
 * read without check evasion masking it.
 *
 * Returns undefined when the result cannot be loaded, in which case the
 * detector says nothing rather than guessing.
 */
function withoutCheck(
  chess: Chess,
  keep: Square,
  owner: "w" | "b",
): Chess | undefined {
  if (!chess.isCheck()) return chess;

  const board = new Chess(chess.fen());
  const king = findKing(board, owner);
  // Never strip the piece being asked about.
  if (!king || king === keep) return undefined;

  board.remove(king);
  try {
    // Reload so chess.js recomputes from the edited board.
    return new Chess(board.fen());
  } catch {
    return undefined;
  }
}

function ownPieces(chess: Chess, color: "w" | "b"): Square[] {
  const squares: Square[] = [];
  for (const row of chess.board()) {
    for (const cell of row) {
      if (cell && cell.color === color) squares.push(cell.square);
    }
  }
  return squares;
}

function findKing(chess: Chess, color: "w" | "b"): Square | undefined {
  for (const square of ownPieces(chess, color)) {
    if (chess.get(square)?.type === "k") return square;
  }
  return undefined;
}

function aligned(a: Square, b: Square): boolean {
  const fileDistance = Math.abs(fileIndex(a) - fileIndex(b));
  const rankDistance = Math.abs(rankIndex(a) - rankIndex(b));
  return (
    fileDistance === 0 || rankDistance === 0 || fileDistance === rankDistance
  );
}

function fileIndex(square: Square): number {
  return "abcdefgh".indexOf(square[0]!);
}

function rankIndex(square: Square): number {
  return Number(square[1]);
}

function shiftFile(file: string, offset: number): string | undefined {
  const index = "abcdefgh".indexOf(file) + offset;
  return index >= 0 && index < 8 ? "abcdefgh"[index] : undefined;
}
