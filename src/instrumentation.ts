/**
 * Server startup and shutdown.
 *
 * Next calls `register` once per server process, which is where reclaiming
 * crashed runs belongs: a game left `running` by a killed process must go back
 * to `pending` or it would never be analysed again.
 *
 * The work itself lives in a separate module loaded only under Node, because
 * Next compiles this file for the edge runtime too and would warn about every
 * process API it contains.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { registerNode } = await import("./instrumentation-node");
  registerNode();
}
