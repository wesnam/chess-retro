import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";

/**
 * That a playable board is actually playable.
 *
 * chessground binds its `mousedown` and `touchstart` listeners in `bindBoard`,
 * which returns early when `viewOnly` is set — and is called ONLY when the
 * board is constructed. Flipping `viewOnly` through `api.set()` afterwards
 * changes the flag but cannot retroactively attach the listeners.
 *
 * A board built view-only and later "made playable" therefore renders the
 * position correctly, highlights its legal moves, and silently ignores every
 * click. Nothing throws and nothing logs. The whole practice feature was dead
 * in exactly this way while all of its unit tests passed, because they cover
 * the pure modules and never mount a board.
 *
 * This test exists to make that failure loud. It drives the real chessground
 * against a real DOM rather than asserting on our own props.
 */

type Probe = { board: HTMLElement; events: string[]; cleanup: () => void };

function withDom(): Probe {
  const dom = new JSDOM("<!doctype html><div id='board'></div>", {
    pretendToBeVisual: true,
  });

  const events: string[] = [];
  const original = dom.window.HTMLElement.prototype.addEventListener as (
    ...args: unknown[]
  ) => void;
  dom.window.HTMLElement.prototype.addEventListener = function (
    this: unknown,
    ...args: unknown[]
  ) {
    events.push(String(args[0]));
    return original.apply(this, args);
  } as typeof dom.window.HTMLElement.prototype.addEventListener;

  const globals = globalThis as Record<string, unknown>;
  const saved = {
    window: globals.window,
    document: globals.document,
    HTMLElement: globals.HTMLElement,
    Element: globals.Element,
    ResizeObserver: globals.ResizeObserver,
    requestAnimationFrame: globals.requestAnimationFrame,
  };

  class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  globals.window = dom.window;
  globals.document = dom.window.document;
  globals.HTMLElement = dom.window.HTMLElement;
  globals.Element = dom.window.Element;
  globals.ResizeObserver = NoopResizeObserver;
  (dom.window as unknown as Record<string, unknown>).ResizeObserver =
    NoopResizeObserver;
  globals.requestAnimationFrame = (cb: () => void) => setTimeout(cb, 0);

  return {
    board: dom.window.document.getElementById("board") as HTMLElement,
    events,
    cleanup: () => {
      Object.assign(globals, saved);
      dom.window.close();
    },
  };
}

describe("a chessground board's input listeners", () => {
  it("are bound when it is created playable", async () => {
    const probe = withDom();
    try {
      const { Chessground } = await import("chessground");

      Chessground(probe.board, {
        viewOnly: false,
        movable: { free: false, events: { after: () => {} } },
      });

      expect(probe.events).toContain("mousedown");
    } finally {
      probe.cleanup();
    }
  });

  /**
   * The trap, pinned. If this ever starts passing, chessground has changed and
   * `Board.tsx` can be simplified — until then, `viewOnly` must be correct at
   * construction and the component must be remounted to change it.
   */
  it("are NOT bound by turning viewOnly off after creation", async () => {
    const probe = withDom();
    try {
      const { Chessground } = await import("chessground");

      const api = Chessground(probe.board, { viewOnly: true });
      probe.events.length = 0;
      api.set({
        viewOnly: false,
        movable: { color: "white", dests: new Map([["e2", ["e4"]]]) },
      });

      expect(probe.events).not.toContain("mousedown");
    } finally {
      probe.cleanup();
    }
  });
});
