import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import {
  importPuzzles,
  isImported,
  puzzleCount,
  type ImportProgress,
} from "@/puzzles/import";
import { playerRating, RATING_BAND } from "@/puzzles/select";
import { getUsername } from "@/settings/settings";
import { countGames } from "@/games/queries";

/**
 * Downloading and importing the puzzle database.
 *
 * The work takes minutes, so the response is a stream of newline-delimited
 * JSON rather than one object at the end: the ticket asks for clear progress,
 * and a request that returns nothing for five minutes is indistinguishable
 * from one that has hung.
 */
export const dynamic = "force-dynamic";

/** How much of the database is being stored, in a phrase. */
export type ImportEvent =
  | ({ type: "progress" } & ImportProgress)
  | ({ type: "done" } & ImportProgress)
  | { type: "error"; message: string };

export async function GET() {
  const db = getDb();
  return NextResponse.json({
    imported: isImported(db),
    count: puzzleCount(db),
  });
}

export async function POST(request: Request) {
  const db = getDb();

  const body = (await request.json().catch(() => ({}))) as {
    force?: boolean;
    /** Import only puzzles near the player's own rating. */
    nearMyRating?: boolean;
  };

  // The footprint option, resolved here rather than in the importer: it needs
  // the player's rating, and the importer takes plain numbers so it stays
  // testable without a corpus.
  let minRating: number | undefined;
  let maxRating: number | undefined;

  if (body.nearMyRating) {
    const username = getUsername(db);
    const timeClass = username
      ? countGames(db, username).byTimeClass[0]?.timeClass
      : undefined;
    const rating =
      username && timeClass
        ? playerRating(db, { user: username, timeClass })
        : undefined;

    if (rating !== undefined) {
      // Wider than the band used to SERVE puzzles, so an improving player does
      // not walk out of their own import after a few hundred points.
      minRating = rating - RATING_BAND * 3;
      maxRating = rating + RATING_BAND * 3;
    }
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // Tolerates a closed stream. If the person navigates away mid-import
      // the controller throws on every enqueue, and letting that propagate
      // would abort an import that is otherwise fine — the rows already
      // committed stay, and the work in flight should finish rather than die
      // because nobody is watching.
      let listening = true;
      const send = (event: ImportEvent) => {
        if (!listening) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          listening = false;
        }
      };

      try {
        const result = await importPuzzles(db, {
          force: body.force,
          minRating,
          maxRating,
          onProgress: (progress) => send({ type: "progress", ...progress }),
        });
        send({ type: "done", ...result });
      } catch (error) {
        // Reported through the stream rather than as a status code: by the
        // time this fails the response has long since started.
        send({
          type: "error",
          message:
            error instanceof Error
              ? error.message
              : "Could not import the puzzle database.",
        });
      } finally {
        // Closing an already-closed stream throws, which would surface as an
        // unhandled rejection on a disconnect.
        try {
          controller.close();
        } catch {
          // Already gone.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson",
      // The progress is the point; a buffered response defeats it.
      "cache-control": "no-store, no-transform",
    },
  });
}
