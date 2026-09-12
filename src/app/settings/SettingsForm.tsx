"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { saveSettings, type SettingsFormState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save"}
    </button>
  );
}

export function SettingsForm({
  username,
  corpusLimit,
}: {
  username: string;
  corpusLimit: number;
}) {
  const [state, formAction] = useActionState<SettingsFormState, FormData>(
    saveSettings,
    { status: "idle" },
  );

  return (
    <form action={formAction} className="card">
      {state.status !== "idle" && state.message && (
        <p
          className={`notice ${state.status === "ok" ? "ok" : "error"}`}
          role="status"
        >
          {state.message}
        </p>
      )}

      <label className="field">
        <span>chess.com username</span>
        <input
          name="username"
          defaultValue={username}
          placeholder="e.g. hikaru"
          autoComplete="off"
          spellCheck={false}
          required
        />
        <p className="hint">
          Case does not matter. Games are kept separate per username, so
          changing this never blends two accounts together.
        </p>
      </label>

      <label className="field">
        <span>Games to analyse</span>
        <input
          name="corpusLimit"
          type="number"
          min={1}
          step={1}
          defaultValue={corpusLimit}
        />
        <p className="hint">
          How far back to reach. More games give a stronger signal but a longer
          first analysis run.
        </p>
      </label>

      <SubmitButton />
    </form>
  );
}
