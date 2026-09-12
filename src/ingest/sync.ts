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
import { mapGame, UnusableGameError, type MappedGame } from "./map-game";

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
  /** Games that could not be attributed or parsed (variants, malformed PGN). */
  unusable: number;
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
    monthsFetched: [],
  };

  let stored = countGames(db, username);

  for (const [index, month] of newestFirst.entries()) {
    if (stored >= corpusLimit) break;

    if (month !== thisMonth && isMonthComplete(db, username, month)) {
      continue;
    }

    const rawGames = await fetchArchive(username, month, fetcher);
    const mapped: MappedGame[] = [];
    for (const raw of rawGames) {
      try {
        mapped.push(mapGame(raw, username));
      } catch (error) {
        if (error instanceof UnusableGameError) {
          result.unusable += 1;
          continue;
        }
        throw error;
      }
    }

    // Newest first within the month, so a partial month keeps recent games.
    mapped.sort((a, b) => b.game.endTime - a.game.endTime);

    for (const entry of mapped) {
      if (stored >= corpusLimit) break;
      const wrote = storeGame(db, entry);
      if (wrote) {
        result.stored += 1;
        stored += 1;
      } else {
        result.skipped += 1;
      }
    }

    recordMonth(db, username, month, {
      gameCount: mapped.length,
      // The current month is still accumulating, so it is never complete.
      complete: month !== thisMonth,
      now,
    });
    result.monthsFetched.push(month);

    onProgress?.({
      month,
      monthsDone: index + 1,
      monthsTotal: newestFirst.length,
      gamesStored: result.stored,
    });
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
 * Move rows are written without evaluations; ticket 04 fills those in.
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
