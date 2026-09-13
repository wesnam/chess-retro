import { Chess } from "chess.js";
import type { Key } from "chessground/types";
import type { Score } from "@/analysis/accuracy";

/**
 * What a live search has said so far.
 *
 * The engine reports continuously as it deepens, and this is the reduction of
 * that stream into the one thing worth showing: its best assessment yet. Pure
 * and React-free, so the ordering rules below — which are the whole substance
 * of the panel — are asserted directly.
 */

/** One `info` line's worth of news, already parsed out of UCI. */
export type LiveInfo = {
  depth: number;
  score: Score;
  /** Space-separated UCI, or absent on a line that carried no variation. */
  pv: string | undefined;
};

export type LiveAnalysis = {
  depth: number;
  /** From the perspective of the side to move, as UCI reports it. */
  score: Score | undefined;
  pv: string[];
};

export function emptyLive(): LiveAnalysis {
  return { depth: 0, score: undefined, pv: [] };
}

/**
 * Fold one info event into what is shown.
 *
 * Depth never goes backwards. Stockfish reports a lower depth mid-search
 * often enough to matter — a new iteration's first lines, and the helper
 * threads' — and accepting those would walk the evaluation backwards through
 * numbers the search has already superseded, so the panel flickers between
 * two assessments while the engine is quite sure of one.
 */
export function applyInfo(live: LiveAnalysis, info: LiveInfo): LiveAnalysis {
  if (info.depth < live.depth) return live;

  return {
    depth: info.depth,
    score: info.score,
    // Kept when the event carried none: a line without a `pv` must not erase
    // one already captured, or the variation blinks out between events.
    pv: info.pv ? info.pv.trim().split(/\s+/) : live.pv,
  };
}

/** The engine's current choice, as squares to draw an arrow between. */
export function liveArrow(live: LiveAnalysis): [Key, Key] | undefined {
  const first = live.pv[0];
  if (!first) return undefined;

  const from = first.slice(0, 2);
  const to = first.slice(2, 4);
  // Validated rather than cast: a malformed square reaching the board draws
  // nothing at all, which is harder to notice than a wrong arrow.
  if (!SQUARE.test(from) || !SQUARE.test(to)) return undefined;
  return [from as Key, to as Key];
}

const SQUARE = /^[a-h][1-8]$/;

/**
 * The variation in the notation players actually read.
 *
 * `e2e4 e7e5 g1f3` is a line only an engine enjoys. Truncates at the first
 * move that does not fit rather than returning nothing: the moves before the
 * break are still the engine's real intention, and a line that has outrun its
 * position by one move is not a reason to show none of it.
 */
export function principalVariationSan(fen: string, pv: string[]): string[] {
  let board: Chess;
  try {
    board = new Chess(fen);
  } catch {
    return [];
  }

  const san: string[] = [];
  for (const uci of pv) {
    try {
      const played = board.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.slice(4) || undefined,
      });
      if (!played) break;
      san.push(played.san);
    } catch {
      break;
    }
  }
  return san;
}

/**
 * The evaluation as it is written on a scoresheet: White's perspective.
 *
 * UCI reports from the side to move, so this flips every ply. Converting here
 * rather than at the engine keeps one rule in one place — the same rule
 * `whitePovScore` applies to stored moves.
 */
export function formatLiveScore(
  score: Score | undefined,
  fen: string,
): string {
  const white = whitePovLiveScore(score, fen);
  if (!white) return "—";

  if (white.kind === "mate") {
    // The distance is taken from the ORIGINAL score, not the converted one:
    // `mate 0` is carried as ±1 so the bar can tell a mated White from a mated
    // Black, but it is still a mate in zero and must print as one.
    const distance = score?.kind === "mate" ? Math.abs(score.moves) : 0;
    return `${white.moves < 0 ? "−" : "+"}M${distance}`;
  }

  const pawns = white.cp / 100;
  return `${pawns >= 0 ? "+" : "−"}${Math.abs(pawns).toFixed(2)}`;
}

/**
 * A live evaluation converted to White's perspective.
 *
 * UCI reports from the side to move, which flips every ply. Anything that
 * shares a scale with the stored evaluations — the eval bar above all — has to
 * be fed this rather than the raw score, or it lurches to the other side of
 * the board on every single move of an explored line.
 *
 * The same rule `whitePovScore` applies to stored moves, kept here so the live
 * path cannot drift from it.
 */
export function whitePovLiveScore(
  score: Score | undefined,
  fen: string,
): Score | undefined {
  if (!score) return undefined;

  const sign = sideToMove(fen) === "b" ? -1 : 1;

  if (score.kind === "mate") {
    /**
     * `mate 0` means the side to move is ALREADY checkmated — the worst score
     * there is, not the best.
     *
     * Multiplying by the sign leaves zero either way, and `winPct` reads any
     * non-positive mate as a certain loss FOR WHITE — so a mated Black would
     * come back as 0% for White, exactly inverted. Zero is therefore mapped to
     * a mate distance with a real sign: the mated side is the side to move, so
     * White to move is White's loss and Black to move is White's win. (A
     * negative zero would be the tidier spelling and does not survive JSON.)
     */
    if (score.moves === 0) return { kind: "mate", moves: sign === 1 ? -1 : 1 };
    return { kind: "mate", moves: score.moves * sign };
  }
  return { kind: "cp", cp: score.cp * sign };
}

/**
 * Read the side to move straight out of the FEN's second field.
 *
 * Cheaper than constructing a board, and this runs on every info event.
 */
export function sideToMove(fen: string): "w" | "b" {
  return fen.split(/\s+/)[1] === "b" ? "b" : "w";
}

/**
 * Write a variation the way a book does: `14. Nf3 Bg4 15. h3`.
 *
 * A bare list of moves gives a reader no way to tell whose move each one is,
 * which in a line starting on Black's move is exactly what they need to know.
 * The move number comes from the FEN's own counter, so a line in the
 * middlegame is numbered as the game numbers it rather than from one.
 */
export function numberVariation(san: string[], fen: string): string {
  const moveNumber = Number(fen.split(/\s+/)[5]) || 1;
  const blackFirst = sideToMove(fen) === "b";

  const parts: string[] = [];
  for (const [index, move] of san.entries()) {
    // Offset by one when Black starts, so the pairing lands on the right side
    // of each move number.
    const ply = blackFirst ? index + 1 : index;
    const number = moveNumber + Math.floor(ply / 2);

    if (ply % 2 === 0) {
      parts.push(`${number}. ${move}`);
    } else if (index === 0) {
      // A line opening on Black's move needs the ellipsis, or it reads as
      // White's move.
      parts.push(`${number}... ${move}`);
    } else {
      parts.push(move);
    }
  }
  return parts.join(" ");
}
