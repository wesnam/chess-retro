import { Chess, type Color, type PieceSymbol, type Square } from "chess.js";

/**
 * Board primitives shared by every detector.
 *
 * These decide what counts as "hanging" and what counts as "wins material", so
 * a mistake here becomes a wrong motif on every position in the corpus. They
 * are deliberately conservative: a false tag produces a false weakness, which
 * produces false coaching and wasted practice.
 */

const VALUES: Record<PieceSymbol, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  // Higher than any capture, so "wins material" can never prefer taking a
  // king; the rules make that unreachable anyway.
  k: 100,
};

export function pieceValue(piece: PieceSymbol): number {
  return VALUES[piece];
}

export function opposite(color: Color): Color {
  return color === "w" ? "b" : "w";
}

/** Squares holding a piece of `color` that attacks `square`. */
export function attackersOf(
  chess: Chess,
  square: Square,
  color: Color,
): Square[] {
  return chess.attackers(square, color);
}

/**
 * Squares holding a piece defending whatever stands on `square`.
 *
 * A defender is an attacker of the same colour as the occupant. Note that
 * pawns defend in their own direction of capture: a black pawn on d6 defends
 * e5, while one on d5 does not.
 */
export function defendersOf(chess: Chess, square: Square): Square[] {
  const piece = chess.get(square);
  if (!piece) return [];
  return chess.attackers(square, piece.color);
}

/**
 * What the piece on `square` attacks.
 *
 * Derived from the piece's own moves rather than by scanning the board, so
 * pins and blockers are respected. Pawn pushes are excluded: a pawn attacks
 * diagonally and a push threatens nothing.
 */
export function attackedBy(chess: Chess, square: Square): Square[] {
  const piece = chess.get(square);
  if (!piece) return [];

  // Ask from the piece's own perspective: a piece cannot "move" when it is
  // not its side's turn, so the position is reloaded with the turn flipped.
  const board = withTurn(chess, piece.color);
  if (!board) return [];

  const targets = new Set<Square>();
  for (const move of board.moves({ square, verbose: true })) {
    // A pawn's forward move is not an attack.
    if (piece.type === "p" && move.from[0] === move.to[0]) continue;
    targets.add(move.to as Square);
  }

  // A piece also "attacks" squares occupied by its own side in the sense that
  // matters for defence, which `moves()` will not report. Those are covered by
  // `defendersOf`, which asks the question from the other direction.
  return [...targets];
}

/**
 * The cheapest piece of `color` attacking `square`, by value.
 *
 * Exchanges are decided by the least valuable attacker, so this is the number
 * that matters rather than the count of attackers.
 */
function cheapestAttacker(
  chess: Chess,
  square: Square,
  color: Color,
): number | undefined {
  const values = chess
    .attackers(square, color)
    .map((from) => chess.get(from))
    .filter((piece) => piece !== undefined)
    .map((piece) => pieceValue(piece.type));

  return values.length === 0 ? undefined : Math.min(...values);
}

/**
 * Is the piece on `square` winnable?
 *
 * A deliberately simple exchange test rather than a full static exchange
 * evaluation: a piece is hanging if it is attacked and either undefended, or
 * defended but capturable by something cheap enough that the recapture still
 * leaves the attacker ahead. Full SEE would handle long exchange sequences,
 * which are rare enough at this level not to justify the extra ways to be
 * subtly wrong.
 */
export function isHanging(chess: Chess, square: Square): boolean {
  const piece = chess.get(square);
  if (!piece) return false;

  const enemy = opposite(piece.color);
  const attacker = cheapestAttacker(chess, square, enemy);
  if (attacker === undefined) return false;

  const defenders = defendersOf(chess, square);
  if (defenders.length === 0) return true;

  // Defended: taking it costs the attacker, so it is only hanging if the trade
  // still comes out ahead.
  return pieceValue(piece.type) > attacker;
}

/**
 * Is the piece on `square` defended only by something more valuable than its
 * cheapest attacker — so that capturing still wins material?
 */
export function isSoftlyDefended(chess: Chess, square: Square): boolean {
  const piece = chess.get(square);
  if (!piece) return false;

  const enemy = opposite(piece.color);
  const attacker = cheapestAttacker(chess, square, enemy);
  if (attacker === undefined) return false;

  const defenders = defendersOf(chess, square);
  if (defenders.length === 0) return false;

  return pieceValue(piece.type) > attacker;
}

/**
 * Would moving from `from` to `to` win material?
 *
 * The captured piece must be worth more than whatever the capturer stands to
 * lose to the recapture.
 */
export function winsMaterial(chess: Chess, from: Square, to: Square): boolean {
  const target = chess.get(to);
  const mover = chess.get(from);
  if (!target || !mover) return false;

  const gained = pieceValue(target.type);
  const defenders = defendersOf(chess, to);

  // Undefended: anything worth taking is a gain.
  if (defenders.length === 0) return gained > 0;

  return gained > pieceValue(mover.type);
}

const FILES = "abcdefgh";

/**
 * Squares strictly between two points on a shared rank, file or diagonal.
 *
 * Empty when the squares share no line — a knight's move has nothing between
 * it, which is why knights cannot be blocked.
 */
export function slidingBetween(from: Square, to: Square): Square[] {
  const fromFile = FILES.indexOf(from[0]!);
  const toFile = FILES.indexOf(to[0]!);
  const fromRank = Number(from[1]);
  const toRank = Number(to[1]);

  const fileStep = Math.sign(toFile - fromFile);
  const rankStep = Math.sign(toRank - fromRank);

  const fileDistance = Math.abs(toFile - fromFile);
  const rankDistance = Math.abs(toRank - fromRank);

  const aligned =
    fileDistance === 0 || rankDistance === 0 || fileDistance === rankDistance;
  if (!aligned) return [];

  const squares: Square[] = [];
  let file = fromFile + fileStep;
  let rank = fromRank + rankStep;

  while (file !== toFile || rank !== toRank) {
    squares.push(`${FILES[file]}${rank}` as Square);
    file += fileStep;
    rank += rankStep;
  }

  return squares;
}

/**
 * The same position with `color` to move.
 *
 * Needed to ask what a piece attacks when it is not that side's turn. Returns
 * undefined if the result is not a legal position — a side to move while the
 * other is in check, for instance.
 */
export function withTurn(chess: Chess, color: Color): Chess | undefined {
  if (chess.turn() === color) return chess;

  const parts = chess.fen().split(" ");
  parts[1] = color;
  // En passant squares refer to the other side's last move; keeping one would
  // make the FEN inconsistent with the turn we are forcing.
  parts[3] = "-";

  try {
    return new Chess(parts.join(" "));
  } catch {
    return undefined;
  }
}
