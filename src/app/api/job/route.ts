import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getUsername } from "@/settings/settings";
import { jobState, pauseJob, startJob, stopJob } from "@/analysis/job-singleton";
import { EngineError } from "@/engine/uci-engine";

export const dynamic = "force-dynamic";

function requireUsername(): string | NextResponse {
  const username = getUsername(getDb());
  if (!username) {
    return NextResponse.json(
      { error: "No chess.com username configured yet." },
      { status: 400 },
    );
  }
  return username;
}

/** Current progress, polled by the UI while a run is going. */
export async function GET() {
  const username = requireUsername();
  if (typeof username !== "string") return username;

  return NextResponse.json(jobState(username));
}

/** Start, pause or stop the run. */
export async function POST(request: Request) {
  const username = requireUsername();
  if (typeof username !== "string") return username;

  const { action } = (await request.json().catch(() => ({}))) as {
    action?: string;
  };

  try {
    if (action === "pause") return NextResponse.json(pauseJob(username));

    if (action === "stop") {
      stopJob();
      return NextResponse.json(jobState(username));
    }

    return NextResponse.json(await startJob(username));
  } catch (error) {
    if (error instanceof EngineError) {
      return NextResponse.json(
        {
          error: `${error.message} Is Stockfish installed? Try: brew install stockfish`,
        },
        { status: 503 },
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not start analysis." },
      { status: 500 },
    );
  }
}
