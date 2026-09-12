import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getUsername } from "@/settings/settings";
import { analyseAndStore, findGame } from "@/analysis/store";
import { disposeEngine, getEngine } from "@/engine/singleton";
import { EngineError } from "@/engine/uci-engine";

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
    const analysis = await analyseAndStore(db, game, engine);
    return NextResponse.json({
      status: "done",
      cached: false,
      moves: analysis.moves.length,
      depth: analysis.depth,
    });
  } catch (error) {
    if (error instanceof EngineError) {
      // The engine is in an unknown state; drop it so the next request gets a
      // fresh process rather than inheriting a broken one.
      disposeEngine();
      return NextResponse.json(
        {
          error: `${error.message} Is Stockfish installed? Try: brew install stockfish`,
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
