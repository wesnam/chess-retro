/**
 * Turning a rate and an ETA into something worth reading at 1am, when the
 * question is only ever "can I go to bed yet".
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return "—";
  if (ms < MINUTE) return "under a minute";

  if (ms < HOUR) return `${Math.round(ms / MINUTE)} min`;

  const hours = Math.floor(ms / HOUR);
  const minutes = Math.round((ms % HOUR) / MINUTE);
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

/** Games per millisecond, rendered in whichever unit reads naturally. */
export function formatRate(ratePerMs: number | undefined): string {
  if (ratePerMs === undefined || !Number.isFinite(ratePerMs) || ratePerMs <= 0) {
    return "—";
  }

  const perMinute = ratePerMs * MINUTE;
  // Below one a minute the number becomes a decimal that says little; per
  // hour is the honest unit for a deep-analysis run.
  if (perMinute < 1) return `${Math.round(ratePerMs * HOUR)} games/hr`;

  return `${perMinute.toFixed(1)} games/min`;
}
