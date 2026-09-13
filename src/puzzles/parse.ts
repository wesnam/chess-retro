/**
 * Reading the Lichess puzzle database (CC0).
 *
 * The published file is a 300MB zstd-compressed CSV of roughly 6.1 million
 * rows, so everything here works one line at a time and nothing accumulates.
 * Parsing is kept pure and separate from both the download and the database
 * write, which is what makes it testable against real rows.
 *
 * Columns, as published:
 *
 *   PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,
 *   GameUrl,OpeningTags,DailyDate
 *
 * A plain `split(",")` is correct for this file and a CSV parser is not
 * needed: no field is quoted, and the only field that could contain a comma —
 * OpeningTags — is one we do not read. Themes are space-separated within their
 * single column.
 */

export type ParsedPuzzle = {
  id: string;
  /**
   * The position BEFORE the opponent's setup move, exactly as published.
   * `movesUci[0]` must be applied before the puzzle is shown; see
   * `session.ts`, which is the only place that may do it.
   */
  fen: string;
  /** Space-separated UCI: [0] is the setup move, the rest are the solution. */
  movesUci: string;
  rating: number;
  ratingDeviation: number | undefined;
  popularity: number;
  nbPlays: number | undefined;
  gameUrl: string | undefined;
  themes: string[];
};

/** Column positions in the published file. */
const COL = {
  id: 0,
  fen: 1,
  moves: 2,
  rating: 3,
  ratingDeviation: 4,
  popularity: 5,
  nbPlays: 6,
  themes: 7,
  gameUrl: 8,
} as const;

/** How many columns a row must have before it is worth reading. */
const MIN_COLUMNS = 8;

/**
 * The lowest community rating a puzzle may have and still be served.
 *
 * Lichess popularity runs -100 to 100: the net verdict of everyone who solved
 * it. The ticket asks for low-quality material to be excluded, and this is the
 * measure the dataset itself provides. Set generously — the corpus is large
 * enough that a strict floor costs nothing, and a disliked puzzle is usually
 * disliked for being ambiguous or unsound.
 */
export const MIN_POPULARITY = 70;

/** Themes as published: one column, space-separated. */
export function parseThemes(raw: string): string[] {
  return raw.split(/\s+/).filter((theme) => theme !== "");
}

/**
 * An optional integer column.
 *
 * An empty column means "not recorded" and must not read as zero: zero plays
 * and an unrecorded play count are different facts, and the second must not
 * be able to look like an unpopular puzzle.
 */
function optionalInt(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * One row of the published CSV, or undefined if it is not a usable puzzle.
 *
 * Undefined rather than throwing: over 6.1 million rows a single malformed
 * line must cost that line and not the import. The header arrives through the
 * same path as every other line and is rejected here.
 */
export function parsePuzzleRow(line: string): ParsedPuzzle | undefined {
  if (line.trim() === "") return undefined;

  const fields = line.split(",");
  if (fields.length < MIN_COLUMNS) return undefined;

  const id = fields[COL.id]!;
  // The header, which the stream hands over like any other line.
  if (id === "PuzzleId") return undefined;

  const fen = fields[COL.fen]!;
  const movesUci = fields[COL.moves]!.trim();
  if (id === "" || fen === "" || movesUci === "") return undefined;

  // The first move is the opponent's setup move, so a puzzle needs at least
  // two: apply one, solve the next. A single-move row has nothing to solve.
  if (movesUci.split(/\s+/).length < 2) return undefined;

  const rating = Number(fields[COL.rating]);
  const popularity = Number(fields[COL.popularity]);
  // Both are filters rather than decoration, so a row that cannot supply them
  // is dropped rather than stored with a guessed value.
  if (!Number.isFinite(rating) || !Number.isFinite(popularity)) {
    return undefined;
  }

  const gameUrl = fields[COL.gameUrl]?.trim();

  return {
    id,
    fen,
    movesUci,
    rating,
    ratingDeviation: optionalInt(fields[COL.ratingDeviation]),
    popularity,
    nbPlays: optionalInt(fields[COL.nbPlays]),
    gameUrl: gameUrl === "" ? undefined : gameUrl,
    themes: parseThemes(fields[COL.themes] ?? ""),
  };
}
