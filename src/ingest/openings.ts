import fs from "node:fs";
import path from "node:path";
import { Chess } from "chess.js";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { games, openings } from "@/db/schema";

/**
 * Naming games from the Lichess chess-openings dataset (CC0).
 *
 * A game is labelled by the LONGEST known line that prefixes its moves, which
 * is how Lichess itself assigns names: a short line is a false match unless it
 * is a genuine prefix, and the deepest match is the informative one.
 *
 * Both the full name and the family — the part before the first colon — are
 * stored. The family is what makes the opening dimension rankable: 3,800 lines
 * collapse to about 150 families, where every exact variation would otherwise
 * be near-unique per game and never reach the dashboard's evidence threshold.
 */

export type OpeningLine = {
  /**
   * The POSITION this line reaches, as the first four FEN fields — pieces,
   * side to move, castling rights and the en-passant square. The move counters
   * are dropped so the same position reached in a different number of moves
   * still matches.
   *
   * Stored in the `uci_prefix` column, which is the key the schema already
   * provides. Keying on the move sequence instead is what makes a
   * transposition unmatchable: a French Defense played 1.d4 e6 2.e4 d5 shares
   * no prefix with 1.e4 e6 2.d4 d5, and the walk bottoms out on a shallow
   * unrelated line. On the real corpus that mislabelled half the games,
   * including a French reported as a Horwitz Defense.
   */
  uciPrefix: string;
  eco: string;
  name: string;
  family: string;
  plyCount: number;
};

/**
 * A position key: the FEN without its move counters.
 *
 * Openings are defined by the position reached, not the order of moves that
 * reached it, so this is what both sides of the match are keyed on.
 */
export function positionKey(fen: string): string {
  return fen.split(" ").slice(0, 4).join(" ");
}

/** The part of a name before the first colon, e.g. "Sicilian Defense". */
export function familyOf(name: string): string {
  const family = name.split(":")[0]?.trim();
  return family && family !== "" ? family : name;
}

/**
 * Replay a SAN line and return the position it reaches, plus its length.
 *
 * The dataset stores SAN, which is meaningless without a board, so every line
 * is replayed once at import and stored as the position it arrives at.
 */
export function lineEndPosition(
  sanLine: string,
): { key: string; plyCount: number } | undefined {
  const chess = new Chess();
  try {
    // chess.js accepts a bare movetext, move numbers included.
    chess.loadPgn(sanLine);
  } catch {
    return undefined;
  }

  const plyCount = chess.history().length;
  if (plyCount === 0) return undefined;

  return { key: positionKey(chess.fen()), plyCount };
}

/** Parse one TSV file of the dataset. */
export function parseOpeningTsv(tsv: string): OpeningLine[] {
  const lines: OpeningLine[] = [];

  for (const row of tsv.split("\n")) {
    if (row.trim() === "") continue;

    const [eco, name, pgn] = row.split("\t");
    // The header, and any row missing a column.
    if (!eco || !name || !pgn || eco === "eco") continue;

    const position = lineEndPosition(pgn);
    // A line we cannot replay would become an opening keyed on nothing.
    if (!position) continue;

    lines.push({
      uciPrefix: position.key,
      eco,
      name,
      family: familyOf(name),
      plyCount: position.plyCount,
    });
  }

  return lines;
}

const DATA_FILES = ["a.tsv", "b.tsv", "c.tsv", "d.tsv", "e.tsv"];

/**
 * Where the vendored dataset lives.
 *
 * A static `process.cwd()` path on purpose. Resolving against the module's own
 * location would be more robust to being started from another directory, but
 * Turbopack refuses to statically analyse it — a computed path here makes it
 * trace the entire project into the server bundle, and the build then fails.
 *
 * The app already requires being started from the package root: `db/client.ts`
 * resolves `data/chess-retro.db` the same way, so a different cwd has no
 * database either. If that ever changes, this must change with it.
 */
const DATA_DIR = path.join(process.cwd(), "src", "ingest", "openings-data");

/**
 * Read every bundled TSV.
 *
 * Vendored into the repository rather than downloaded, so a first run needs no
 * network and produces the same names every time.
 */
export function loadOpeningLines(): OpeningLine[] {
  const lines: OpeningLine[] = [];
  const missing: string[] = [];

  for (const file of DATA_FILES) {
    const full = path.join(DATA_DIR, file);
    if (!fs.existsSync(full)) {
      missing.push(file);
      continue;
    }
    lines.push(...parseOpeningTsv(fs.readFileSync(full, "utf8")));
  }

  // Loudly, because the alternative is an app that boots looking healthy with
  // every game permanently unlabelled and nothing anywhere saying why. The
  // path is resolved from the working directory, so this fires when the
  // server was started from somewhere other than the package root.
  if (missing.length > 0) {
    console.warn(
      `[chess-retro] opening dataset incomplete: ${missing.length} of ${DATA_FILES.length} files missing from ${DATA_DIR}. Games will not be labelled with opening names.`,
    );
  }

  return lines;
}

/**
 * How many rows the bundled dataset holds, checked before doing the work.
 *
 * Parsing means replaying 3,800 SAN lines through chess.js, which costs about
 * a second — paid on every boot for a table that has not changed since the
 * last one. Comparing the stored count against the file count is free and
 * skips all of it.
 */
function bundledLineCount(): number {
  let count = 0;
  for (const file of DATA_FILES) {
    const full = path.join(DATA_DIR, file);
    if (!fs.existsSync(full)) continue;
    for (const row of fs.readFileSync(full, "utf8").split("\n")) {
      if (row.trim() === "" || row.startsWith("eco\t")) continue;
      count += 1;
    }
  }
  return count;
}

/**
 * Load the dataset into the database.
 *
 * Idempotent: rows are keyed by their UCI prefix, so re-running replaces
 * rather than duplicates. Skipped entirely when the table already holds every
 * bundled line, which is the case on every boot after the first.
 */
export function importOpenings(db: Db, options: { force?: boolean } = {}): number {
  if (!options.force) {
    const stored = db
      .select({ n: sql<number>`COUNT(*)` })
      .from(openings)
      .get()?.n ?? 0;
    // Only skip on an exact match: a partial import, or a dataset that grew
    // since the last run, must still be applied.
    if (stored > 0 && stored === bundledLineCount()) return stored;
  }

  const lines = loadOpeningLines();

  db.transaction((tx) => {
    for (const line of lines) {
      tx.insert(openings)
        .values(line)
        .onConflictDoUpdate({
          target: openings.uciPrefix,
          set: {
            eco: line.eco,
            name: line.name,
            family: line.family,
            plyCount: line.plyCount,
          },
        })
        .run();
    }
  });

  return lines.length;
}

/** Every stored line, indexed by UCI prefix for longest-prefix lookup. */
export function openingIndex(db: Db): Map<string, OpeningLine> {
  const rows = db
    .select({
      uciPrefix: openings.uciPrefix,
      eco: openings.eco,
      name: openings.name,
      family: openings.family,
      plyCount: openings.plyCount,
    })
    .from(openings)
    .all();

  return new Map(rows.map((row) => [row.uciPrefix, row]));
}

/**
 * The deepest known opening among the positions a game passed through.
 *
 * Takes the positions in order and walks back from the last, so the deepest
 * named position wins — the variation, not the generic line above it. Because
 * the key is the position rather than the moves that reached it, a game that
 * transposes into a line is still recognised as that line.
 */
export function matchOpening(
  positionKeys: string[],
  index: Map<string, OpeningLine>,
): OpeningLine | undefined {
  const limit = Math.min(positionKeys.length, MAX_OPENING_PLIES);

  for (let i = limit - 1; i >= 0; i -= 1) {
    const candidate = index.get(positionKeys[i]!);
    if (candidate) return candidate;
  }

  return undefined;
}

/**
 * How deep the dataset goes. Looking further wastes lookups on every game;
 * the longest line in the CC0 set is comfortably inside this.
 */
const MAX_OPENING_PLIES = 40;

/**
 * The positions a game passed through, in order, as position keys.
 *
 * One per ply played, capped at the opening phase — the position AFTER each
 * move, which is what the dataset's lines are keyed on.
 */
export function gamePositionKeys(pgn: string): string[] | undefined {
  const chess = new Chess();
  try {
    chess.loadPgn(pgn);
  } catch {
    return undefined;
  }

  const history = chess.history({ verbose: true });
  if (history.length === 0) return undefined;

  return history
    .slice(0, MAX_OPENING_PLIES)
    .map((move) => positionKey(move.after));
}

/**
 * Label a user's games with their openings.
 *
 * Runs over games already in the database, so a corpus downloaded before this
 * existed gets named too rather than only newly synced games.
 */
export function labelGames(
  db: Db,
  user: string,
  options: { relabelAll?: boolean } = {},
): number {
  const index = openingIndex(db);
  if (index.size === 0) {
    // Distinguished from "nothing to label": returning 0 either way makes a
    // never-imported dataset look identical to a fully labelled corpus.
    console.warn(
      "[chess-retro] no opening lines in the database; skipping labelling.",
    );
    return 0;
  }

  const rows = db
    .select({ id: games.id, pgn: games.pgn })
    .from(games)
    .where(
      options.relabelAll
        ? eq(games.user, user)
        : and(eq(games.user, user), isNull(games.openingName)),
    )
    .all();

  let labelled = 0;

  db.transaction((tx) => {
    for (const row of rows) {
      const positions = gamePositionKeys(row.pgn);
      if (!positions) continue;

      const match = matchOpening(positions, index);
      // A game matching no known line keeps its row and stays in the list;
      // it simply has no name to show.
      if (!match) continue;

      tx.update(games)
        .set({
          eco: match.eco,
          openingName: match.name,
          openingFamily: match.family,
        })
        .where(and(eq(games.id, row.id), eq(games.user, user)))
        .run();
      labelled += 1;
    }
  });

  return labelled;
}

/** How many of a user's games still carry no opening name. */
export function countUnlabelled(db: Db, user: string): number {
  const row = db
    .select({ n: sql<number>`COUNT(*)` })
    .from(games)
    .where(and(eq(games.user, user), isNull(games.openingName)))
    .get();
  return row?.n ?? 0;
}
