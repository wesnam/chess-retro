import { describe, it, expect, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDb, type Db } from "@/db/client";
import { games, moveMotifs, moves } from "@/db/schema";
import { tagCorpus, tagGame, tagMove, type MoveForTagging } from "./tag";

/**
 * The tagging pass, over a real database.
 *
 * The role distinction is what the whole weakness dashboard rests on: a
 * tactic the player MISSED is a weakness, one they PLAYED is a strength, and
 * conflating them would invert the rankings.
 */

let db: Db;

beforeEach(() => {
  db = createDb(":memory:");
});

/** A knight fork position: Nb5-c7+ hits the king on e8 and the rook on a8. */
const FORK_FEN = "r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1";

function move(overrides: Partial<MoveForTagging> = {}): MoveForTagging {
  return {
    ply: 1,
    fenBefore: FORK_FEN,
    uci: "b5a7",
    bestMoveUci: "b5c7",
    isUserMove: true,
    classification: "mistake",
    // A mistake by default, so the missed-tactic gate is satisfied unless a
    // test deliberately says otherwise.
    winPctBefore: 60,
    winPctAfter: 40,
    ...overrides,
  };
}

describe("tagMove", () => {
  it("marks a tactic the engine wanted but the player did not play as missed", () => {
    const tags = tagMove(move(), undefined);

    expect(tags).toContainEqual({ ply: 1, motif: "fork", role: "missed" });
  });

  it("marks a tactic the player found as played, not missed", () => {
    const tags = tagMove(move({ uci: "b5c7", bestMoveUci: "b5c7" }), undefined);

    expect(tags).toContainEqual({ ply: 1, motif: "fork", role: "played" });
    expect(tags.filter((t) => t.role === "missed")).toEqual([]);
  });

  it("does not call a tactic missed when the played move achieved it too", () => {
    // The engine preferred one route to the fork and the player found
    // another. Counting that as a miss would invent a weakness out of a
    // move that did the right thing.
    const tags = tagMove(
      move({ uci: "b5c7", bestMoveUci: "b5d6" }),
      undefined,
    );

    const missedForks = tags.filter(
      (t) => t.motif === "fork" && t.role === "missed",
    );
    expect(missedForks).toEqual([]);
  });

  it("marks what the opponent's reply did as allowed", () => {
    const reply = move({
      ply: 2,
      fenBefore: FORK_FEN,
      uci: "b5c7",
      bestMoveUci: null,
    });
    const tags = tagMove(move({ uci: "b5a7", bestMoveUci: "b5a7" }), reply);

    expect(tags).toContainEqual({ ply: 1, motif: "fork", role: "allowed" });
  });

  it("does not call a tactic missed when the move cost nothing", () => {
    // A move that threw away no win probability did not miss anything: the
    // engine simply preferred another route to the same result. Tagging these
    // produced 27 "missed" tags on moves classified *excellent* in the real
    // corpus — more than on mistakes and blunders combined, which would have
    // invented weaknesses out of good play.
    const tags = tagMove(
      move({ classification: "excellent", winPctBefore: 50, winPctAfter: 50 }),
      undefined,
    );

    expect(tags.filter((t) => t.role === "missed")).toEqual([]);
  });

  it("still calls it missed when the move genuinely cost something", () => {
    const tags = tagMove(
      move({ classification: "blunder", winPctBefore: 70, winPctAfter: 40 }),
      undefined,
    );

    expect(tags).toContainEqual({ ply: 1, motif: "fork", role: "missed" });
  });

  it("says nothing when there was no better move to compare against", () => {
    const tags = tagMove(
      move({ uci: "b5a7", bestMoveUci: null }),
      undefined,
    );

    expect(tags.filter((t) => t.role === "missed")).toEqual([]);
  });
});

describe("tagGame", () => {
  function seedGame(id = "g1", user = "alice") {
    db.insert(games)
      .values({
        id,
        user,
        pgn: "pgn",
        timeClass: "blitz",
        userColor: "w",
        userResult: "loss",
        endTime: 1_700_000_000,
        analysisStatus: "done",
      })
      .run();

    db.insert(moves)
      .values({
        gameId: id,
        ply: 1,
        user,
        timeClass: "blitz",
        isUserMove: true,
        color: "w",
        fenBefore: FORK_FEN,
        san: "Na7",
        uci: "b5a7",
        piece: "n",
        bestMoveUci: "b5c7",
        classification: "mistake",
        winPctBefore: 60,
        winPctAfter: 40,
      })
      .run();
  }

  it("writes the missed tactic to the database", () => {
    seedGame();
    tagGame(db, "alice", "g1", "blitz");

    const rows = db.select().from(moveMotifs).all();
    expect(rows).toContainEqual(
      expect.objectContaining({ motif: "fork", role: "missed" }),
    );
  });

  it("denormalises user and time class onto the tag", () => {
    seedGame();
    tagGame(db, "alice", "g1", "blitz");

    const row = db.select().from(moveMotifs).get()!;
    expect(row.user).toBe("alice");
    expect(row.timeClass).toBe("blitz");
  });

  it("replaces old tags rather than accumulating them", () => {
    // Re-running after improving a detector must not leave stale tags, and
    // must not double every count in the dashboard.
    seedGame();
    tagGame(db, "alice", "g1", "blitz");
    const once = db.select().from(moveMotifs).all().length;
    tagGame(db, "alice", "g1", "blitz");

    expect(db.select().from(moveMotifs).all()).toHaveLength(once);
  });

  it("ignores the opponent's own moves", () => {
    seedGame();
    db.update(moves).set({ isUserMove: false }).run();

    tagGame(db, "alice", "g1", "blitz");

    expect(db.select().from(moveMotifs).all()).toEqual([]);
  });
});

describe("tagCorpus", () => {
  function seedAnalysed(id: string, user = "alice", status = "done") {
    db.insert(games)
      .values({
        id,
        user,
        pgn: "pgn",
        timeClass: "blitz",
        userColor: "w",
        userResult: "loss",
        endTime: 1_700_000_000,
        analysisStatus: status,
      })
      .run();

    db.insert(moves)
      .values({
        gameId: id,
        ply: 1,
        user,
        timeClass: "blitz",
        isUserMove: true,
        color: "w",
        fenBefore: FORK_FEN,
        san: "Na7",
        uci: "b5a7",
        piece: "n",
        bestMoveUci: "b5c7",
        classification: "mistake",
        winPctBefore: 60,
        winPctAfter: 40,
      })
      .run();
  }

  it("backfills every analysed game", () => {
    seedAnalysed("g1");
    seedAnalysed("g2");

    const summary = tagCorpus(db, "alice");

    expect(summary.games).toBe(2);
    // Both games tagged, each carrying the same missed fork.
    const forks = db
      .select()
      .from(moveMotifs)
      .where(eq(moveMotifs.motif, "fork"))
      .all();
    expect(forks).toHaveLength(2);
  });

  it("skips games that are not analysed yet", () => {
    seedAnalysed("g1", "alice", "pending");

    expect(tagCorpus(db, "alice").games).toBe(0);
  });

  it("skips games already tagged, so re-running costs nothing", () => {
    seedAnalysed("g1");
    tagCorpus(db, "alice");

    expect(tagCorpus(db, "alice").games).toBe(0);
  });

  it("re-tags everything when asked", () => {
    seedAnalysed("g1");
    tagCorpus(db, "alice");

    expect(tagCorpus(db, "alice", { retagAll: true }).games).toBe(1);
  });

  it("leaves another user's games alone", () => {
    seedAnalysed("g1", "alice");
    seedAnalysed("g2", "bob");

    tagCorpus(db, "alice");

    const rows = db
      .select()
      .from(moveMotifs)
      .where(eq(moveMotifs.user, "bob"))
      .all();
    expect(rows).toEqual([]);
  });

  it("removes a game's tags when the game is deleted", () => {
    seedAnalysed("g1");
    tagCorpus(db, "alice");

    db.delete(games)
      .where(and(eq(games.id, "g1"), eq(games.user, "alice")))
      .run();

    expect(db.select().from(moveMotifs).all()).toEqual([]);
  });
});
