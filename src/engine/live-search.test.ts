import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { fileURLToPath } from "node:url";
import { chmodSync } from "node:fs";
import { UciEngine, EngineError } from "./uci-engine";

/**
 * The live search, against a fake engine process.
 *
 * A real Stockfish would make these slow and flaky — the timings that matter
 * here are "does it stop when told" and "is the bestmove drained", neither of
 * which needs a real search. `uci-engine.slow.test.ts` covers the real thing.
 */

const FAKE = fileURLToPath(new URL("./fixtures/fake-uci.mjs", import.meta.url));

const engines: UciEngine[] = [];

// The fixture is spawned as a binary, the way a real engine is. Made
// executable here rather than relying on the mode surviving a clone, which is
// the sort of thing that fails on one machine and nowhere else.
beforeAll(() => chmodSync(FAKE, 0o755));

function fakeEngine(mode: "normal" | "silent" = "normal"): UciEngine {
  process.env.FAKE_UCI_MODE = mode;
  const engine = new UciEngine({ path: FAKE, timeoutMs: 3_000 });
  engines.push(engine);
  return engine;
}

afterEach(() => {
  for (const engine of engines.splice(0)) engine.dispose();
  delete process.env.FAKE_UCI_MODE;
});

describe("a live search", () => {
  it("reports every deepening, not only the final answer", async () => {
    const engine = fakeEngine();
    await engine.start();

    const seen: number[] = [];
    const controller = new AbortController();

    const search = engine.analyseLive(
      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      {
        signal: controller.signal,
        onInfo: (info) => {
          seen.push(info.depth);
          // Three deepenings is enough to prove it streams rather than
          // waiting for the end — which is the whole difference from analyse().
          if (seen.length === 3) controller.abort();
        },
      },
    );

    await search;

    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(seen.slice(0, 3)).toEqual([1, 2, 3]);
  });

  it("passes through the score and the line as the engine reports them", async () => {
    const engine = fakeEngine();
    await engine.start();

    const controller = new AbortController();
    let first: { score: unknown; pv: string | undefined } | undefined;

    await engine.analyseLive("startpos-is-not-checked", {
      signal: controller.signal,
      onInfo: (info) => {
        first ??= { score: info.score, pv: info.pv };
        controller.abort();
      },
    });

    expect(first?.score).toEqual({ kind: "cp", cp: 3 });
    expect(first?.pv).toBe("e2e4 e7e5 g1f3");
  });

  it("stops when the caller aborts, rather than searching forever", async () => {
    const engine = fakeEngine();
    await engine.start();

    const controller = new AbortController();
    const search = engine.analyseLive("fen", {
      signal: controller.signal,
      onInfo: () => controller.abort(),
    });

    // The fake deepens until told to stop. Resolving at all is the assertion:
    // an unstopped `go infinite` would hang here until the suite timed out.
    await expect(search).resolves.toBeUndefined();
  });

  it("is already over when the signal was aborted before it began", async () => {
    const engine = fakeEngine();
    await engine.start();

    const controller = new AbortController();
    controller.abort();

    let called = false;
    await engine.analyseLive("fen", {
      signal: controller.signal,
      onInfo: () => {
        called = true;
      },
    });

    expect(called).toBe(false);
  });

  it("leaves the engine usable for the next position", async () => {
    // The point of draining the bestmove. Without it the next search resolves
    // on the previous one's reply and reports one position's evaluation under
    // another's — the bug this discipline exists to prevent.
    const engine = fakeEngine();
    await engine.start();

    for (const _ of [1, 2]) {
      const controller = new AbortController();
      const depths: number[] = [];
      await engine.analyseLive("fen", {
        signal: controller.signal,
        onInfo: (info) => {
          depths.push(info.depth);
          if (depths.length === 2) controller.abort();
        },
      });
      // Each search starts its own iteration from depth 1. A leaked bestmove
      // from the previous one would show up as a search that ended instantly.
      expect(depths.slice(0, 2)).toEqual([1, 2]);
    }
  });

  it("gives up on an engine that never answers, rather than hanging", async () => {
    const engine = fakeEngine("silent");
    await engine.start();

    const controller = new AbortController();
    // Nothing ever arrives, so nothing ever aborts it from the callback.
    setTimeout(() => controller.abort(), 50);

    await expect(
      engine.analyseLive("fen", { signal: controller.signal, onInfo: () => {} }),
    ).resolves.toBeUndefined();
  });

  it("displaces the search already running, rather than queueing behind it", async () => {
    // A live search ends only when its own client goes away, so a second one
    // that merely queued would wait for the first client to close its tab.
    // The panel would sit on "Thinking…" forever, with no error to explain it.
    const engine = fakeEngine();
    await engine.start();

    const first = new AbortController();
    const second = new AbortController();

    let firstSaw = 0;
    const firstSearch = engine.analyseLive("first-position", {
      signal: first.signal,
      onInfo: () => {
        firstSaw += 1;
      },
    });

    // Let the first search actually start before displacing it.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const sawBeforeDisplacing = firstSaw;

    let secondSaw = 0;
    const secondSearch = engine.analyseLive("second-position", {
      signal: second.signal,
      onInfo: () => {
        secondSaw += 1;
        if (secondSaw >= 2) second.abort();
      },
    });

    // The first resolves without its own signal ever being aborted.
    await expect(firstSearch).resolves.toBeUndefined();
    await expect(secondSearch).resolves.toBeUndefined();

    expect(sawBeforeDisplacing).toBeGreaterThan(0);
    expect(secondSaw).toBeGreaterThanOrEqual(2);
    expect(first.signal.aborted).toBe(false);
  });

  it("refuses to search on an engine that was never started", async () => {
    const engine = new UciEngine({ path: FAKE });
    engines.push(engine);

    await expect(
      engine.analyseLive("fen", {
        signal: new AbortController().signal,
        onInfo: () => {},
      }),
    ).rejects.toBeInstanceOf(EngineError);
  });
});
