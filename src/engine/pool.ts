import os from "node:os";
import { UciEngine, type EngineOptions } from "./uci-engine";
import type { Analyser } from "@/analysis/analyze-game";

/**
 * How many processes one position may be tried on before giving up.
 *
 * Two, not more: a transient wedge clears on a fresh process, while a position
 * that breaks every engine should fail fast rather than spawn Stockfish in a
 * loop for minutes.
 */
const ANALYSE_ATTEMPTS = 2;

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
    this.engine = this.makeEngine();
  }

  /** Overridable so tests can supply a fake instead of a real process. */
  protected makeEngine(): UciEngine {
    return new UciEngine(this.options);
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
    let lastError: unknown;

    // One extra go on a fresh process. The batch job's unit of work is a whole
    // game, so rethrowing on the first failure discards every position already
    // analysed — a timeout at ply 40 of a 60-ply game cost all 40. Retrying
    // once turns a transient wedge into a hiccup; a position that genuinely
    // breaks every engine still surfaces, after ATTEMPTS tries.
    for (let attempt = 0; attempt < ANALYSE_ATTEMPTS; attempt += 1) {
      try {
        return await this.engine.analyse(fen);
      } catch (cause) {
        lastError = cause;
        // The process is in an unknown state: it may have died, or be stuck
        // mid-search. Either way the next attempt deserves a clean one.
        await this.replace();
        // Nothing to retry onto, and shutdown must not wait for us.
        if (this.disposed) break;
      }
    }

    throw lastError;
  }

  dispose(): void {
    this.disposed = true;
    this.engine.dispose();
  }

  private async replace(): Promise<void> {
    if (this.disposed) return;
    this.engine.dispose();

    const replacement = this.makeEngine();
    this.engine = replacement;
    // A failure to start is left to surface on the next search rather than
    // thrown here, which would mask the original error.
    await replacement.start().catch(() => {});

    // dispose() may have run while that start was in flight. Without this the
    // replacement outlives the pool as an orphaned Stockfish process — the
    // very thing the shutdown handler exists to prevent.
    if (this.disposed) replacement.dispose();
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
