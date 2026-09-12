import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getCorpusLimit, getUsername } from "@/settings/settings";
import { ChesscomError } from "@/ingest/chesscom";
import { syncGames } from "@/ingest/sync";

export const dynamic = "force-dynamic";

export async function POST() {
  const db = getDb();
  const username = getUsername(db);

  if (!username) {
    return NextResponse.json(
      { error: "No chess.com username configured yet." },
      { status: 400 },
    );
  }

  try {
    const result = await syncGames(db, {
      username,
      corpusLimit: getCorpusLimit(db),
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ChesscomError) {
      // 404 means the username is wrong, which is the caller's problem.
      const status = error.status === 404 ? 400 : 502;
      return NextResponse.json({ error: error.message }, { status });
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Sync failed unexpectedly.",
      },
      { status: 500 },
    );
  }
}
