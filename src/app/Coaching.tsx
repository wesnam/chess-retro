"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motifLabel } from "@/analysis/motifs/labels";
import {
  nextCoachingState,
  unavailable,
  type CoachResponse,
  type CoachingState,
} from "./coaching-state";
import { readDismissed, rememberDismissed, shouldOfferCoaching } from "./coach-hint";

/**
 * The coach's prose, fetched after the statistics are already on screen.
 *
 * The first request for a corpus waits on a model; every later one is served
 * from cache. Nothing here is load-bearing — when there is no API key, or the
 * call fails, the dashboard is still the ranked statistics it was before.
 */

export type { CoachingState } from "./coaching-state";

export function useCoaching(timeClass: string): CoachingState {
  const [state, setState] = useState<CoachingState>({
    byKey: new Map(),
    status: "loading",
  });

  useEffect(() => {
    let current = true;
    setState({ byKey: new Map(), status: "loading" });

    void (async () => {
      try {
        const response = await fetch(
          `/api/coach?tc=${encodeURIComponent(timeClass)}`,
        );
        const body = (await response.json()) as CoachResponse;
        if (!current) return;

        // Always settles: `nextCoachingState` never returns `loading`, so the
        // panel cannot be left on "Writing your coaching…" — which is what a
        // reader with no API key would otherwise stare at for ever.
        setState(nextCoachingState(body, timeClass));
      } catch {
        // The statistics are already rendered; a failed coach is a missing
        // enhancement, not an error worth interrupting the page for.
        if (current) setState(unavailable());
      }
    })();

    return () => {
      current = false;
    };
  }, [timeClass]);

  return state;
}

export function CoachNote({
  coaching,
  weaknessKey,
}: {
  coaching: CoachingState;
  weaknessKey: string;
}) {
  if (coaching.status === "loading") {
    return <p className="coach-note pending">Writing your coaching…</p>;
  }

  const note = coaching.byKey.get(weaknessKey);
  if (!note) return null;

  return (
    <div className="coach-note">
      <p>{note.explanation}</p>
      <p className="coach-why">
        <strong>Why this happens:</strong> {note.why}
      </p>
    </div>
  );
}

/**
 * The coach's practice plan, with each theme linking through to puzzles.
 *
 * Every theme here has already passed both gates in `validate.ts` — a motif a
 * detector can emit AND one this player was measured on — so each is a theme
 * the puzzle lookup will find material for.
 */
export function PracticePlan({
  coaching,
  timeClass,
}: {
  coaching: CoachingState;
  timeClass: string;
}) {
  if (coaching.status !== "ready" || !coaching.practice) return null;

  return (
    <div className="card practice">
      <h2>What to practise</h2>
      <p>{coaching.practice.summary}</p>
      {coaching.practice.themes.length > 0 && (
        <ul className="practice-themes">
          {coaching.practice.themes.map((theme) => (
            <li key={theme}>
              <Link
                href={`/practice?theme=${encodeURIComponent(theme)}&tc=${encodeURIComponent(timeClass)}`}
                className="tag practice-tag"
              >
                {motifLabel(theme)}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * One line telling a reader that written coaching exists.
 *
 * Shown only once a ranking is on screen with no coaching beside it, which is
 * the state where the feature is otherwise undiscoverable: both components
 * above render null without a key, so nothing on the page suggests there is
 * anything to turn on. Dismissible, and remembered — this is a page people
 * open every day.
 */
export function CoachOffer({
  coaching,
  hasWeaknesses,
}: {
  coaching: CoachingState;
  hasWeaknesses: boolean;
}) {
  // Starts dismissed so the hint cannot flash before the browser has been
  // asked: the server renders this too, and it has no localStorage.
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(readDismissed());
  }, []);

  if (!shouldOfferCoaching({ status: coaching.status, hasWeaknesses, dismissed })) {
    return null;
  }

  return (
    <p className="coach-offer">
      <span>
        Want these explained in words? Setting an{" "}
        <code>ANTHROPIC_API_KEY</code> adds a short written paragraph to each
        weakness — about 5¢ per ranking, and the dashboard works exactly as it
        does now without one.
      </span>
      <button
        type="button"
        onClick={() => {
          rememberDismissed();
          setDismissed(true);
        }}
        aria-label="Dismiss"
      >
        ×
      </button>
    </p>
  );
}
