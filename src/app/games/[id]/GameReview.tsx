"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Board } from "@/components/Board";
import { EvalGraph } from "@/components/EvalGraph";
import {
  buildReview,
  evalBarFraction,
  whitePovScore,
} from "@/games/review-model";
import type { MoveRow } from "@/games/queries";

/**
 * The interactive review: one board, a clickable move list, an eval bar and an
 * eval graph, all driven by a single "which position are we on" index.
 */
export function GameReview({
  moves,
  userColor,
  analysed,
}: {
  moves: MoveRow[];
  userColor: string;
  analysed: boolean;
}) {
  const review = useMemo(
    () => buildReview({ moves, userColor }),
    [moves, userColor],
  );

  // Position 0 is the starting position; position N is after ply N.
  const [index, setIndex] = useState(0);
  const lastPosition = review.positions.length - 1;

  const step = useCallback(
    (delta: number) => {
      setIndex((current) =>
        Math.min(lastPosition, Math.max(0, current + delta)),
      );
    },
    [lastPosition],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // Leave typing alone: arrow keys inside a field belong to the field.
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }

      const actions: Record<string, () => void> = {
        ArrowLeft: () => step(-1),
        ArrowRight: () => step(1),
        ArrowUp: () => setIndex(0),
        ArrowDown: () => setIndex(lastPosition),
        Home: () => setIndex(0),
        End: () => setIndex(lastPosition),
      };

      const action = actions[event.key];
      if (!action) return;
      event.preventDefault();
      action();
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, lastPosition]);

  const position = review.positions[index];
  // The evaluation shown is the one for the move that LED to this position.
  const currentMove = index > 0 ? moves[index - 1] : undefined;
  const score = currentMove ? whitePovScore(currentMove) : undefined;
  const fraction = evalBarFraction(score);

  if (!position) return null;

  return (
    <div className="review">
      <div className="review-board">
        <EvalBar fraction={fraction} orientation={review.orientation} />
        <Board
          fen={position.fen}
          orientation={review.orientation}
          lastMove={position.lastMove}
          bestMove={position.bestMove}
        />
      </div>

      <div className="review-side">
        <ReviewControls
          index={index}
          last={lastPosition}
          onStep={step}
          onJump={setIndex}
          score={score}
        />
        <ScoreSheet
          moves={moves}
          index={index}
          onSelect={setIndex}
          analysed={analysed}
        />
      </div>

      {analysed && review.graph.length > 0 && (
        <EvalGraph
          points={review.graph}
          current={index}
          onSelect={setIndex}
        />
      )}
    </div>
  );
}

function EvalBar({
  fraction,
  orientation,
}: {
  fraction: number;
  orientation: "white" | "black";
}) {
  const whitePercent = fraction * 100;
  return (
    <div
      className="eval-bar"
      // Flipped with the board, so the reviewer's own side is always at the
      // bottom of the bar as well as the board.
      data-flipped={orientation === "black" ? "true" : "false"}
      role="img"
      aria-label={`White has ${whitePercent.toFixed(0)}% winning chances`}
    >
      <div className="eval-bar-white" style={{ height: `${whitePercent}%` }} />
    </div>
  );
}

function ReviewControls({
  index,
  last,
  onStep,
  onJump,
  score,
}: {
  index: number;
  last: number;
  onStep: (delta: number) => void;
  onJump: (index: number) => void;
  score: ReturnType<typeof whitePovScore>;
}) {
  return (
    <div className="review-controls">
      <button onClick={() => onJump(0)} disabled={index === 0} aria-label="First position">
        ⏮
      </button>
      <button onClick={() => onStep(-1)} disabled={index === 0} aria-label="Previous move">
        ◀
      </button>
      <span className="review-eval">{formatScore(score)}</span>
      <button onClick={() => onStep(1)} disabled={index === last} aria-label="Next move">
        ▶
      </button>
      <button onClick={() => onJump(last)} disabled={index === last} aria-label="Last position">
        ⏭
      </button>
    </div>
  );
}

/** Evaluation in White's perspective, as players read it. */
function formatScore(score: ReturnType<typeof whitePovScore>): string {
  if (!score) return "—";
  if (score.kind === "mate") {
    return `${score.moves < 0 ? "−" : "+"}M${Math.abs(score.moves)}`;
  }
  const pawns = score.cp / 100;
  return `${pawns >= 0 ? "+" : "−"}${Math.abs(pawns).toFixed(2)}`;
}

function ScoreSheet({
  moves,
  index,
  onSelect,
  analysed,
}: {
  moves: MoveRow[];
  index: number;
  onSelect: (index: number) => void;
  analysed: boolean;
}) {
  const active = useRef<HTMLButtonElement>(null);

  // Keep the current move in view when stepping with the keyboard, or a long
  // game scrolls out from under the reviewer.
  useEffect(() => {
    active.current?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const pairs: Array<{ number: number; white?: MoveRow; black?: MoveRow }> = [];
  for (const move of moves) {
    const number = Math.ceil(move.ply / 2);
    const pair = pairs.at(-1);
    if (pair?.number === number) {
      pair.black = move;
    } else {
      pairs.push(
        move.color === "w" ? { number, white: move } : { number, black: move },
      );
    }
  }

  return (
    <ol className="scoresheet">
      {pairs.map((pair) => (
        <li key={pair.number}>
          <span className="num muted">{pair.number}.</span>
          <MoveButton
            move={pair.white}
            index={index}
            onSelect={onSelect}
            analysed={analysed}
            activeRef={active}
          />
          <MoveButton
            move={pair.black}
            index={index}
            onSelect={onSelect}
            analysed={analysed}
            activeRef={active}
          />
        </li>
      ))}
    </ol>
  );
}

function MoveButton({
  move,
  index,
  onSelect,
  analysed,
  activeRef,
}: {
  move: MoveRow | undefined;
  index: number;
  onSelect: (index: number) => void;
  analysed: boolean;
  activeRef: React.RefObject<HTMLButtonElement | null>;
}) {
  if (!move) return <span className="move-slot" />;

  // Ply N is reached at position N.
  const isCurrent = index === move.ply;

  return (
    <button
      ref={isCurrent ? activeRef : undefined}
      className={`move-slot${isCurrent ? " current" : ""}${
        move.isUserMove ? " mine" : ""
      }`}
      onClick={() => onSelect(move.ply)}
      aria-current={isCurrent ? "true" : undefined}
    >
      <span className="san">{move.san}</span>
      {analysed && move.classification && (
        <span className={`tag ${move.classification}`}>
          {shortLabel(move.classification)}
        </span>
      )}
    </button>
  );
}

function shortLabel(classification: string): string {
  const labels: Record<string, string> = {
    best: "★",
    excellent: "!",
    good: "",
    inaccuracy: "?!",
    mistake: "?",
    blunder: "??",
  };
  return labels[classification] ?? classification;
}
