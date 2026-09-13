/**
 * Turning an engine failure into something a person can act on.
 *
 * Analysis is the only step that needs a dependency someone installs
 * themselves, so this message is effectively part of the setup instructions —
 * it is what a newcomer reads at the first wall they hit.
 *
 * Two things it has to get right. The missing-binary error already ends with
 * the install command, and the routes each appended their own copy, so the
 * advice arrived twice in one sentence. And "Is Stockfish installed?" is only
 * true of a binary that never started: an engine that answered and then timed
 * out is a different problem, and sending someone to reinstall it wastes their
 * time on the wrong one.
 */

const INSTALL_HINT = "Is Stockfish installed? Try: brew install stockfish";

/** Failures that mean the engine ran, so an install hint would mislead. */
const RAN_FINE = [
  "did not respond",
  "returned no evaluation",
  "is not running",
  "is not accepting commands",
  "stopped while waiting",
];

export function engineErrorMessage(message: string): string {
  if (RAN_FINE.some((phrase) => message.includes(phrase))) return message;
  // Already carries the command; saying it again helps nobody.
  if (message.includes("brew install stockfish")) return message;
  return `${message} ${INSTALL_HINT}`;
}
