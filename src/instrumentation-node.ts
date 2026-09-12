import { reclaimOnce, stopJob } from "@/analysis/job-singleton";
import { getDb } from "@/db/client";
import { importOpenings } from "@/ingest/openings";

/**
 * Node-only startup work, kept out of `instrumentation.ts` so the edge build
 * never compiles these APIs at all. The runtime check there is what decides
 * whether this module is loaded.
 */
export function registerNode(): void {
  // The opening dataset is bundled, so this is a local file read into SQLite.
  // Done at startup rather than on demand, so the first sync already has
  // names to assign and no request pays for the import.
  try {
    importOpenings(getDb());
  } catch (error) {
    // Opening names are a label, not a dependency: the app is fully usable
    // without them, and failing to boot over one would be far worse.
    console.warn("[chess-retro] could not import opening names:", error);
  }

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
