import type { ChesscomGame } from "./chesscom";
import { parsePgn, type ParsedMove } from "./pgn";

export type GameRow = {
  id: string;
  user: string;
  url: string | null;
  pgn: string;
  timeClass: string;
  timeControl: string | null;
  userColor: "w" | "b";
  userResult: "win" | "loss" | "draw";
  userResultRaw: string | null;
  userRating: number | null;
  opponentUsername: string | null;
  opponentRating: number | null;
  rated: boolean;
  endTime: number;
  eco: string | null;
  openingName: string | null;
  openingFamily: string | null;
  ccAccuracyUser: number | null;
  ccAccuracyOpponent: number | null;
};

export type MappedGame = { game: GameRow; moves: ParsedMove[] };

/**
 * chess.com reports a per-player result token. Exactly one of the two is
 * "win" in a decisive game; every other token on the winning side's opponent
 * means a loss, and the draw tokens are shared by both players.
 */
const DRAW_RESULTS = new Set([
  "agreed",
  "repetition",
  "stalemate",
  "insufficient",
  "50move",
  "timevsinsufficient",
]);

const LOSS_RESULTS = new Set([
  "checkmated",
  "timeout",
  "resigned",
  "lose",
  "abandoned",
  "kingofthehill",
  "threecheck",
  "bughousepartnerlose",
]);

/**
 * chess.com reports one result token per player. Unknown tokens are reported
 * rather than assumed: guessing "loss" would quietly depress every measured
 * figure if chess.com ever adds a draw token we do not know about.
 */
export function resultFor(raw: string | undefined): "win" | "loss" | "draw" | undefined {
  if (raw === "win") return "win";
  if (raw && DRAW_RESULTS.has(raw)) return "draw";
  if (raw && LOSS_RESULTS.has(raw)) return "loss";
  return undefined;
}

/** A game we cannot use: malformed, or a variant we do not analyse. */
export class UnusableGameError extends Error {}

/**
 * Not this user's game. Routine when two players are tracked from one
 * archive, so it is counted separately from a genuine data defect.
 */
export class NotThisUsersGameError extends UnusableGameError {}

/**
 * Convert one chess.com game into the rows we store, from the perspective of
 * `user`. Throws UnusableGameError for anything we cannot attribute or parse,
 * so the caller can skip it without aborting a whole sync.
 */
export function mapGame(raw: ChesscomGame, user: string): MappedGame {
  if (!raw.uuid) throw new UnusableGameError("game has no id");
  if (!raw.pgn) throw new UnusableGameError("game has no PGN");

  // Variants (chess960, bughouse, …) have different rules and would corrupt
  // both the engine analysis and the aggregates.
  if (raw.rules && raw.rules !== "chess") {
    throw new UnusableGameError(`unsupported variant: ${raw.rules}`);
  }

  const white = raw.white?.username?.toLowerCase();
  const black = raw.black?.username?.toLowerCase();
  const userColor: "w" | "b" | undefined =
    white === user ? "w" : black === user ? "b" : undefined;

  if (!userColor) {
    throw new NotThisUsersGameError(`${user} did not play in this game`);
  }

  const mine = userColor === "w" ? raw.white : raw.black;
  const theirs = userColor === "w" ? raw.black : raw.white;

  // chess.js throws its own parser error on a malformed PGN. Convert it, so a
  // single bad game is skipped rather than aborting the whole sync.
  let parsed;
  try {
    parsed = parsePgn(raw.pgn);
  } catch (cause) {
    throw new UnusableGameError(`could not parse PGN: ${String(cause)}`);
  }
  const userResult = resultFor(mine?.result);
  if (!userResult) {
    throw new UnusableGameError(
      `unrecognised chess.com result: ${mine?.result ?? "(none)"}`,
    );
  }

  return {
    game: {
      id: raw.uuid,
      user,
      url: raw.url ?? null,
      pgn: raw.pgn,
      timeClass: raw.time_class ?? "unknown",
      timeControl: raw.time_control ?? parsed.timeControl ?? null,
      userColor,
      userResult,
      userResultRaw: mine?.result ?? null,
      userRating: mine?.rating ?? null,
      opponentUsername: theirs?.username ?? null,
      opponentRating: theirs?.rating ?? null,
      rated: raw.rated ?? false,
      endTime: raw.end_time ?? 0,
      eco: parsed.eco ?? null,
      // Left blank on purpose. `labelGames` fills these from the Lichess
      // dataset by longest-prefix match, and it only considers games with no
      // name yet — so writing chess.com's here would permanently block the
      // real one. chess.com's ECOUrl slug carries no colon, which made every
      // variation its own "family" and left the opening dimension unrankable.
      openingName: null,
      openingFamily: null,
      // Stored for side-by-side comparison on the game page only. This must
      // never enter an aggregate: mixing two accuracy formulas would make the
      // corpus methodologically incoherent.
      ccAccuracyUser:
        (userColor === "w" ? raw.accuracies?.white : raw.accuracies?.black) ??
        null,
      ccAccuracyOpponent:
        (userColor === "w" ? raw.accuracies?.black : raw.accuracies?.white) ??
        null,
    },
    moves: parsed.moves,
  };
}
