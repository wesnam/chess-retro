import type { CoachingState } from "./coaching-state";

/**
 * Whether to mention that written coaching exists.
 *
 * Without a key both coaching components render null, so the feature is
 * invisible to precisely the people who have not opted into it — there is no
 * way to discover it from the app at all. One dismissible line fixes that
 * without turning a dashboard people open daily into an advertisement.
 *
 * Three conditions, and each one is doing work. It waits for the request to
 * settle, or the hint flashes on every load before the answer arrives —
 * including for people who already have a key. It requires a ranking on
 * screen, because coaching explains findings and there is nothing to explain
 * on an empty dashboard. And it is remembered as dismissed, because a reader
 * who has said no should not be asked again tomorrow.
 */

/** Where the dismissal is remembered. Per-browser; nothing leaves the machine. */
export const DISMISSED_KEY = "chess-retro.coach-hint-dismissed";

export function shouldOfferCoaching(context: {
  status: CoachingState["status"];
  hasWeaknesses: boolean;
  dismissed: boolean;
}): boolean {
  if (context.dismissed) return false;
  if (context.status !== "unavailable") return false;
  return context.hasWeaknesses;
}

/**
 * Read the dismissal, treating any storage failure as "not dismissed".
 *
 * `localStorage` throws in a private window and when site data is blocked, and
 * this is a hint — failing to read it must show the hint, never break the page.
 */
export function readDismissed(): boolean {
  try {
    return globalThis.localStorage?.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberDismissed(): void {
  try {
    globalThis.localStorage?.setItem(DISMISSED_KEY, "1");
  } catch {
    // A hint that cannot remember being dismissed is a small annoyance; a
    // dashboard that throws on a storage failure is not.
  }
}
