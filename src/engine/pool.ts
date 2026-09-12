import os from "node:os";
import { UciEngine, type EngineOptions } from "./uci-engine";
import type { Analyser } from "@/analysis/analyze-game";

/**
 * A set of engine processes for batch work.
 *
 * Each engine is single-threaded on purpose: N independent single-threaded
 * searches finish a corpus faster than one N-threaded search, because the
 * positions are unrelated and Stockfish's parallel search scales poorly
 * compared to simply running more of them.
 *
 * One core is left free so the machine stays usable while a job runs.
 */
export function poolSize(cores = os.cpus().length): number {
  return Math.max(1, cores - 1);
}

/**
 * An engine that replaces its process when it dies.
 *
 * A crashed or wedged engine must not end an eight-hour run, so a failed
 * search restarts the process and the game is retried by the job's normal
 * error path rather than taking the whole pool down.
 */
export class ResilientEngine implements Analyser {
  private engine: UciEngine;
  private disposed = false;

  constructor(private readonly options: EngineOptions = {}) {
    this.engine = new UciEngine(options);
  }

  get depth(): number {
    return this.engine.depth;
  }

  async start(): Promise<void> {
    await this.engine.start();
  }

  async newGame(): Promise<void> {
    try {
      await this.engine.newGame();
    } catch (cause) {
      await this.replace();
      throw cause;
    }
  }

  async analyse(fen: string) {
    try {
      return await this.engine.analyse(fen);
    } catch (cause) {
      // The process is in an unknown state: it may have died, or be stuck
      // mid-search. Either way the next game deserves a clean one.
      await this.replace();
      throw cause;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.engine.dispose();
  }

  private async replace(): Promise<void> {
    if (this.disposed) return;
    this.engine.dispose();
    this.engine = new UciEngine(this.options);
    // A failure to start is left to surface on the next search rather than
    // thrown here, which would mask the original error.
    await this.engine.start().catch(() => {});
  }
}

/** Start `size` engines, ready for a job. */
export async function startPool(
  size: number,
  options: EngineOptions = {},
): Promise<ResilientEngine[]> {
  const engines = Array.from(
    { length: size },
    () => new ResilientEngine({ ...options, threads: 1 }),
  );

  try {
    await Promise.all(engines.map((engine) => engine.start()));
  } catch (cause) {
    // Don't leak the ones that did start.
    for (const engine of engines) engine.dispose();
    throw cause;
  }

  return engines;
}
