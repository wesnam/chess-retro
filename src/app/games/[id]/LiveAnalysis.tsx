"use client";

import { useEffect, useState } from "react";
import type { LiveEvent } from "@/app/api/live/route";
import {
  applyInfo,
  emptyLive,
  formatLiveScore,
  liveArrow,
  principalVariationSan,
  numberVariation,
  type LiveAnalysis as Live,
} from "@/games/live-analysis";

/**
 * How long the position must hold still before the engine is asked about it.
 *
 * Long enough to swallow a held arrow key, short enough that stopping on a
 * position feels like the engine answered immediately.
 */
const SETTLE_MS = 150;

export type LiveState =
  | { status: "off" }
  | { status: "thinking"; live: Live }
  | { status: "error"; message: string };

/**
 * Watch the engine think about one position.
 *
 * The search is keyed to the FEN: changing position aborts the old request,
 * and the abort is what stops the engine — so stepping through a game leaves
 * exactly one search running, on the position being looked at.
 */
export function useLiveAnalysis(fen: string, enabled: boolean): LiveState {
  const [state, setState] = useState<LiveState>({ status: "off" });

  useEffect(() => {
    if (!enabled) {
      setState({ status: "off" });
      return;
    }

    const controller = new AbortController();
    // Reset to an empty search rather than leaving the previous position's
    // numbers up: a stale +3.4 beside a new position is worse than a blank.
    setState({ status: "thinking", live: emptyLive() });

    /**
     * Wait out a fast stepper before asking the engine anything.
     *
     * Holding the right arrow through a sixty-move game changes `fen` sixty
     * times. Without this that is sixty requests, each starting a search and
     * stopping it again, and the engine spends the run being interrupted
     * rather than analysing. Short enough to feel immediate once someone
     * actually stops on a position.
     */
    const settling = setTimeout(() => void run(), SETTLE_MS);

    async function run() {
      try {
        const response = await fetch("/api/live", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ fen }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          setState({
            status: "error",
            message: "The engine could not be reached.",
          });
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        // Events are newline-delimited and a chunk can split one, so the tail
        // is carried forward rather than parsed as it stands.
        let buffered = "";
        let live = emptyLive();

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          buffered += decoder.decode(value, { stream: true });
          const lines = buffered.split("\n");
          buffered = lines.pop() ?? "";

          for (const line of lines) {
            if (line.trim() === "") continue;
            const event = JSON.parse(line) as LiveEvent;

            if (event.type === "error") {
              setState({ status: "error", message: event.message });
              // Released rather than abandoned: returning straight out would
              // leave the body unread and the connection open until the abort
              // on cleanup got round to it.
              await reader.cancel().catch(() => {});
              return;
            }

            live = applyInfo(live, event);
            setState({ status: "thinking", live });
          }
        }
      } catch (cause) {
        // An abort is how this normally ends — the position changed, or the
        // panel was switched off. Reporting it as a failure would flash an
        // error on every single step through the game.
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          message:
            cause instanceof Error ? cause.message : "Live analysis stopped.",
        });
      }
    }

    return () => {
      // Both halves matter: the timer, so a search that has not started yet
      // never does, and the abort, which closes the response body — the
      // server reads that as a disconnect and turns it into `stop` on the
      // engine. Nothing else ends a search.
      clearTimeout(settling);
      controller.abort();
    };
  }, [fen, enabled]);

  return state;
}

/** The arrow the live search is currently suggesting. */
export function liveMoveArrow(state: LiveState) {
  return state.status === "thinking" ? liveArrow(state.live) : undefined;
}

export function LiveAnalysisPanel({
  state,
  fen,
  enabled,
  onToggle,
}: {
  state: LiveState;
  fen: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <div className="live-panel">
      <label className="live-toggle">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => onToggle(event.target.checked)}
        />{" "}
        Engine analysis
      </label>

      {state.status === "error" && (
        <p className="notice error">{state.message}</p>
      )}

      {state.status === "thinking" && (
        <LiveReadout live={state.live} fen={fen} />
      )}
    </div>
  );
}

function LiveReadout({ live, fen }: { live: Live; fen: string }) {
  const san = principalVariationSan(fen, live.pv);

  if (live.depth === 0) {
    return <p className="live-waiting">Thinking…</p>;
  }

  return (
    <>
      <p className="live-head">
        <span className="live-score">{formatLiveScore(live.score, fen)}</span>
        <span className="live-depth">depth {live.depth}</span>
      </p>
      {san.length > 0 && (
        <p className="live-pv">{numberVariation(san, fen)}</p>
      )}
    </>
  );
}
