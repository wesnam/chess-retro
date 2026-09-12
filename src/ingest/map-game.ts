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

export function resultFor(raw: string | undefined): "win" | "loss" | "draw" {
  if (raw === "win") return "win";
  if (raw && DRAW_RESULTS.has(raw)) return "draw";
  return "loss";
}

/** The part of an opening name before the first colon or variation detail. */
export function openingFamilyOf(name: string | undefined): string | undefined {
  if (!name) return undefined;
  // chess.com names look like "Sicilian Defense 2.Nf3 d6 3.Bc4" — the family
  // is everything before the first move number.
  const family = name.split(/\s+\d+\./)[0]?.trim();
  return family === "" ? undefined : family;
}

export class UnusableGameError extends Error {}

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
    throw new UnusableGameError(`${user} did not play in this game`);
  }

  const mine = userColor === "w" ? raw.white : raw.black;
  const theirs = userColor === "w" ? raw.black : raw.white;
  const parsed = parsePgn(raw.pgn);
  const openingName = parsed.openingName;

  return {
    game: {
      id: raw.uuid,
      user,
      url: raw.url ?? null,
      pgn: raw.pgn,
      timeClass: raw.time_class ?? "unknown",
      timeControl: raw.time_control ?? parsed.timeControl ?? null,
      userColor,
      userResult: resultFor(mine?.result),
      userResultRaw: mine?.result ?? null,
      userRating: mine?.rating ?? null,
      opponentUsername: theirs?.username ?? null,
      opponentRating: theirs?.rating ?? null,
      rated: raw.rated ?? false,
      endTime: raw.end_time ?? 0,
      eco: parsed.eco ?? null,
      openingName: openingName ?? null,
      openingFamily: openingFamilyOf(openingName) ?? null,
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
