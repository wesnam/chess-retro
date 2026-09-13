import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { games, moves, syncState } from "@/db/schema";
import {
  currentMonth,
  fetchArchive,
  listArchiveMonths,
  type ArchiveMonth,
  type Fetcher,
} from "./chesscom";
import { labelGames } from "./openings";
import {
  mapGame,
  NotThisUsersGameError,
  UnusableGameError,
  type MappedGame,
} from "./map-game";

export type SyncProgress = {
  month: ArchiveMonth;
  monthsDone: number;
  monthsTotal: number;
  gamesStored: number;
};

export type SyncResult = {
  /** Games written for the first time. */
  stored: number;
  /** Games already present, left untouched. */
  skipped: number;
  /** Games we cannot analyse: variants, or a PGN that would not parse. */
  unusable: number;
  /** Games in the archive that this user did not play in. Not a defect. */
  notThisUser: number;
  monthsFetched: ArchiveMonth[];
};

export type SyncOptions = {
  username: string;
  corpusLimit: number;
  fetcher?: Fetcher;
  now?: Date;
  onProgress?: (progress: SyncProgress) => void;
};

/**
 * Fetch games newest-first until the corpus limit is reached.
 *
 * Months are walked backwards from the present because the limit is "the last
 * N games", so the newest month is the one that always matters. A month
 * already recorded as complete is skipped without a request; the current month
 * is never complete, since it is still accumulating games.
 */
export async function syncGames(db: Db, options: SyncOptions): Promise<SyncResult> {
  const { username, corpusLimit, fetcher, now = new Date(), onProgress } = options;

  const allMonths = await listArchiveMonths(username, fetcher);
  const newestFirst = [...allMonths].sort().reverse();
  const thisMonth = currentMonth(now);

  const result: SyncResult = {
    stored: 0,
    skipped: 0,
    unusable: 0,
    notThisUser: 0,
    monthsFetched: [],
  };

  let held = countGames(db, username);

  // Months we will actually request, so progress reflects real work rather
  // than counting months that are skipped without a fetch.
  const pending = newestFirst.filter(
    (month) => month === thisMonth || !isMonthComplete(db, username, month),
  );

  for (const [index, month] of pending.entries()) {
    // The current month is always re-checked: it is still accumulating games,
    // and a game played today must be picked up even when the corpus is
    // already at its limit.
    if (held >= corpusLimit && month !== thisMonth) break;

    const rawGames = await fetchArchive(username, month, fetcher);
    const mapped: MappedGame[] = [];
    for (const raw of rawGames) {
      try {
        mapped.push(mapGame(raw, username));
      } catch (error) {
        // Someone else's game is a routine filter, not a defect.
        if (error instanceof NotThisUsersGameError) {
          result.notThisUser += 1;
          continue;
        }
        if (error instanceof UnusableGameError) {
          result.unusable += 1;
          continue;
        }
        throw error;
      }
    }

    // Newest first within the month, so a partial month keeps recent games.
    mapped.sort((a, b) => b.game.endTime - a.game.endTime);

    // Past the limit we still accept games newer than everything we already
    // hold — those are games played since the last sync, and dropping the
    // newest game to keep an older one would be backwards. Anything older
    // waits for a later sync with a raised limit.
    //
    // This only applies to a corpus that already has games: on a first sync
    // every game is "newer" than nothing, which would ignore the limit.
    const newestHeld = held > 0 ? newestEndTime(db, username) : Infinity;

    let reachedLimit = false;
    for (const entry of mapped) {
      if (held >= corpusLimit && entry.game.endTime <= newestHeld) {
        reachedLimit = true;
        break;
      }
      if (storeGame(db, entry)) {
        result.stored += 1;
        held += 1;
      } else {
        result.skipped += 1;
      }
    }

    recordMonth(db, username, month, {
      // What we hold from this month in total, not what this run happened to
      // touch, so a no-op sync does not erase the count.
      gameCount: countGamesInMonth(db, username, month),
      // Complete only when the whole month was taken. A month cut short by the
      // corpus limit must stay incomplete, or raising the limit later could
      // never backfill it. The current month is never complete regardless: it
      // is still accumulating games.
      complete: month !== thisMonth && !reachedLimit,
      now,
    });
    result.monthsFetched.push(month);

    onProgress?.({
      month,
      monthsDone: index + 1,
      monthsTotal: pending.length,
      gamesStored: result.stored,
    });
  }

  // Name the newly stored games. Cheap — a handful of map lookups each, no
  // network and no engine — so a game normally appears in the list with its
  // opening already attached. Not guaranteed: if this fails the games are
  // still stored and visible, simply unnamed until the next sync.
  try {
    labelGames(db, username);
  } catch (error) {
    // A naming failure must not fail the sync: the games themselves are
    // stored and usable, and labelling retries on the next run because it
    // selects on a null opening name. Logged rather than swallowed, so a bug
    // that throws on every game is not completely invisible.
    console.warn("[chess-retro] could not label openings:", error);
  }

  return result;
}

function countGames(db: Db, username: string): number {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(games)
    .where(eq(games.user, username))
    .get();
  return row?.n ?? 0;
}

/** How many games we hold from one archive month. */
function countGamesInMonth(
  db: Db,
  username: string,
  month: ArchiveMonth,
): number {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(games)
    .where(
      and(
        eq(games.user, username),
        // end_time is unix seconds; compare on the UTC month it falls in.
        sql`strftime('%Y-%m', ${games.endTime}, 'unixepoch') = ${month}`,
      ),
    )
    .get();
  return row?.n ?? 0;
}

/** End time of the newest game held, or 0 when none are. */
function newestEndTime(db: Db, username: string): number {
  const row = db
    .select({ newest: sql<number | null>`max(${games.endTime})` })
    .from(games)
    .where(eq(games.user, username))
    .get();
  return row?.newest ?? 0;
}

function isMonthComplete(db: Db, username: string, month: ArchiveMonth): boolean {
  const row = db
    .select({ complete: syncState.complete })
    .from(syncState)
    .where(and(eq(syncState.user, username), eq(syncState.archiveMonth, month)))
    .get();
  return row?.complete === true;
}

/**
 * Write a game and its moves in one transaction. Returns false if the game was
 * already stored, so syncing twice does not duplicate anything.
 *
 * Move rows are written without evaluations; analysis fills those in later.
 */
function storeGame(db: Db, { game, moves: parsedMoves }: MappedGame): boolean {
  return db.transaction((tx) => {
    // Keyed on both: the same chess.com game is stored once per tracked
    // player, so the id alone would wrongly reject the second one.
    const existing = tx
      .select({ id: games.id })
      .from(games)
      .where(and(eq(games.id, game.id), eq(games.user, game.user)))
      .get();
    if (existing) return false;

    tx.insert(games).values(game).run();

    if (parsedMoves.length > 0) {
      tx.insert(moves)
        .values(
          parsedMoves.map((move) => ({
            gameId: game.id,
            ply: move.ply,
            user: game.user,
            timeClass: game.timeClass,
            isUserMove: move.color === game.userColor,
            color: move.color,
            fenBefore: move.fenBefore,
            san: move.san,
            uci: move.uci,
            piece: move.piece,
            clockMs: move.clockMs ?? null,
            moveTimeMs: move.moveTimeMs ?? null,
          })),
        )
        .run();
    }

    return true;
  });
}

function recordMonth(
  db: Db,
  username: string,
  month: ArchiveMonth,
  options: { gameCount: number; complete: boolean; now: Date },
): void {
  const values = {
    user: username,
    archiveMonth: month,
    fetchedAt: options.now.getTime(),
    gameCount: options.gameCount,
    complete: options.complete,
  };

  db.insert(syncState)
    .values(values)
    .onConflictDoUpdate({
      target: [syncState.user, syncState.archiveMonth],
      set: {
        fetchedAt: values.fetchedAt,
        gameCount: values.gameCount,
        complete: values.complete,
      },
    })
    .run();
}
