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
  uciPrefix: string;
  eco: string;
  name: string;
  family: string;
  plyCount: number;
};

/** The part of a name before the first colon, e.g. "Sicilian Defense". */
export function familyOf(name: string): string {
  const family = name.split(":")[0]?.trim();
  return family && family !== "" ? family : name;
}

/**
 * Replay a SAN line into a space-separated UCI move sequence.
 *
 * The dataset stores SAN, but games are matched on UCI — SAN is ambiguous
 * without the position, so it cannot be compared move-for-move.
 */
export function uciPrefixOf(sanLine: string): string | undefined {
  const chess = new Chess();
  try {
    // chess.js accepts a bare movetext, move numbers included.
    chess.loadPgn(sanLine);
  } catch {
    return undefined;
  }

  const history = chess.history({ verbose: true });
  if (history.length === 0) return undefined;

  return history
    .map((move) => `${move.from}${move.to}${move.promotion ?? ""}`)
    .join(" ");
}

/** Parse one TSV file of the dataset. */
export function parseOpeningTsv(tsv: string): OpeningLine[] {
  const lines: OpeningLine[] = [];

  for (const row of tsv.split("\n")) {
    if (row.trim() === "") continue;

    const [eco, name, pgn] = row.split("\t");
    // The header, and any row missing a column.
    if (!eco || !name || !pgn || eco === "eco") continue;

    const uciPrefix = uciPrefixOf(pgn);
    // A line we cannot replay would become an opening keyed on nothing.
    if (!uciPrefix) continue;

    lines.push({
      uciPrefix,
      eco,
      name,
      family: familyOf(name),
      plyCount: uciPrefix.split(" ").length,
    });
  }

  return lines;
}

/** Where the vendored dataset lives, relative to this module. */
const DATA_DIR = path.join(process.cwd(), "src", "ingest", "openings-data");
const DATA_FILES = ["a.tsv", "b.tsv", "c.tsv", "d.tsv", "e.tsv"];

/**
 * Read every bundled TSV.
 *
 * Vendored into the repository rather than downloaded, so a first run needs no
 * network and produces the same names every time.
 */
export function loadOpeningLines(): OpeningLine[] {
  const lines: OpeningLine[] = [];
  for (const file of DATA_FILES) {
    const full = path.join(DATA_DIR, file);
    if (!fs.existsSync(full)) continue;
    lines.push(...parseOpeningTsv(fs.readFileSync(full, "utf8")));
  }
  return lines;
}

/**
 * Load the dataset into the database.
 *
 * Idempotent: rows are keyed by their UCI prefix, so re-running replaces
 * rather than duplicates.
 */
export function importOpenings(db: Db): number {
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
 * The deepest known line that prefixes these moves.
 *
 * Walks from the longest candidate down rather than scanning every line: the
 * index is keyed on the exact prefix string, so this is a handful of map
 * lookups instead of 3,800 comparisons per game.
 */
export function matchOpening(
  uciMoves: string[],
  index: Map<string, OpeningLine>,
): OpeningLine | undefined {
  const limit = Math.min(uciMoves.length, MAX_OPENING_PLIES);

  for (let length = limit; length > 0; length -= 1) {
    const candidate = index.get(uciMoves.slice(0, length).join(" "));
    if (candidate) return candidate;
  }

  return undefined;
}

/**
 * How deep the dataset goes. Looking further wastes lookups on every game;
 * the longest line in the CC0 set is comfortably inside this.
 */
const MAX_OPENING_PLIES = 40;

/** The UCI moves of a stored game, or undefined if its PGN cannot be read. */
function uciMovesOf(pgn: string): string[] | undefined {
  const chess = new Chess();
  try {
    chess.loadPgn(pgn);
  } catch {
    return undefined;
  }

  return chess
    .history({ verbose: true })
    .slice(0, MAX_OPENING_PLIES)
    .map((move) => `${move.from}${move.to}${move.promotion ?? ""}`);
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
  if (index.size === 0) return 0;

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
      const moves = uciMovesOf(row.pgn);
      if (!moves) continue;

      const match = matchOpening(moves, index);
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
