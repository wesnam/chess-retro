import type { SyncResult } from "./sync";

/** The parts of a sync result that decide what to tell someone. */
type Outcome = Pick<SyncResult, "stored" | "skipped" | "monthsFetched">;

/**
 * What to say when a sync returns.
 *
 * Anything other than new games is "already up to date", and that has to be
 * decided on `stored` alone. The tempting reading — nothing stored but
 * something skipped — quietly breaks on the incremental path: a complete month
 * is never requested, so a corpus that is genuinely current comes back with
 * `stored` AND `skipped` both zero, and the fallback would report "Downloaded 0
 * new games" for the commonest sync there is.
 */
export function syncOutcomeMessage({ stored }: Outcome): string {
  if (stored === 0) return "Already up to date.";
  return `Downloaded ${stored} new game${stored === 1 ? "" : "s"}.`;
}
