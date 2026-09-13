import { NextResponse } from "next/server";
import { disposeLiveEngine, getLiveEngine } from "@/engine/live";
import { EngineError, type LiveInfo } from "@/engine/uci-engine";
import { engineErrorMessage } from "@/engine/engine-message";
import { readLiveRequest } from "@/games/live-request";

/**
 * Live analysis of one position.
 *
 * The engine deepens for as long as anyone is watching, so the response is a
 * stream of newline-delimited JSON rather than one object at the end — the
 * same shape the puzzle import uses. A depth-18 answer delivered in silence
 * after four seconds is not live analysis; it is `analyse` with extra steps.
 *
 * The stream ends when the client goes away, and that disconnect is what
 * stops the search. Nothing else does: `go infinite` runs until told.
 */
export const dynamic = "force-dynamic";

export type LiveEvent =
  | ({ type: "info" } & LiveInfo)
  | { type: "error"; message: string };

/**
 * How long one live search may run before it is stopped regardless.
 *
 * Ten minutes is far longer than anyone stares at one position, so in normal
 * use the client's own disconnect always gets there first. This exists only so
 * a disconnect that never arrives costs one search instead of every one after
 * it — the engine is shared, and a search nobody can stop holds it forever.
 */
const MAX_SEARCH_MS = 10 * 60_000;

export async function POST(request: Request) {
  const parsed = readLiveRequest(
    await request.json().catch(() => null),
  );

  if (!parsed) {
    return NextResponse.json(
      { error: "That is not a position I can analyse." },
      { status: 400 },
    );
  }

  const encoder = new TextEncoder();
  // Aborted when the client disconnects, which is what ends the search.
  const search = new AbortController();

  // Navigating away, stepping to the next move, or closing the tab all land
  // here. Without it the engine would search a position nobody is looking at
  // until the process was restarted.
  request.signal.addEventListener("abort", () => search.abort(), {
    once: true,
  });

  /**
   * A ceiling, so a disconnect that is never reported cannot wedge the feature.
   *
   * The design ends a search when the client goes away, and that is the right
   * rule — but it rests entirely on the disconnect being observed. If neither
   * `request.signal` nor the stream's `cancel` fires, `go infinite` would run
   * forever with nobody reading it. Far past any honest think time, so a
   * reader who leaves the panel open loses nothing; short enough that a missed
   * abort costs one search rather than every search after it.
   */
  const ceiling = setTimeout(() => search.abort(), MAX_SEARCH_MS);
  search.signal.addEventListener("abort", () => clearTimeout(ceiling), {
    once: true,
  });

  const stream = new ReadableStream({
    async start(controller) {
      // Tolerates a closed stream, as the import route does: once the client
      // is gone every enqueue throws, and that is the normal way this ends
      // rather than an error worth propagating.
      let listening = true;
      const send = (event: LiveEvent) => {
        if (!listening) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          listening = false;
          search.abort();
        }
      };

      try {
        const engine = await getLiveEngine();
        await engine.analyseLive(parsed.fen, {
          signal: search.signal,
          onInfo: (info) => send({ type: "info", ...info }),
        });
      } catch (error) {
        if (error instanceof EngineError) {
          // The engine is in an unknown state; drop it so the next position
          // gets a fresh process rather than inheriting a broken one.
          disposeLiveEngine();
        }
        send({
          type: "error",
          message:
            error instanceof EngineError
              ? engineErrorMessage(error.message)
              : "Live analysis failed.",
        });
      } finally {
        try {
          controller.close();
        } catch {
          // Already gone.
        }
      }
    },
    cancel() {
      // The reader was released without the request aborting — belt and
      // braces for the same thing.
      search.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson",
      // Live is the point; a buffered response defeats it entirely.
      "cache-control": "no-store, no-transform",
    },
  });
}
