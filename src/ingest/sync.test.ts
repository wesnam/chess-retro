import { describe, it, expect, beforeEach } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { createDb, type Db } from "@/db/client";
import { games, moves, syncState } from "@/db/schema";
import { syncGames } from "./sync";
import { USER_AGENT, type Fetcher } from "./chesscom";
import archive from "./__fixtures__/archive-2024-03.json";

/**
 * Sync is exercised against a real database and a stub chess.com, so these
 * cover the whole ingestion path with no network.
 */

let db: Db;
const NOW = new Date("2024-06-15T12:00:00Z");

beforeEach(() => {
  db = createDb(":memory:");
});

type Archives = Record<string, unknown[]>;

/** A stub chess.com serving the months given, recording what was requested. */
function stubChesscom(archives: Archives) {
  const requested: string[] = [];
  const headersSeen: Array<Record<string, string>> = [];

  const fetcher: Fetcher = async (input, init) => {
    const url = String(input);
    requested.push(url);
    headersSeen.push((init?.headers ?? {}) as Record<string, string>);

    const body = url.endsWith("/archives")
      ? {
          archives: Object.keys(archives).map(
            (m) =>
              `https://api.chess.com/pub/player/x/games/${m.replace("-", "/")}`,
          ),
        }
      : { games: archives[monthOf(url)] ?? [] };

    return new Response(JSON.stringify(body), { status: 200 });
  };

  return { fetcher, requested, headersSeen };
}

function monthOf(url: string): string {
  const m = /\/(\d{4})\/(\d{2})$/.exec(url);
  return m ? `${m[1]}-${m[2]}` : "";
}

const gamesOf = (username: string) =>
  archive.games.filter(
    (g) =>
      g.white?.username?.toLowerCase() === username ||
      g.black?.username?.toLowerCase() === username,
  );

const countFor = (user: string) =>
  db
    .select({ n: sql<number>`count(*)` })
    .from(games)
    .where(eq(games.user, user))
    .get()!.n;

describe("fetching games", () => {
  it("stores the games chess.com returns", async () => {
    const { fetcher } = stubChesscom({ "2024-03": gamesOf("hikaru") });

    const result = await syncGames(db, {
      username: "hikaru",
      corpusLimit: 100,
      fetcher,
      now: NOW,
    });

    expect(result.stored).toBe(gamesOf("hikaru").length);
    expect(countFor("hikaru")).toBe(result.stored);
  });

  it("identifies itself, without which chess.com returns 403", async () => {
    const { fetcher, headersSeen } = stubChesscom({ "2024-03": [] });

    await syncGames(db, {
      username: "hikaru",
      corpusLimit: 10,
      fetcher,
      now: NOW,
    });

    expect(headersSeen.length).toBeGreaterThan(0);
    for (const headers of headersSeen) {
      expect(headers["User-Agent"]).toBe(USER_AGENT);
    }
  });

  it("stores the moves alongside the games", async () => {
    const { fetcher } = stubChesscom({ "2024-03": gamesOf("hikaru") });

    await syncGames(db, {
      username: "hikaru",
      corpusLimit: 1,
      fetcher,
      now: NOW,
    });

    const moveCount = db
      .select({ n: sql<number>`count(*)` })
      .from(moves)
      .get()!.n;
    expect(moveCount).toBeGreaterThan(20);
  });

  it("marks the user's own moves, so 'my' moves are attributable", async () => {
    const { fetcher } = stubChesscom({ "2024-03": gamesOf("hikaru") });

    await syncGames(db, {
      username: "hikaru",
      corpusLimit: 1,
      fetcher,
      now: NOW,
    });

    const stored = db.select().from(games).get()!;
    const mine = db
      .select({ n: sql<number>`count(*)` })
      .from(moves)
      .where(eq(moves.isUserMove, true))
      .get()!.n;
    const total = db
      .select({ n: sql<number>`count(*)` })
      .from(moves)
      .get()!.n;

    // Roughly half the moves are the user's, give or take the last ply.
    expect(mine).toBeGreaterThan(0);
    expect(mine).toBeLessThan(total);
    expect(stored.userColor === "w" || stored.userColor === "b").toBe(true);
  });

  it("skips games it cannot use rather than failing the sync", async () => {
    const usable = gamesOf("hikaru");
    const { fetcher } = stubChesscom({
      "2024-03": [...usable, { ...usable[0], uuid: "variant-1", rules: "chess960" }],
    });

    const result = await syncGames(db, {
      username: "hikaru",
      corpusLimit: 100,
      fetcher,
      now: NOW,
    });

    expect(result.unusable).toBe(1);
    expect(result.stored).toBe(usable.length);
  });
});

describe("syncing twice", () => {
  it("does not duplicate games", async () => {
    const { fetcher } = stubChesscom({ "2024-03": gamesOf("hikaru") });
    const options = {
      username: "hikaru",
      corpusLimit: 100,
      fetcher,
      now: NOW,
    };

    const first = await syncGames(db, options);
    const afterFirst = countFor("hikaru");

    // The month is now complete, so a second sync should not even refetch it.
    const second = await syncGames(db, options);

    expect(countFor("hikaru")).toBe(afterFirst);
    expect(second.stored).toBe(0);
    expect(first.stored).toBeGreaterThan(0);
  });

  it("does not duplicate moves", async () => {
    const { fetcher } = stubChesscom({ "2024-03": gamesOf("hikaru") });
    const options = { username: "hikaru", corpusLimit: 2, fetcher, now: NOW };

    await syncGames(db, options);
    const afterFirst = db.select({ n: sql<number>`count(*)` }).from(moves).get()!.n;

    await syncGames(db, options);

    expect(db.select({ n: sql<number>`count(*)` }).from(moves).get()!.n).toBe(
      afterFirst,
    );
  });
});

describe("archive month bookkeeping", () => {
  it("records which months were fetched", async () => {
    const { fetcher } = stubChesscom({
      "2024-02": [],
      "2024-03": gamesOf("hikaru"),
    });

    await syncGames(db, {
      username: "hikaru",
      corpusLimit: 100,
      fetcher,
      now: NOW,
    });

    const months = db
      .select({ month: syncState.archiveMonth })
      .from(syncState)
      .all()
      .map((r) => r.month);

    expect(months).toContain("2024-03");
  });

  it("marks a past month complete, so it is never refetched", async () => {
    const { fetcher, requested } = stubChesscom({
      "2024-03": gamesOf("hikaru"),
    });
    const options = { username: "hikaru", corpusLimit: 100, fetcher, now: NOW };

    await syncGames(db, options);
    const afterFirst = requested.filter((u) => u.includes("2024/03")).length;

    await syncGames(db, options);

    expect(requested.filter((u) => u.includes("2024/03")).length).toBe(
      afterFirst,
    );
  });

  it("never marks the current month complete, since it is still filling up", async () => {
    const now = new Date("2024-03-20T12:00:00Z");
    const { fetcher } = stubChesscom({ "2024-03": gamesOf("hikaru") });

    await syncGames(db, {
      username: "hikaru",
      corpusLimit: 100,
      fetcher,
      now,
    });

    const row = db
      .select({ complete: syncState.complete })
      .from(syncState)
      .where(
        and(
          eq(syncState.user, "hikaru"),
          eq(syncState.archiveMonth, "2024-03"),
        ),
      )
      .get();

    expect(row?.complete).toBe(false);
  });

  it("refetches the current month on a later sync", async () => {
    const now = new Date("2024-03-20T12:00:00Z");
    const { fetcher, requested } = stubChesscom({
      "2024-03": gamesOf("hikaru"),
    });
    const options = { username: "hikaru", corpusLimit: 100, fetcher, now };

    await syncGames(db, options);
    const afterFirst = requested.filter((u) => u.includes("2024/03")).length;

    await syncGames(db, options);

    expect(
      requested.filter((u) => u.includes("2024/03")).length,
    ).toBeGreaterThan(afterFirst);
  });
});

describe("corpus limit", () => {
  it("stops once it has enough games", async () => {
    const { fetcher } = stubChesscom({ "2024-03": gamesOf("hikaru") });

    const result = await syncGames(db, {
      username: "hikaru",
      corpusLimit: 2,
      fetcher,
      now: NOW,
    });

    expect(result.stored).toBe(2);
    expect(countFor("hikaru")).toBe(2);
  });

  it("walks months backwards, keeping the newest games", async () => {
    const older = gamesOf("hikaru").map((g, i) => ({
      ...g,
      uuid: `old-${i}`,
      end_time: 1,
    }));
    const { fetcher } = stubChesscom({
      "2024-01": older,
      "2024-03": gamesOf("hikaru"),
    });

    await syncGames(db, {
      username: "hikaru",
      corpusLimit: 1,
      fetcher,
      now: NOW,
    });

    const stored = db.select({ endTime: games.endTime }).from(games).all();
    expect(stored).toHaveLength(1);
    // The kept game is from March, not the seeded January month.
    expect(stored[0]!.endTime).toBeGreaterThan(1);
  });

  it("backfills further when the limit is raised", async () => {
    const older = gamesOf("hikaru").map((g, i) => ({
      ...g,
      uuid: `old-${i}`,
      end_time: 1_700_000_000 + i,
    }));
    const { fetcher } = stubChesscom({
      "2024-01": older,
      "2024-03": gamesOf("hikaru"),
    });
    const base = { username: "hikaru", fetcher, now: NOW };

    await syncGames(db, { ...base, corpusLimit: 1 });
    const afterSmall = countFor("hikaru");

    await syncGames(db, { ...base, corpusLimit: 4 });

    expect(countFor("hikaru")).toBeGreaterThan(afterSmall);
  });
});

describe("two users in one database", () => {
  it("keeps their games apart", async () => {
    // The same fixture game viewed from both sides: one game on chess.com,
    // two rows here, one per player, never blended.
    const shared = archive.games.filter(
      (g) => g.white?.username?.toLowerCase() === "hikaru",
    );
    const { fetcher } = stubChesscom({ "2024-03": shared });

    await syncGames(db, {
      username: "hikaru",
      corpusLimit: 50,
      fetcher,
      now: NOW,
    });
    await syncGames(db, {
      username: "robert_angier",
      corpusLimit: 50,
      fetcher,
      now: NOW,
    });

    expect(countFor("hikaru")).toBeGreaterThan(0);
    expect(countFor("robert_angier")).toBeGreaterThan(0);

    // Each row is attributed to exactly one user, with its own colour.
    const hikaruColors = db
      .select({ color: games.userColor })
      .from(games)
      .where(eq(games.user, "hikaru"))
      .all()
      .map((r) => r.color);
    const otherColors = db
      .select({ color: games.userColor })
      .from(games)
      .where(eq(games.user, "robert_angier"))
      .all()
      .map((r) => r.color);

    expect(hikaruColors.every((c) => c === "w")).toBe(true);
    expect(otherColors.every((c) => c === "b")).toBe(true);
  });

  it("keeps their move rows apart too", async () => {
    const shared = archive.games.filter(
      (g) => g.white?.username?.toLowerCase() === "hikaru",
    );
    const { fetcher } = stubChesscom({ "2024-03": shared });

    await syncGames(db, { username: "hikaru", corpusLimit: 1, fetcher, now: NOW });
    await syncGames(db, {
      username: "robert_angier",
      corpusLimit: 1,
      fetcher,
      now: NOW,
    });

    const users = db
      .selectDistinct({ user: moves.user })
      .from(moves)
      .all()
      .map((r) => r.user)
      .sort();

    expect(users).toEqual(["hikaru", "robert_angier"]);
  });

  it("tracks archive months per user", async () => {
    const { fetcher } = stubChesscom({ "2024-03": gamesOf("hikaru") });

    await syncGames(db, { username: "hikaru", corpusLimit: 50, fetcher, now: NOW });
    await syncGames(db, {
      username: "robert_angier",
      corpusLimit: 50,
      fetcher,
      now: NOW,
    });

    const rows = db.select({ user: syncState.user }).from(syncState).all();
    const users = new Set(rows.map((r) => r.user));

    expect(users.has("hikaru")).toBe(true);
    expect(users.has("robert_angier")).toBe(true);
  });
});
