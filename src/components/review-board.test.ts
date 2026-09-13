import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { legalDests } from "@/puzzles/theme";

/**
 * That the review board is playable, with the props the review actually gives it.
 *
 * The review board used to be display-only. Ticket 11 makes it playable so a
 * line can be explored off the game, and `viewOnly` is read ONCE at
 * construction — so getting this wrong produces a board that renders the
 * position, shows its legal moves, and silently ignores every click, with
 * every unit test still green. That is not a hypothetical: it is how the
 * practice feature shipped dead.
 */

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

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

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

describe("the board the review builds", () => {
  it("binds its input listeners, so a move can actually be played on it", async () => {
    const probe = withDom();
    try {
      const { Chessground } = await import("chessground");

      // Exactly what Board.tsx constructs when the review passes `onMove`.
      Chessground(probe.board, {
        viewOnly: false,
        coordinates: true,
        animation: { enabled: true, duration: 120 },
        highlight: { lastMove: true, check: true },
        movable: {
          free: false,
          showDests: true,
          events: { after: () => {} },
        },
      });

      expect(probe.events).toContain("mousedown");
      await settle();
    } finally {
      probe.cleanup();
    }
  });

  it("offers the position's real legal moves and nothing else", async () => {
    const probe = withDom();
    try {
      const { Chessground } = await import("chessground");

      const api = Chessground(probe.board, {
        viewOnly: false,
        movable: { free: false, events: { after: () => {} } },
      });

      api.set({
        turnColor: "white",
        movable: {
          color: "white",
          dests: legalDests(START),
          free: false,
          showDests: true,
        },
      });

      const dests = api.state.movable.dests!;
      // Keyed by the square a piece moves FROM: eight pawns and two knights
      // can move in the starting position, between them the twenty legal
      // first moves.
      expect([...dests.keys()]).toHaveLength(10);
      const moves = [...dests.values()].flat();
      expect(moves).toHaveLength(20);
      // A pawn goes one square or two.
      expect(dests.get("e2")).toEqual(["e3", "e4"]);
      // A knight on g1 reaches exactly two squares, and is offered no others.
      expect(dests.get("g1")).toEqual(["f3", "h3"]);
      // The back rank is blocked in, and offered nothing at all.
      expect(dests.get("e1")).toBeUndefined();
      await settle();
    } finally {
      probe.cleanup();
    }
  });
});
