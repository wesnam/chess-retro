/**
 * What to say when a sync returns.
 *
 * Takes the stored count alone, because that is the whole rule. The tempting
 * reading — nothing stored but something skipped — quietly breaks on the
 * incremental path: a complete month is never requested, so a corpus that is
 * genuinely current comes back with `stored` AND `skipped` both zero, and the
 * fallback would report "Downloaded 0 new games" for the commonest sync there
 * is. Narrowing the parameter is what makes that mistake unspellable here.
 */
export function syncOutcomeMessage(stored: number): string {
  if (stored === 0) return "Already up to date.";
  return `Downloaded ${stored} new game${stored === 1 ? "" : "s"}.`;
}
