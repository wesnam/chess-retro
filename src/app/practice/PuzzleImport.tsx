"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ImportEvent } from "@/app/api/puzzles/import/route";

/**
 * Downloading the puzzle database, with progress.
 *
 * The file is 300MB and the import takes minutes, so this reads a stream of
 * newline-delimited JSON rather than awaiting one response: a button that
 * looks frozen for five minutes is one a person gives up on.
 */
export function PuzzleImport() {
  const router = useRouter();
  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "running"; imported: number; read: number }
    | { status: "error"; message: string }
  >({ status: "idle" });
  const [nearMyRating, setNearMyRating] = useState(true);

  async function start() {
    setState({ status: "running", imported: 0, read: 0 });

    try {
      const response = await fetch("/api/puzzles/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nearMyRating }),
      });

      if (!response.body) {
        setState({ status: "error", message: "The import returned nothing." });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      // Events are newline-delimited and a chunk can split one, so the tail is
      // carried forward rather than parsed as it stands.
      let buffered = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffered += decoder.decode(value, { stream: true });
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";

        for (const line of lines) {
          if (line.trim() === "") continue;
          const event = JSON.parse(line) as ImportEvent;

          if (event.type === "error") {
            setState({ status: "error", message: event.message });
            return;
          }

          setState({
            status: "running",
            imported: event.imported,
            read: event.read,
          });

          if (event.type === "done") {
            // The page renders the session once puzzles exist.
            router.refresh();
            return;
          }
        }
      }

      // The stream ended without saying it was done — the server went away
      // mid-import. Whatever was committed is still there, so the page is
      // refreshed rather than left showing progress that has stopped moving.
      setState({
        status: "error",
        message: "The import stopped before it finished. Any puzzles already stored were kept.",
      });
      router.refresh();
    } catch (cause) {
      setState({
        status: "error",
        message:
          cause instanceof Error ? cause.message : "Could not reach the server.",
      });
    }
  }

  if (state.status === "running") {
    return (
      <div className="card">
        <h2>Importing puzzles</h2>
        <p>
          {state.imported.toLocaleString()} puzzles stored, from{" "}
          {state.read.toLocaleString()} read.
        </p>
        <p className="hint">
          This runs once. Afterwards practice works with no network at all.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Puzzles are not downloaded yet</h2>
      <p>
        Practice uses the{" "}
        <a href="https://database.lichess.org/#puzzles">
          Lichess puzzle database
        </a>
        , a public-domain set of several million rated, theme-tagged positions.
        It downloads once and is then used offline.
      </p>

      <label className="field">
        <input
          type="checkbox"
          checked={nearMyRating}
          onChange={(event) => setNearMyRating(event.target.checked)}
        />{" "}
        Only puzzles near my rating
        <span className="hint">
          Stores a fraction of the database. Puzzles far above or below your
          rating are never served anyway — this skips storing them.
        </span>
      </label>

      <button type="button" onClick={start}>
        Download puzzles
      </button>

      {state.status === "error" && (
        <p className="notice error">{state.message}</p>
      )}
    </div>
  );
}
