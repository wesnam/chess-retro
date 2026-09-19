"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AnalyzeButton({
  gameId,
  label = "Analyze game",
}: {
  gameId: string;
  label?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function analyze() {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/analyze/${gameId}`, { method: "POST" });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(data.error ?? "Analysis failed.");
        return;
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sync-bar">
      <button onClick={analyze} disabled={busy}>
        {busy ? (
          <>
            {/* aria-hidden: the button's own text already says "Analyzing". */}
            <span className="spinner" aria-hidden="true" /> Analyzing…
          </>
        ) : (
          label
        )}
      </button>
      {busy && (
        <span className="sync-message">
          Stockfish is evaluating every position — this takes a moment.
        </span>
      )}
      {error && <span className="sync-message error">{error}</span>}
    </div>
  );
}
