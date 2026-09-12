import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { games, moves } from "@/db/schema";
import { analyseGame, type Analyser, type GameAnalysis } from "./analyze-game";

export type StoredGame = {
  id: string;
  user: string;
  pgn: string;
  userColor: string;
  analysisStatus: string;
};

/**
 * Analyse one game and persist the result.
 *
 * The whole game lands in a single transaction: either every move row carries
 * its evaluation and the game reads `done`, or nothing changed. A crash
 * therefore leaves a game marked `running`, which startup can reclaim rather
 * than leaving half-analysed rows behind.
 */
export async function analyseAndStore(
  db: Db,
  game: StoredGame,
  engine: Analyser,
): Promise<GameAnalysis> {
  markRunning(db, game);

  let analysis: GameAnalysis;
  try {
    analysis = await analyseGame(
      game.pgn,
      game.userColor === "b" ? "b" : "w",
      engine,
    );
  } catch (error) {
    db.update(games)
      .set({
        analysisStatus: "error",
        analysisError: error instanceof Error ? error.message : String(error),
      })
      .where(and(eq(games.id, game.id), eq(games.user, game.user)))
      .run();
    throw error;
  }

  db.transaction((tx) => {
    for (const move of analysis.moves) {
      tx.update(moves)
        .set({
          evalBefore: move.evalBefore,
          evalAfter: move.evalAfter,
          mateBefore: move.mateBefore,
          mateAfter: move.mateAfter,
          bestMoveUci: move.bestMoveUci ?? null,
          cpLoss: move.cpLoss,
          winPctBefore: move.winPctBefore,
          winPctAfter: move.winPctAfter,
          moveAccuracy: move.moveAccuracy,
          classification: move.classification,
        })
        .where(
          and(
            eq(moves.gameId, game.id),
            eq(moves.user, game.user),
            eq(moves.ply, move.ply),
          ),
        )
        .run();
    }

    tx.update(games)
      .set({
        analysisStatus: "done",
        analysisError: null,
        analysisDepth: analysis.depth,
        analyzedAt: Date.now(),
        accuracyUser: analysis.accuracyUser ?? null,
      })
      .where(and(eq(games.id, game.id), eq(games.user, game.user)))
      .run();
  });

  return analysis;
}

function markRunning(db: Db, game: StoredGame): void {
  db.update(games)
    .set({ analysisStatus: "running", analysisError: null })
    .where(and(eq(games.id, game.id), eq(games.user, game.user)))
    .run();
}

/**
 * Games left `running` by a crashed process, returned to `pending` so they are
 * picked up again. Safe because a game's rows are only written on completion.
 */
export function reclaimOrphanedGames(db: Db): number {
  const result = db
    .update(games)
    .set({ analysisStatus: "pending" })
    .where(eq(games.analysisStatus, "running"))
    .run();
  return result.changes;
}

export function findGame(
  db: Db,
  user: string,
  gameId: string,
): StoredGame | undefined {
  return db
    .select({
      id: games.id,
      user: games.user,
      pgn: games.pgn,
      userColor: games.userColor,
      analysisStatus: games.analysisStatus,
    })
    .from(games)
    .where(and(eq(games.id, gameId), eq(games.user, user)))
    .get();
}
