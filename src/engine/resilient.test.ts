import { describe, it, expect } from "vitest";
import { ResilientEngine } from "./pool";
import type { UciEngine } from "./uci-engine";

/**
 * One slow position must not cost a whole game.
 *
 * A game of 60 plies is 61 searches, and the batch job treats the game as the
 * unit of work — so a single timeout at ply 40 threw away the 39 positions
 * already analysed and marked the game `error`. On a corpus of beginner games,
 * which reach long sparse endgames, that lost 7 games in 40.
 */

type Outcome = "ok" | "throw";

/** A fake engine whose per-call behaviour the test dictates. */
function fakeEngine(outcomes: Outcome[]) {
  const calls: string[] = [];
  let index = 0;
  let starts = 0;

  const engine = {
    depth: 18,
    calls,
    get starts() {
      return starts;
    },
    async start() {
      starts += 1;
    },
    async newGame() {},
    async analyse(fen: string) {
      calls.push(fen);
      const outcome = outcomes[index++] ?? "ok";
      if (outcome === "throw") throw new Error("Engine did not respond");
      return {
        bestMove: "e2e4",
        score: { kind: "cp" as const, cp: 12 },
        depth: 18,
      };
    },
    dispose() {},
  };

  return engine as unknown as UciEngine & { calls: string[]; starts: number };
}

/** A ResilientEngine wired to fakes instead of real Stockfish processes. */
function resilientOver(engines: ReturnType<typeof fakeEngine>[]) {
  let next = 0;
  const resilient = new ResilientEngine({});
  // Replace the process factory so `replace()` hands out the next fake.
  (resilient as unknown as { engine: UciEngine }).engine = engines[next++]!;
  (resilient as unknown as { makeEngine: () => UciEngine }).makeEngine = () =>
    engines[next++] ?? fakeEngine([]);
  return resilient;
}

describe("ResilientEngine", () => {
  it("retries a failed position on the replacement process", () => {
    // Without the retry the caller sees the error and the batch job discards
    // the whole game — tens of positions of engine time for one bad search.
    const broken = fakeEngine(["throw"]);
    const healthy = fakeEngine(["ok"]);
    const engine = resilientOver([broken, healthy]);

    return expect(engine.analyse("some-fen")).resolves.toMatchObject({
      bestMove: "e2e4",
    });
  });

  it("gives up rather than retrying forever", async () => {
    // A position that genuinely wedges every engine must surface as a failure,
    // not spawn processes in a loop.
    const engines = Array.from({ length: 5 }, () => fakeEngine(["throw"]));
    const engine = resilientOver(engines);

    await expect(engine.analyse("cursed-fen")).rejects.toThrow();
  });

  it("does not retry after the pool has been disposed", async () => {
    // Shutdown must not be delayed by retries against a pool that is going
    // away, nor spawn a replacement that outlives it.
    const broken = fakeEngine(["throw"]);
    const engine = resilientOver([broken, fakeEngine(["ok"])]);
    engine.dispose();

    await expect(engine.analyse("some-fen")).rejects.toThrow();
  });
});
