"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDuration, formatRate } from "@/analysis/format-progress";

type JobState = {
  status: "idle" | "running" | "paused" | "done";
  total: number;
  completed: number;
  failed: number;
  remaining: number;
  ratePerMs?: number;
  etaMs?: number;
  pending: number;
  error?: string;
};

/** How often to ask for progress while a run is going. */
const POLL_MS = 1_500;

export function AnalyzeAllButton() {
  const router = useRouter();
  const [state, setState] = useState<JobState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Set when the run finishes, so the game list refreshes exactly once.
  const wasRunning = useRef(false);

  const poll = useCallback(async () => {
    try {
      const response = await fetch("/api/job");
      if (!response.ok) return;
      const next = (await response.json()) as JobState;
      setState(next);

      // The list behind this shows stale statuses once games finish. A pause
      // still leaves games in flight, so the refresh waits for them to stop
      // rather than firing the moment the button is pressed.
      const settling = next.status === "paused" && next.remaining > 0;
      if (wasRunning.current && next.status !== "running" && !settling) {
        wasRunning.current = false;
        router.refresh();
      }
      if (next.status === "running") wasRunning.current = true;
    } catch {
      // A failed poll is not worth reporting: the next one is 1.5s away.
    }
  }, [router]);

  useEffect(() => {
    void poll();
  }, [poll]);

  useEffect(() => {
    // Paused keeps polling too: `pause` only stops new games being taken, and
    // the ones already in flight go on completing for a while yet.
    if (state?.status !== "running" && state?.status !== "paused") return;
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(timer);
  }, [state?.status, poll]);

  async function send(action: "start" | "pause") {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await response.json()) as JobState;
      if (!response.ok) {
        setError(data.error ?? "Could not start analysis.");
        return;
      }
      setState(data);
      if (action === "start") wasRunning.current = true;
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not reach the server.",
      );
    } finally {
      setBusy(false);
    }
  }

  const running = state?.status === "running";
  const nothingToDo = state !== null && state.pending === 0 && !running;

  return (
    <div className="job-bar">
      <div className="job-actions">
        <button onClick={() => send("start")} disabled={busy || running || nothingToDo}>
          {running && <span className="spinner" aria-hidden="true" />}
          {running
            ? " Analyzing…"
            : state?.status === "paused"
              ? "Resume analysis"
              : "Analyze all games"}
        </button>
        {running && (
          <button onClick={() => send("pause")} disabled={busy}>
            Pause
          </button>
        )}
      </div>

      {state && (running || state.status === "paused") && (
        <JobProgress state={state} />
      )}

      {nothingToDo && state.completed === 0 && (
        <span className="sync-message">Every game is analyzed.</span>
      )}

      {error && <span className="sync-message error">{error}</span>}
    </div>
  );
}

function JobProgress({ state }: { state: JobState }) {
  const finished = state.completed + state.failed;
  const percent = state.total > 0 ? (finished / state.total) * 100 : 0;

  return (
    <div className="job-progress">
      <div
        className="job-bar-track"
        role="progressbar"
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Analysis progress"
      >
        <div className="job-bar-fill" style={{ width: `${percent}%` }} />
      </div>

      <div className="job-stats">
        <span>
          <strong>{finished}</strong> of {state.total}
        </span>
        <span className="muted">{formatRate(state.ratePerMs)}</span>
        <span className="muted">
          {state.status === "paused"
            ? "paused"
            : `${formatDuration(state.etaMs)} left`}
        </span>
        {state.failed > 0 && (
          <span className="job-failed">
            {state.failed} failed
          </span>
        )}
      </div>
    </div>
  );
}
