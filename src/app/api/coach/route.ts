import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getUsername } from "@/settings/settings";
import { countGames } from "@/games/queries";
import { weaknessReport } from "@/weakness/report";
import { coachFromEnv } from "@/insights/anthropic";
import { coachingFor } from "@/insights/coach";
import { buildRequest } from "@/insights/request";

/**
 * The coaching for the currently selected time class.
 *
 * A route handler rather than part of the dashboard's server render: the
 * first call for a corpus waits on a model, and the statistics from ticket 08
 * must be on screen long before that returns. Cached calls come back at once.
 *
 * The API key is read here, on the server, and only the resulting prose is
 * sent to the browser.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const db = getDb();
  const username = getUsername(db);

  if (!username) {
    return NextResponse.json(
      { error: "No chess.com username configured yet." },
      { status: 400 },
    );
  }

  const requested = new URL(request.url).searchParams.get("tc");
  const available = countGames(db, username).byTimeClass;
  const timeClass =
    available.find((t) => t.timeClass === requested)?.timeClass ??
    available[0]?.timeClass;

  if (!timeClass) {
    return NextResponse.json({ error: "No games yet." }, { status: 400 });
  }

  const report = weaknessReport(db, { user: username, timeClass });
  if (report.weaknesses.length === 0) {
    return NextResponse.json({ coaching: null, reason: "nothing-to-explain" });
  }

  const result = await coachingFor(
    db,
    username,
    buildRequest(report),
    coachFromEnv(),
  );

  // The resolved time class is echoed back: an unknown `tc` falls back to the
  // player's most-played control, and without saying which one was used the
  // client would caption another control's coaching with the one it asked for.
  return NextResponse.json({
    timeClass,
    coaching: result.coaching ?? null,
    cached: result.cached,
    reason: result.reason ?? null,
  });
}
