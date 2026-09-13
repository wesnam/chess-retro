import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getDb } from "@/db/client";
import { asLiveRun } from "@/analysis/batch";
import { tagGame } from "@/analysis/motifs/tag";
import { getUsername } from "@/settings/settings";
import { AlreadyRunningError, analyseAndStore, findGame } from "@/analysis/store";
import { disposeEngine, getEngine } from "@/engine/singleton";
import { EngineError } from "@/engine/uci-engine";
import { engineErrorMessage } from "@/engine/engine-message";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = getDb();
  const username = getUsername(db);

  if (!username) {
    return NextResponse.json(
      { error: "No chess.com username configured yet." },
      { status: 400 },
    );
  }

  const game = findGame(db, username, id);
  if (!game) {
    return NextResponse.json({ error: "No such game." }, { status: 404 });
  }

  // Already analysed: reopening costs nothing, which is the point of storing
  // the evaluations rather than recomputing them.
  if (game.analysisStatus === "done") {
    return NextResponse.json({ status: "done", cached: true });
  }

  try {
    const engine = await getEngine();
    // Registered as live for the duration, so a reclaim running meanwhile
    // cannot take this game and hand it to a batch worker as well.
    const owner = randomUUID();
    const analysis = await asLiveRun(owner, () =>
      analyseAndStore(db, game, engine, { owner }),
    );

    // Tag immediately, so the review page can show what was missed rather
    // than waiting for a corpus-wide pass. No engine time involved.
    try {
      tagGame(db, username, id, game.timeClass);
    } catch {
      // Tags are derived data; a failure must not fail the analysis.
    }
    return NextResponse.json({
      status: "done",
      cached: false,
      moves: analysis.moves.length,
      depth: analysis.depth,
    });
  } catch (error) {
    if (error instanceof AlreadyRunningError) {
      return NextResponse.json(
        { status: "running", error: "This game is already being analysed." },
        { status: 409 },
      );
    }

    if (error instanceof EngineError) {
      // The engine is in an unknown state; drop it so the next request gets a
      // fresh process rather than inheriting a broken one.
      disposeEngine();
      return NextResponse.json(
        {
          error: engineErrorMessage(error.message),
        },
        { status: 503 },
      );
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Analysis failed.",
      },
      { status: 500 },
    );
  }
}
