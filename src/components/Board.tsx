"use client";

import { useEffect, useRef } from "react";
import { Chessground } from "chessground";
import type { Api } from "chessground/api";
import type { Key } from "chessground/types";

/**
 * chessground wrapper.
 *
 * chessground owns its own DOM and diffs internally. It is created ONCE in an
 * effect with no dependencies and updated through `api.set()` — re-creating it
 * whenever a prop changes is the obvious wrong turn here: it flickers, loses
 * the animation between positions, and throws away state on every step.
 */
export function Board({
  fen,
  orientation,
  lastMove,
  bestMove,
}: {
  fen: string;
  orientation: "white" | "black";
  lastMove?: [Key, Key];
  bestMove?: [Key, Key];
}) {
  const mount = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);

  useEffect(() => {
    if (!mount.current) return;

    const board = Chessground(mount.current, {
      viewOnly: true,
      coordinates: true,
      // Reviewing is stepping, often quickly. A long animation makes the board
      // lag behind the arrow keys.
      animation: { enabled: true, duration: 120 },
      highlight: { lastMove: true, check: true },
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

  useEffect(() => {
    api.current?.set({
      fen,
      orientation,
      lastMove: lastMove ? [...lastMove] : undefined,
      // Passed explicitly on every update, including as undefined: chessground
      // acts on the key being PRESENT (`'check' in config`), so omitting it
      // would leave the previous position's check highlight on the board.
      check: undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, orientation, lastMoveKey]);

  useEffect(() => {
    api.current?.setAutoShapes(
      bestMove ? [{ orig: bestMove[0], dest: bestMove[1], brush: "green" }] : [],
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bestMoveKey]);

  return <div className="board-wrap" ref={mount} />;
}
