/**
 * Which model writes the coaching prose.
 *
 * Sonnet 5 rather than Opus 5, which this was built on. The job is to rephrase
 * statistics that deterministic code has already computed — the model never
 * discovers a weakness, and `validate.ts` drops any claim the request does not
 * support — so the reasoning headroom of a larger model buys little here.
 * Measured on the real corpus, Sonnet matched Opus on every gate that matters
 * (weakness ids copied verbatim, practice themes inside the data, every example
 * cited as supplied, no invented figures) at roughly a third of the cost and
 * about half the latency.
 *
 * One caveat worth keeping: Opus handled an UNDERSPECIFIED payload better. When
 * examples carried only a raw `ply`, Opus inferred the move-number convention
 * and Sonnet quoted the ply — a citation past the end of the game. The payload
 * now supplies `moveNumber` and a sided `move` string so neither has to guess,
 * but the lesson generalises: this model is a better fit for a prompt that
 * leaves nothing to infer. Anything added to the request should be explicit.
 */
export const DEFAULT_MODEL = "claude-sonnet-5";

/**
 * The model to use, honouring an override.
 *
 * Overridable from the environment because the choice above is a judgement
 * rather than a fact, and someone who disagrees — or who wants Opus for a
 * corpus where the prose matters more than the cost — should not have to edit
 * source to say so. The cache is keyed on the model, so switching invalidates
 * rather than serving the other one's prose.
 */
export function resolveModel(override: string | undefined): string {
  const trimmed = override?.trim();
  return trimmed ? trimmed : DEFAULT_MODEL;
}
