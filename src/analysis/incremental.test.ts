import { describe, it, expect, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDb, type Db } from "@/db/client";
import { games } from "@/db/schema";
import { syncGames } from "@/ingest/sync";
import type { Fetcher } from "@/ingest/chesscom";
import { AnalysisJob } from "./batch";
import type { Analyser } from "./analyze-game";
import type { Score } from "./accuracy";
import archive from "@/ingest/__fixtures__/archive-2024-03.json";

/**
 * Staying current has to be cheap: the whole point of the incremental path is
 * that a second sync analyses the games it just brought in and nothing else.
 *
 * Sync and the batch job are each tested on their own; what is asserted here is
 * the seam between them, which is where "seconds, not another overnight run"
 * is actually won or lost. Engine time is the cost that matters, so the stub
 * counts the games it is handed.
 */

let db: Db;
const USER = "hikaru";

beforeEach(() => {
  db = createDb(":memory:");
});

const cp = (n: number): Score => ({ kind: "cp", cp: n });

/** An analyser that records which games it was asked to look at. */
function countingEngine(): Analyser & { gamesSeen: string[] } {
  const stub = {
    depth: 18,
    gamesSeen: [] as string[],
    async newGame() {},
    async analyse(_fen: string) {
      return { score: cp(10), bestMove: "e2e4", bestLine: undefined, depth: 18 };
    },
  };
  return stub;
}

const mine = archive.games.filter(
  (g) =>
    g.white?.username?.toLowerCase() === USER ||
    g.black?.username?.toLowerCase() === USER,
);

/** A stub chess.com serving whatever `served` holds when it is called. */
function servingChesscom(months: () => Record<string, unknown[]>) {
  const requested: string[] = [];
  const fetcher: Fetcher = async (input) => {
    const url = String(input);
    requested.push(url);
    const archives = months();
    const match = /\/(\d{4})\/(\d{2})$/.exec(url);
    const body = url.endsWith("/archives")
      ? {
          archives: Object.keys(archives).map(
            (m) => `https://api.chess.com/pub/player/x/games/${m.replace("-", "/")}`,
          ),
        }
      : { games: archives[match ? `${match[1]}-${match[2]}` : ""] ?? [] };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  return { fetcher, requested };
}

function analysedIds(): string[] {
  return db
    .select({ id: games.id })
    .from(games)
    .where(and(eq(games.user, USER), eq(games.analysisStatus, "done")))
    .all()
    .map((r) => r.id);
}

/** Analyse everything outstanding, reporting which games cost engine time. */
async function analyseOutstanding(): Promise<string[]> {
  const engine = countingEngine();
  const job = new AnalysisJob({ db, user: USER, engines: [engine] });
  const before = new Set(analysedIds());
  await job.run();
  return analysedIds().filter((id) => !before.has(id));
}

describe("analysing after a re-sync", () => {
  it("analyses only the games the re-sync brought in", async () => {
    // A past month, complete after the first sync, plus the month still
    // accumulating games — the shape every real corpus has.
    const past = mine.map((g, i) => ({
      ...g,
      uuid: `past-${i}`,
      end_time: 1_709_000_000 + i,
    }));
    let current: unknown[] = [];
    const { fetcher } = servingChesscom(() => ({
      "2024-02": past,
      "2024-03": current,
    }));
    const now = new Date("2024-03-20T12:00:00Z");
    const options = { username: USER, corpusLimit: 100, fetcher, now };

    await syncGames(db, options);
    const firstPass = await analyseOutstanding();
    expect(firstPass.length).toBe(past.length);

    // A game played today lands in the current month.
    current = [{ ...mine[0], uuid: "played-today", end_time: 1_710_900_000 }];
    const second = await syncGames(db, options);
    expect(second.stored).toBe(1);

    const secondPass = await analyseOutstanding();

    // Exactly the new game cost engine time; the existing corpus was not
    // revisited. This is the difference between seconds and an overnight run.
    expect(secondPass).toEqual(["played-today"]);
  });

  it("costs no engine time at all when nothing new arrived", async () => {
    const { fetcher } = servingChesscom(() => ({ "2024-02": mine }));
    const now = new Date("2024-03-20T12:00:00Z");
    const options = { username: USER, corpusLimit: 100, fetcher, now };

    await syncGames(db, options);
    await analyseOutstanding();

    await syncGames(db, options);
    const engine = countingEngine();
    const job = new AnalysisJob({ db, user: USER, engines: [engine] });
    const progress = await job.run();

    expect(progress.total).toBe(0);
    expect(progress.completed).toBe(0);
  });
});

describe("raising the corpus limit", () => {
  it("analyses the games the backfill added and leaves the rest alone", async () => {
    const older = mine.map((g, i) => ({
      ...g,
      uuid: `older-${i}`,
      end_time: 1_700_000_000 + i,
    }));
    const newer = mine.map((g, i) => ({
      ...g,
      uuid: `newer-${i}`,
      end_time: 1_709_000_000 + i,
    }));
    const { fetcher } = servingChesscom(() => ({
      "2024-01": older,
      "2024-02": newer,
    }));
    const base = { username: USER, fetcher, now: new Date("2024-03-20T12:00:00Z") };

    await syncGames(db, { ...base, corpusLimit: 2 });
    const firstPass = await analyseOutstanding();
    expect(firstPass).toHaveLength(2);

    // The limit goes up; sync reaches further back.
    const backfill = await syncGames(db, { ...base, corpusLimit: 5 });
    expect(backfill.stored).toBe(3);

    const secondPass = await analyseOutstanding();

    // Only the newly backfilled games were analysed — the two from the first
    // pass kept their results rather than being re-run.
    expect(secondPass).toHaveLength(3);
    for (const id of firstPass) expect(secondPass).not.toContain(id);
  });
});
