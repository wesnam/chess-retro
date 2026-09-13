/**
 * Deciding what the coaching panel settles on.
 *
 * Pulled out of the component because the no-key path runs through here and
 * it is the one that must not be got wrong: running without an API key is a
 * supported way to use this app, not a degraded one, so the panel has to end
 * somewhere honest rather than on the spinner it starts on.
 *
 * `/api/coach` reports "there is no coach" in the body of a 200 rather than by
 * failing — a missing enhancement is not an error worth interrupting a page
 * that already has its statistics — so every decision here is made from a
 * successful response, and "no coaching" and "coaching for another control"
 * both have to land on `unavailable`.
 */

export type Coaching = {
  weaknesses: { key: string; explanation: string; why: string }[];
  practice?: { summary: string; themes: string[] };
};

export type CoachResponse = {
  /** Which control the server actually coached; may differ from the request. */
  timeClass: string;
  coaching: Coaching | null;
  cached?: boolean;
  reason: string | null;
};

export type CoachingState = {
  byKey: Map<string, { explanation: string; why: string }>;
  practice?: Coaching["practice"];
  status: "loading" | "ready" | "unavailable";
};

/** Nothing to show: the statistics stand on their own. */
export function unavailable(): CoachingState {
  return { byKey: new Map(), status: "unavailable" };
}

/**
 * What the panel becomes once the server has answered.
 *
 * Never returns `loading` — the caller is holding a response, so leaving the
 * panel on "Writing your coaching…" would be a spinner that never resolves.
 */
export function nextCoachingState(
  body: CoachResponse,
  timeClass: string,
): CoachingState {
  // Coaching for another control is worse than none: the numbers on screen
  // would be rapid while the prose described blitz.
  if (!body.coaching || body.timeClass !== timeClass) return unavailable();

  return {
    byKey: new Map(
      body.coaching.weaknesses.map((w) => [
        w.key,
        { explanation: w.explanation, why: w.why },
      ]),
    ),
    practice: body.coaching.practice,
    status: "ready",
  };
}
