import { reclaimOnce, stopJob } from "@/analysis/job-singleton";

/**
 * Node-only startup work, kept out of `instrumentation.ts` so the edge build
 * never compiles these APIs at all. The runtime check there is what decides
 * whether this module is loaded.
 */
export function registerNode(): void {
  const reclaimed = reclaimOnce();
  if (reclaimed > 0) {
    console.log(
      `[chess-retro] reclaimed ${reclaimed} game(s) left running by a previous process`,
    );
  }

  // Stop engines on the way out, rather than orphaning Stockfish processes
  // that would sit holding memory until the machine is rebooted.
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    stopJob();
  };

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      shutdown();
      // One tick, so the kill signals sent to the engines are actually
      // delivered before this process goes away. Exiting in the same tick
      // leaves them orphaned — the thing this handler exists to prevent.
      setImmediate(() => process.exit(0));
    });
  }
  process.once("beforeExit", shutdown);
}
