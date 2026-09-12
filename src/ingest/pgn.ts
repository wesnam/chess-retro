import { Chess } from "chess.js";

export type ParsedMove = {
  ply: number;
  color: "w" | "b";
  san: string;
  uci: string;
  piece: string;
  fenBefore: string;
  /** Clock reading after this move, milliseconds. */
  clockMs: number | undefined;
  /** Time spent on this move, milliseconds. */
  moveTimeMs: number | undefined;
};

export type ParsedPgn = {
  eco: string | undefined;
  openingName: string | undefined;
  /** Raw chess.com time control, e.g. "180" or "600+5". */
  timeControl: string | undefined;
  moves: ParsedMove[];
};

/**
 * chess.com writes clocks as `[%clk H:MM:SS]` or `[%clk H:MM:SS.s]` — the
 * fractional part appears on faster time controls.
 */
const CLOCK_PATTERN = /\[%clk\s+(\d+):(\d{2}):(\d{2}(?:\.\d+)?)\]/;

export function parseClockMs(comment: string): number | undefined {
  const match = CLOCK_PATTERN.exec(comment);
  if (!match) return undefined;

  const [, hours, minutes, seconds] = match;
  const total =
    Number(hours) * 3_600_000 +
    Number(minutes) * 60_000 +
    Math.round(Number(seconds) * 1000);

  return Number.isFinite(total) ? total : undefined;
}

/**
 * The increment in seconds from a chess.com time control string. "180" has
 * none; "600+5" adds five seconds a move. Daily games use "1/259200", which
 * has no increment in this sense.
 */
export function parseIncrementMs(timeControl: string | undefined): number {
  if (!timeControl) return 0;
  const plus = timeControl.indexOf("+");
  if (plus === -1) return 0;
  const increment = Number(timeControl.slice(plus + 1));
  return Number.isFinite(increment) ? increment * 1000 : 0;
}

/**
 * Derive the opening name from chess.com's ECOUrl, which is the only place the
 * name appears in the PGN. The URL's last segment is the name in hyphenated
 * form, e.g. ".../Sicilian-Defense-2.Nf3-d6" -> "Sicilian Defense 2.Nf3 d6".
 *
 * Ticket 03 replaces this with a proper longest-prefix match against the
 * lichess openings dataset; until then it is better than showing nothing.
 */
export function openingNameFromEcoUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const slug = url.split("/").pop();
  if (!slug) return undefined;
  const name = slug.replace(/-/g, " ").trim();
  return name === "" ? undefined : name;
}

export function parsePgn(pgn: string): ParsedPgn {
  const chess = new Chess();
  chess.loadPgn(pgn);

  const headers = chess.getHeaders();
  const timeControl = headers.TimeControl;
  const incrementMs = parseIncrementMs(timeControl);

  // Comments are keyed by the FEN of the position they follow, which is the
  // position *after* the move they annotate.
  const clockByFen = new Map<string, number>();
  for (const { fen, comment } of chess.getComments()) {
    const clockMs = parseClockMs(comment);
    if (clockMs !== undefined) clockByFen.set(fen, clockMs);
  }

  const history = chess.history({ verbose: true });
  // A player's own previous clock reading, for deriving time spent.
  const previousClock: Record<"w" | "b", number | undefined> = {
    w: undefined,
    b: undefined,
  };

  const moves: ParsedMove[] = history.map((move, index) => {
    const color = move.color as "w" | "b";
    const clockMs = clockByFen.get(move.after);

    let moveTimeMs: number | undefined;
    const before = previousClock[color];
    if (before !== undefined && clockMs !== undefined) {
      // Time spent is the clock drop, plus whatever increment was added back.
      const spent = before - clockMs + incrementMs;
      moveTimeMs = spent >= 0 ? spent : undefined;
    }
    if (clockMs !== undefined) previousClock[color] = clockMs;

    return {
      ply: index + 1,
      color,
      san: move.san,
      uci: `${move.from}${move.to}${move.promotion ?? ""}`,
      piece: move.piece,
      fenBefore: move.before,
      clockMs,
      moveTimeMs,
    };
  });

  return {
    eco: headers.ECO,
    openingName: openingNameFromEcoUrl(headers.ECOUrl),
    timeControl,
    moves,
  };
}
