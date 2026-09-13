import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getUsername } from "@/settings/settings";
import { countGames } from "@/games/queries";
import { KNOWN_THEMES } from "@/insights/validate";
import { isImported, puzzleCount } from "@/puzzles/import";
import {
  playerRating,
  recordAttempt,
  selectPuzzles,
  themeProgress,
} from "@/puzzles/select";

/**
 * Puzzles for one theme, and the record of how they went.
 *
 * A route handler rather than a server action because the practice page pulls
 * a fresh set as it goes and posts each attempt as it happens — neither is a
 * form submission, and neither should re-render the page.
 */
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

/** A set of puzzles to solve. */
export async function GET(request: Request) {
  const username = requireUsername();
  if (typeof username !== "string") return username;

  const db = getDb();
  const params = new URL(request.url).searchParams;
  const theme = params.get("theme");

  // Checked against the detector vocabulary, not passed to the query as
  // given: the theme decides what is drilled, and an unknown one would
  // silently return an empty set that reads as "you have no weaknesses here".
  if (!theme || !KNOWN_THEMES.has(theme)) {
    return NextResponse.json({ error: "Unknown practice theme." }, { status: 400 });
  }

  if (!isImported(db)) {
    return NextResponse.json({
      puzzles: [],
      reason: "not-imported",
      imported: 0,
    });
  }

  const requested = params.get("tc");
  const available = countGames(db, username).byTimeClass;
  const timeClass =
    available.find((t) => t.timeClass === requested)?.timeClass ??
    available[0]?.timeClass;

  // Rating is per time control, so it can only be read once one is resolved.
  const rating = timeClass
    ? playerRating(db, { user: username, timeClass })
    : undefined;

  const puzzles = selectPuzzles(db, { user: username, theme, rating });

  return NextResponse.json({
    puzzles,
    theme,
    rating: rating ?? null,
    timeClass: timeClass ?? null,
    progress: themeProgress(db, { user: username, theme }),
    imported: puzzleCount(db),
  });
}

/** Record how an attempt went. */
export async function POST(request: Request) {
  const username = requireUsername();
  if (typeof username !== "string") return username;

  const body = (await request.json().catch(() => ({}))) as {
    puzzleId?: string;
    solved?: boolean;
    theme?: string;
  };

  if (!body.puzzleId || typeof body.solved !== "boolean") {
    return NextResponse.json(
      { error: "An attempt needs a puzzle and a result." },
      { status: 400 },
    );
  }

  const db = getDb();
  // The theme is what makes the attempt readable later, but a bad one must not
  // cost the record of the attempt itself.
  const theme =
    body.theme && KNOWN_THEMES.has(body.theme) ? body.theme : undefined;

  try {
    recordAttempt(db, {
      user: username,
      puzzleId: body.puzzleId,
      solved: body.solved,
      theme,
    });
  } catch (error) {
    // A foreign-key failure means the puzzle is not in this database — a
    // stale page after a re-import. Not worth interrupting practice over.
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not record the attempt.",
      },
      { status: 400 },
    );
  }

  return NextResponse.json({
    recorded: true,
    progress: theme ? themeProgress(db, { user: username, theme }) : null,
  });
}
