import { UciEngine } from "./uci-engine";

/**
 * One long-lived engine process for the whole server.
 *
 * Stashed on `globalThis` so Next's dev-mode hot reload reuses it rather than
 * spawning a new Stockfish on every module reevaluation — which would leak
 * processes until the machine crawled.
 *
 * Ticket 06 replaces this with a pool of engines for batch work; a single
 * engine is enough to review one game on demand.
 */
declare global {
  // eslint-disable-next-line no-var
  var __chessRetroEngine: UciEngine | undefined;
}

export async function getEngine(): Promise<UciEngine> {
  if (!globalThis.__chessRetroEngine) {
    const engine = new UciEngine();
    await engine.start();
    globalThis.__chessRetroEngine = engine;
  }
  return globalThis.__chessRetroEngine;
}

/** Drop the shared engine, so the next request starts a fresh one. */
export function disposeEngine(): void {
  globalThis.__chessRetroEngine?.dispose();
  globalThis.__chessRetroEngine = undefined;
}
