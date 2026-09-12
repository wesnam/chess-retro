import { and, eq, ne } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Db } from "@/db/client";
import { games, moves } from "@/db/schema";
import { analyseGame, type Analyser, type GameAnalysis } from "./analyze-game";

export type StoredGame = {
  id: string;
  user: string;
  pgn: string;
  userColor: string;
  analysisStatus: string;
  /** Carried so motif tagging can denormalise it without a second lookup. */
  timeClass: string;
};

/**
 * Analyse one game and persist the result.
 *
 * The whole game lands in a single transaction: either every move row carries
 * its evaluation and the game reads `done`, or nothing changed. A crash
 * therefore leaves a game marked `running`, which startup can reclaim rather
 * than leaving half-analysed rows behind.
 */
export class AlreadyRunningError extends Error {}

export async function analyseAndStore(
  db: Db,
  game: StoredGame,
  engine: Analyser,
  options: {
    /**
     * Skip the claim because the caller already holds this game. The batch job
     * claims as it pulls work from the queue; claiming twice would refuse the
     * job's own game as already running.
     */
    alreadyClaimed?: boolean;
    /** Identifies this caller in `analysis_owner`; defaults to a fresh id. */
    owner?: string;
  } = {},
): Promise<GameAnalysis> {
  const owner = options.owner ?? randomUUID();

  if (!options.alreadyClaimed && !claimGame(db, game, owner)) {
    throw new AlreadyRunningError(
      `Game ${game.id} is already being analysed.`,
    );
  }

  let analysis: GameAnalysis;
  try {
    analysis = await analyseGame(
      game.pgn,
      game.userColor === "b" ? "b" : "w",
      engine,
    );
  } catch (error) {
    markFailed(db, game, error);
    throw error;
  }

  try {
    commit(db, game, analysis);
  } catch (error) {
    // A failure here — a ply the stored rows do not have — would otherwise
    // leave the game wedged at `running` forever, invisible to both the batch
    // (which counts only `pending`) and to a retry.
    markFailed(db, game, error);
    throw error;
  }

  return analysis;
}

/**
 * Record a game as failed, releasing the claim.
 *
 * Guarded on the row still being `running`: by now another caller could have
 * finished this game, and clobbering that would show an error beside a
 * populated accuracy panel.
 */
function markFailed(db: Db, game: StoredGame, error: unknown): void {
  db.update(games)
    .set({
      analysisStatus: "error",
      analysisError: error instanceof Error ? error.message : String(error),
      analysisOwner: null,
    })
    .where(
      and(
        eq(games.id, game.id),
        eq(games.user, game.user),
        eq(games.analysisStatus, "running"),
      ),
    )
    .run();
}

function commit(db: Db, game: StoredGame, analysis: GameAnalysis): void {
  db.transaction((tx) => {
    for (const move of analysis.moves) {
      const result = tx
        .update(moves)
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

      // A ply the stored rows do not have means the PGN we analysed and the
      // rows sync wrote disagree. Committing `done` here would leave blank
      // evaluations behind a finished-looking game.
      if (result.changes === 0) {
        throw new Error(
          `No stored move at ply ${move.ply} for game ${game.id}; refusing to record a partial analysis.`,
        );
      }
    }

    tx.update(games)
      .set({
        analysisStatus: "done",
        analysisError: null,
        analysisDepth: analysis.depth,
        analyzedAt: Date.now(),
        accuracyUser: analysis.accuracyUser ?? null,
        // The run no longer holds this game; leaving a stale owner behind
        // would misreport who was working on what.
        analysisOwner: null,
      })
      .where(and(eq(games.id, game.id), eq(games.user, game.user)))
      .run();
  });
}

/**
 * Take ownership of a game for analysis, as a compare-and-set: the row only
 * moves to `running` if it is not already running. Returns false when another
 * request got there first, so two concurrent callers cannot both analyse the
 * same game and have the loser overwrite the winner.
 */
function claimGame(db: Db, game: StoredGame, owner: string): boolean {
  const result = db
    .update(games)
    .set({ analysisStatus: "running", analysisError: null, analysisOwner: owner })
    .where(
      and(
        eq(games.id, game.id),
        eq(games.user, game.user),
        ne(games.analysisStatus, "running"),
      ),
    )
    .run();
  return result.changes > 0;
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
      timeClass: games.timeClass,
    })
    .from(games)
    .where(and(eq(games.id, gameId), eq(games.user, user)))
    .get();
}
