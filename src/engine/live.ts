import { UciEngine } from "./uci-engine";

/**
 * The engine behind the live analysis panel.
 *
 * Deliberately NOT the `getEngine()` singleton. That one is shared with
 * `/api/analyze/[id]`, and `analyse` calls are serialised per engine — so a
 * live search opened while a game was being analysed would sit in the queue
 * behind a search of every position in that game. The panel would show
 * nothing for minutes with no indication why.
 *
 * One process, on `globalThis` so Next's dev-mode hot reload reuses it rather
 * than leaking a Stockfish per module reevaluation.
 */
declare global {
  // eslint-disable-next-line no-var
  var __chessRetroLiveEngine: UciEngine | undefined;
}

export async function getLiveEngine(): Promise<UciEngine> {
  if (!globalThis.__chessRetroLiveEngine) {
    const engine = new UciEngine({
      // More than the one thread a batch worker gets: there is only ever one
      // live search, and it is the thing a person is actually waiting on.
      threads: 2,
      // A live search runs until the position changes, so the per-position
      // timeout that guards a stored analysis does not apply. What it still
      // guards is the handshake and the stop-drain.
      timeoutMs: 10_000,
    });
    await engine.start();
    globalThis.__chessRetroLiveEngine = engine;
  }
  return globalThis.__chessRetroLiveEngine;
}

/** Drop the live engine, so the next request starts a fresh one. */
export function disposeLiveEngine(): void {
  globalThis.__chessRetroLiveEngine?.dispose();
  globalThis.__chessRetroLiveEngine = undefined;
}
