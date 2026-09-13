"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Key } from "chessground/types";
import { Board } from "@/components/Board";
import { motifLabel } from "@/analysis/motifs/labels";
import { openPuzzle, playMove, type PuzzlePosition } from "@/puzzles/session";
import { legalDests } from "@/puzzles/theme";
import type { PracticePuzzle } from "@/puzzles/select";

/**
 * Solving puzzles for one theme.
 *
 * The position on screen comes from `openPuzzle`, which applies the database's
 * setup move — the board never sees the stored FEN. Judging a move is
 * `playMove`, which is pure and tested; everything here is wiring, feedback
 * and the attempt record.
 */

type Progress = { attempted: number; solved: number };

type Loaded =
  | { status: "loading" }
  | { status: "empty"; reason?: string }
  | { status: "error"; message: string }
  | { status: "ready"; puzzles: PracticePuzzle[] };

export function PracticeSession({
  theme,
  timeClass,
  rating,
  initialProgress,
  available,
}: {
  theme: string;
  timeClass: string | undefined;
  rating: number | undefined;
  initialProgress: Progress;
  available: number;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const [index, setIndex] = useState(0);
  const [position, setPosition] = useState<PuzzlePosition | undefined>();
  const [progress, setProgress] = useState(initialProgress);
  // Bumped when a corrupt puzzle is skipped, to advance past it.
  const [skipped, setSkipped] = useState(0);
  /**
   * Whether this puzzle's result has been recorded.
   *
   * A ref, not state. The check and the set have to happen together in the
   * same tick — two moves landing before a re-render would both see `false`
   * and record the attempt twice — and React may call a state updater more
   * than once for the same move, which would do the same.
   */
  const recorded = useRef(false);

  const load = useCallback(async () => {
    setLoaded({ status: "loading" });

    try {
      const query = new URLSearchParams({ theme });
      if (timeClass) query.set("tc", timeClass);

      const response = await fetch(`/api/puzzles?${query}`);
      const body = (await response.json()) as {
        puzzles?: PracticePuzzle[];
        error?: string;
        reason?: string;
      };

      if (!response.ok) {
        setLoaded({ status: "error", message: body.error ?? "Could not load puzzles." });
        return;
      }
      if (!body.puzzles || body.puzzles.length === 0) {
        setLoaded({ status: "empty", reason: body.reason });
        return;
      }

      setLoaded({ status: "ready", puzzles: body.puzzles });
      setIndex(0);
    } catch (cause) {
      setLoaded({
        status: "error",
        message:
          cause instanceof Error ? cause.message : "Could not reach the server.",
      });
    }
  }, [theme, timeClass]);

  useEffect(() => {
    void load();
  }, [load]);

  const puzzle =
    loaded.status === "ready" ? loaded.puzzles[index] : undefined;

  // Opened here rather than in a handler so the setup move is applied exactly
  // once per puzzle, on the puzzle changing.
  useEffect(() => {
    recorded.current = false;

    if (!puzzle) {
      setPosition(undefined);
      return;
    }

    const opened = openPuzzle(puzzle);
    if (opened) {
      setPosition(opened);
      return;
    }

    // A row that cannot be opened is corrupt — nothing validates the published
    // FEN or moves at import. Skipped silently rather than shown as an error:
    // it is not the solver's problem, and one bad row in six million should
    // cost them nothing but the next puzzle.
    setPosition(undefined);
    setSkipped((count) => count + 1);
  }, [puzzle]);

  // The live position, so the move handler reads the current one rather than
  // whichever was current when chessground was given the callback.
  const positionRef = useRef(position);
  positionRef.current = position;

  // Advancing is an effect rather than part of the open, so the index moves
  // exactly once per corrupt puzzle rather than on every re-render.
  useEffect(() => {
    if (skipped === 0) return;
    setIndex((current) => current + 1);
  }, [skipped]);

  const dests = useMemo(
    () =>
      position && position.status === "solving"
        ? legalDests(position.fen)
        : new Map(),
    [position],
  );

  const record = useCallback(
    async (puzzleId: string, solved: boolean) => {
      setProgress((current) => ({
        attempted: current.attempted + 1,
        solved: current.solved + (solved ? 1 : 0),
      }));

      try {
        await fetch("/api/puzzles", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ puzzleId, solved, theme }),
        });
      } catch {
        // The attempt is a record for later, not something worth interrupting
        // practice over. The count on screen already moved.
      }
    },
    [theme],
  );

  const onMove = useCallback(
    (from: Key, to: Key) => {
      // Judged outside the state updater, which must stay pure: recording an
      // attempt is a side effect, and React is free to run an updater twice.
      const current = positionRef.current;
      if (!current || current.status !== "solving") return;

      const next = playMove(current, from, to);
      setPosition(next);

      // On the move that ENDS the puzzle, and once only — the first answer is
      // the honest one.
      if (next.status !== "solving" && !recorded.current) {
        recorded.current = true;
        void record(next.puzzle.id, next.status === "solved");
      }
    },
    [record],
  );

  function nextPuzzle() {
    if (loaded.status !== "ready") return;

    if (index + 1 < loaded.puzzles.length) {
      setIndex(index + 1);
      return;
    }
    // Out of puzzles in this set; pull a fresh one.
    void load();
  }

  if (loaded.status === "loading") {
    return <p className="hint">Finding puzzles…</p>;
  }

  if (loaded.status === "error") {
    return <p className="notice error">{loaded.message}</p>;
  }

  if (loaded.status === "empty") {
    // The two reasons for an empty set are completely different problems, and
    // telling someone they have exhausted their puzzles when in fact none were
    // ever downloaded is a failure that reads as success.
    if (loaded.reason === "not-imported") {
      return (
        <div className="empty">
          <p>The puzzle database is not downloaded yet.</p>
          <p className="hint">
            Reload this page to download it — practice needs it once, and works
            offline afterwards.
          </p>
        </div>
      );
    }

    return (
      <div className="empty">
        <p>No {motifLabel(theme)} puzzles left at your rating.</p>
        <p className="hint">
          {available.toLocaleString()} puzzles are stored, and every one
          matching this tactic near your rating has been attempted. Import the
          full database, or come back after your rating moves.
        </p>
      </div>
    );
  }

  if (!position || !puzzle) return null;

  return (
    <div className="practice-session">
      <div className="review-board">
        <Board
          fen={position.fen}
          orientation={position.orientation}
          lastMove={position.lastMove}
          // The answer, shown on the position it belongs to once it is missed.
          bestMove={position.status === "failed" ? position.solution : undefined}
          onMove={position.status === "solving" ? onMove : undefined}
          movableColor={position.orientation}
          dests={dests}
        />
      </div>

      <div className="practice-side">
        <Verdict position={position} theme={theme} />

        <dl className="weakness-stats">
          <Stat label="Puzzle rating" value={puzzle.rating.toLocaleString()} />
          <Stat
            label="Your rating"
            value={rating !== undefined ? rating.toLocaleString() : "—"}
          />
          <Stat
            label="Solved"
            value={`${progress.solved} of ${progress.attempted}`}
          />
        </dl>

        {position.status !== "solving" && (
          <button type="button" onClick={nextPuzzle}>
            Next puzzle
          </button>
        )}

        {puzzle.gameUrl && (
          <p className="hint">
            <a href={puzzle.gameUrl} rel="noreferrer">
              The game this came from
            </a>
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * What just happened, said plainly.
 *
 * Whose move it is matters as much as the verdict: a board with no prompt
 * leaves the solver guessing which side they are playing.
 */
function Verdict({
  position,
  theme,
}: {
  position: PuzzlePosition;
  theme: string;
}) {
  if (position.status === "solved") {
    return (
      <p className="notice ok">
        Solved. That was the {motifLabel(theme)}.
      </p>
    );
  }

  if (position.status === "failed") {
    return (
      <p className="notice error">
        Not this time — the move was{" "}
        <strong>
          {position.solution?.[0]}
          {position.solution?.[1]}
        </strong>
        , shown on the board.
      </p>
    );
  }

  return (
    <p className="practice-prompt">
      <strong>{position.orientation === "white" ? "White" : "Black"} to play.</strong>{" "}
      Find the {motifLabel(theme)}.
    </p>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="figure">
      <dt className="figure-label">{label}</dt>
      <dd className="figure-value">{value}</dd>
    </div>
  );
}
