"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { syncOutcomeMessage } from "@/ingest/sync-message";

type SyncResponse = {
  stored?: number;
  skipped?: number;
  unusable?: number;
  error?: string;
};

export function SyncButton({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function sync() {
    setBusy(true);
    setMessage("Downloading games from chess.com…");
    setFailed(false);

    try {
      const response = await fetch("/api/sync", { method: "POST" });
      const data = (await response.json()) as SyncResponse;

      if (!response.ok) {
        setFailed(true);
        setMessage(data.error ?? "Sync failed.");
        return;
      }

      setMessage(syncOutcomeMessage(data.stored ?? 0));
      router.refresh();
    } catch (error) {
      setFailed(true);
      setMessage(
        error instanceof Error ? error.message : "Could not reach the server.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sync-bar">
      <button onClick={sync} disabled={busy || disabled}>
        {busy ? "Syncing…" : "Sync games"}
      </button>
      {message && (
        <span className={failed ? "sync-message error" : "sync-message"}>
          {message}
        </span>
      )}
    </div>
  );
}
