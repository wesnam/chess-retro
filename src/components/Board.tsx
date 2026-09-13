"use client";

import { useEffect, useRef, useState } from "react";
import { Chessground } from "chessground";
import type { Api } from "chessground/api";
import type { Dests, Key } from "chessground/types";

/**
 * chessground wrapper.
 *
 * chessground owns its own DOM and diffs internally. It is created ONCE in an
 * effect with no dependencies and updated through `api.set()` — re-creating it
 * whenever a prop changes is the obvious wrong turn here: it flickers, loses
 * the animation between positions, and throws away state on every step.
 *
 * The board is display-only by default, which is what reviewing a finished
 * game needs. Passing `onMove` makes it playable, for solving puzzles — the
 * same board component either way, so a position looks and behaves identically
 * whether it is being reviewed or solved.
 */
export function Board({
  fen,
  orientation,
  lastMove,
  bestMove,
  liveMove,
  onMove,
  movableColor,
  dests,
}: {
  fen: string;
  orientation: "white" | "black";
  lastMove?: [Key, Key];
  bestMove?: [Key, Key];
  /**
   * A second arrow, in a different colour, for what the engine is suggesting
   * right now. Distinct from `bestMove` because the two answer different
   * questions and can point different ways: `bestMove` is the stored verdict
   * on the move that was played, this is the live search of the position on
   * the board — and a reviewer needs to be able to tell which is which.
   */
  liveMove?: [Key, Key];
  /** Supply to make the board playable. Absent means display-only. */
  onMove?: (from: Key, to: Key) => void;
  /** Which side may be moved. Ignored when `onMove` is absent. */
  movableColor?: "white" | "black";
  /** Legal destinations per square. Without it chessground allows anything. */
  dests?: Dests;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);

  /**
   * The live handler, so the board never has to be re-created to pick up a new
   * one. chessground keeps the callback it was given at creation; a puzzle's
   * handler closes over its current position and changes on every move, so
   * reading through a ref is what keeps the board stable while the handler
   * moves on.
   */
  const handler = useRef(onMove);
  handler.current = onMove;

  /**
   * Counts moves played ON the board, so the update effect below re-runs even
   * when the caller rejected the move and no prop changed.
   *
   * chessground moves the piece on its own board BEFORE calling `after`. A
   * rejected move therefore leaves the piece on the square it was dropped on
   * while `fen`, `dests` and the rest stay identical — and identical
   * dependencies mean the effect does not re-run, so nothing ever puts it
   * back. The board would sit disagreeing with the position being analysed
   * until the reviewer stepped away, with nothing said and nothing thrown.
   */
  const [moveCount, setMoveCount] = useState(0);

  /**
   * Whether this board is interactive, read once for the life of the board.
   *
   * chessground binds its mousedown and touchstart listeners in `bindBoard`,
   * which returns early when `viewOnly` is set and is called ONLY when the
   * board is constructed. Flipping `viewOnly` through `api.set()` afterwards
   * changes the flag but cannot retroactively attach the listeners, so a board
   * created view-only can never become playable — it renders correctly, shows
   * its legal moves, and silently ignores every click.
   *
   * So interactivity is decided at construction. A component that needs to
   * change it must be remounted, which `key` on the caller does.
   */
  const interactive = useRef(onMove !== undefined).current;

  useEffect(() => {
    // The ref is always attached by the time an effect runs, since the div is
    // rendered unconditionally below. Asserted rather than guarded with an
    // early return: a silent bail with an empty dependency list would leave a
    // permanently blank board that never retries.
    const element = mount.current;
    if (!element) throw new Error("Board mounted without its container");

    const board = Chessground(element, {
      // From the ref, not the prop: this must be right at construction, and
      // the effect deliberately does not re-run when the prop changes.
      viewOnly: !interactive,
      coordinates: true,
      // Reviewing is stepping, often quickly. A long animation makes the board
      // lag behind the arrow keys.
      animation: { enabled: true, duration: 120 },
      highlight: { lastMove: true, check: true },
      movable: {
        // Never free: a puzzle scores the move that was played, so an illegal
        // one must not be playable in the first place.
        free: false,
        showDests: true,
        events: {
          after: (from, to) => {
            handler.current?.(from, to);
            // Always, not only when the move was accepted: see `moveCount`.
            setMoveCount((played) => played + 1);
          },
        },
      },
    });
    api.current = board;

    return () => {
      board.destroy();
      api.current = null;
    };
  }, []);

  // Depended on by value rather than by array identity: a fresh array every
  // render would re-run these effects on every unrelated re-render.
  const lastMoveKey = lastMove?.join("");
  const bestMoveKey = bestMove?.join("");
  const liveMoveKey = liveMove?.join("");
  // Same reasoning for the legal-move map, which is a new Map every render.
  const destsKey = dests
    ? [...dests].map(([from, to]) => `${from}${to.join("")}`).join("|")
    : "";

  useEffect(() => {
    api.current?.set({
      fen,
      orientation,
      lastMove: lastMove ? [...lastMove] : undefined,
      // Passed explicitly on every update, including as undefined: chessground
      // acts on the key being PRESENT (`'check' in config`), so omitting it
      // would leave the previous position's check highlight on the board.
      check: undefined,
      // Only ever tightened, never loosened: a board built view-only cannot
      // become playable (see `interactive` above), but a playable one is
      // locked while a puzzle is over, which stops a finished position from
      // being played on.
      viewOnly: interactive ? !onMove : true,
      // Spread rather than passed as undefined when there is no move to make.
      // chessground merges its config with a `for...in`, which copies a key
      // whose value is undefined just as readily as one with a value — so
      // `turnColor: undefined` would REPLACE its default rather than leave it
      // alone. Harmless while `viewOnly` blocks interaction, and a trap the
      // moment anything stops depending on that.
      ...(onMove && movableColor
        ? {
            turnColor: movableColor,
            movable: { color: movableColor, dests, free: false, showDests: true },
          }
        : {}),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, orientation, lastMoveKey, onMove, movableColor, destsKey, moveCount]);

  useEffect(() => {
    // Set in one call, never two: `setAutoShapes` REPLACES the whole set, so
    // a second call for the live arrow would erase the stored best-move one
    // and leave whichever effect ran last as the only arrow on the board.
    const shapes = [];
    if (bestMove) {
      shapes.push({ orig: bestMove[0], dest: bestMove[1], brush: "green" });
    }
    if (liveMove) {
      // Blue, and drawn second so it sits on top where the two coincide: the
      // live arrow is the one that moves, and it should be the one you see.
      shapes.push({ orig: liveMove[0], dest: liveMove[1], brush: "blue" });
    }
    api.current?.setAutoShapes(shapes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bestMoveKey, liveMoveKey]);

  return <div className="board-wrap" ref={mount} />;
}
