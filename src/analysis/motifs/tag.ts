import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { games, moveMotifs, moves } from "@/db/schema";
import { detectMotifs, type Motif } from "./detect";

/**
 * Tag stored moves with the tactics they involve.
 *
 * Runs entirely over stored analysis — no engine time — so the whole corpus
 * can be backfilled in seconds and re-tagged whenever a detector improves.
 */

/**
 * missed  — available in the engine's best line and not played. This is what
 *           drives weakness detection.
 * played  — the user found it.
 * allowed — the opponent's reply exploited it.
 */
export type MotifRole = "missed" | "played" | "allowed";

export type TaggedMove = {
  ply: number;
  motif: Motif;
  role: MotifRole;
};

export type MoveForTagging = {
  ply: number;
  fenBefore: string;
  uci: string;
  bestMoveUci: string | null;
  isUserMove: boolean;
  classification: string | null;
  winPctBefore: number | null;
  winPctAfter: number | null;
};

/**
 * Win probability a move must throw away before the tactic it passed over
 * counts as *missed*.
 *
 * Without a floor, any move the engine merely disagreed with is tagged: in the
 * real corpus that put 27 "missed" tags on moves classified *excellent*, more
 * than on mistakes and blunders together. A tactic nobody lost anything by not
 * playing is not a weakness, and inventing one here produces false coaching
 * and wasted practice at the far end of the pipeline.
 *
 * Two points is the "excellent" boundary from the classifier, so this says:
 * anything the classifier is happy with did not miss anything.
 */
export const MISSED_MIN_WIN_PCT_DROP = 2;

/**
 * Which tactics a single move involves, in each role.
 *
 * The three roles come from three different moves in the same position:
 * what the engine wanted, what was played, and what the reply did.
 */
export function tagMove(
  move: MoveForTagging,
  opponentReply: MoveForTagging | undefined,
): TaggedMove[] {
  const tags: TaggedMove[] = [];

  // What the player actually did.
  for (const motif of detectMotifs(move.fenBefore, move.uci)) {
    tags.push({ ply: move.ply, motif, role: "played" });
  }

  // What the engine would have done instead. Only counted as *missed* when
  // the player did not in fact play it AND passing it over actually cost
  // something — the engine's move being best is not itself a miss.
  if (move.bestMoveUci && move.bestMoveUci !== move.uci && costSomething(move)) {
    const best = detectMotifs(move.fenBefore, move.bestMoveUci);
    const played = new Set(
      tags.filter((t) => t.role === "played").map((t) => t.motif),
    );

    for (const motif of best) {
      // A tactic present in both the played move and the best move was not
      // missed; the player found that idea, even if by another route.
      if (played.has(motif)) continue;
      tags.push({ ply: move.ply, motif, role: "missed" });
    }
  }

  // What the opponent's reply was able to do, which this move allowed.
  if (opponentReply) {
    for (const motif of detectMotifs(
      opponentReply.fenBefore,
      opponentReply.uci,
    )) {
      tags.push({ ply: move.ply, motif, role: "allowed" });
    }
  }

  return tags;
}

/** Did this move throw away enough win probability to have missed anything? */
function costSomething(move: MoveForTagging): boolean {
  const { winPctBefore, winPctAfter } = move;
  // Unmeasured moves are left in rather than silently dropped: an unanalysed
  // corpus should still tag, and the classifier's own labels carry the signal.
  if (winPctBefore == null || winPctAfter == null) return true;

  return winPctBefore - winPctAfter >= MISSED_MIN_WIN_PCT_DROP;
}

/**
 * Tag one game's stored moves, replacing whatever was there before.
 *
 * Re-tagging is idempotent: the old rows go first, so improving a detector and
 * re-running cannot leave stale tags behind.
 */
export function tagGame(
  db: Db,
  user: string,
  gameId: string,
  timeClass: string,
): number {
  const rows = db
    .select({
      ply: moves.ply,
      fenBefore: moves.fenBefore,
      uci: moves.uci,
      bestMoveUci: moves.bestMoveUci,
      isUserMove: moves.isUserMove,
      classification: moves.classification,
      winPctBefore: moves.winPctBefore,
      winPctAfter: moves.winPctAfter,
    })
    .from(moves)
    .where(and(eq(moves.gameId, gameId), eq(moves.user, user)))
    .orderBy(moves.ply)
    .all();

  const tags: TaggedMove[] = [];
  for (const [index, move] of rows.entries()) {
    // Only the user's own moves carry weakness signal; the opponent's
    // mistakes are not this player's to practise.
    if (!move.isUserMove) continue;
    tags.push(...tagMove(move, rows[index + 1]));
  }

  db.transaction((tx) => {
    tx.delete(moveMotifs)
      .where(and(eq(moveMotifs.gameId, gameId), eq(moveMotifs.user, user)))
      .run();

    for (const tag of tags) {
      tx.insert(moveMotifs)
        .values({
          gameId,
          ply: tag.ply,
          user,
          timeClass,
          motif: tag.motif,
          role: tag.role,
        })
        // The same motif can arise twice in one role on one ply; the primary
        // key already says that is one fact, not two.
        .onConflictDoNothing()
        .run();
    }

    // Stamped inside the same transaction as the rows it describes, so a
    // crash cannot leave a game marked tagged with nothing to show for it.
    tx.update(games)
      .set({ motifsTaggedAt: Date.now() })
      .where(and(eq(games.id, gameId), eq(games.user, user)))
      .run();
  });

  return tags.length;
}

export type BacklogSummary = { games: number; tags: number };

/**
 * Tag every analysed game for a user that has no tags yet.
 *
 * Cheap enough to run whenever analysis finishes: no engine, one pass over
 * rows already in the database.
 */
export function tagCorpus(
  db: Db,
  user: string,
  options: { retagAll?: boolean } = {},
): BacklogSummary {
  const candidates = db
    .select({
      id: games.id,
      timeClass: games.timeClass,
      motifsTaggedAt: games.motifsTaggedAt,
    })
    .from(games)
    .where(and(eq(games.user, user), eq(games.analysisStatus, "done")))
    .all();

  let tagged = 0;
  let total = 0;

  for (const game of candidates) {
    // The marker rather than the presence of rows: a game containing no
    // tactics at all has no rows, and would otherwise be re-detected forever.
    if (!options.retagAll && game.motifsTaggedAt !== null) continue;
    total += tagGame(db, user, game.id, game.timeClass);
    tagged += 1;
  }

  return { games: tagged, tags: total };
}
