"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Key } from "chessground/types";
import { Board } from "@/components/Board";
import { EvalGraph } from "@/components/EvalGraph";
import {
  buildReview,
  evalBarFraction,
  whitePovScore,
} from "@/games/review-model";
import type { MoveRow } from "@/games/queries";
import { missedSummary } from "@/analysis/motifs/labels";
import {
  CLASSIFICATION_LEGEND,
  explainMove,
  formatUci,
} from "@/games/explain-move";
import {
  playExploration,
  startExploration,
  undoExploration,
  type Exploration,
} from "@/games/exploration";
import { legalDests } from "@/puzzles/theme";
import {
  LiveAnalysisPanel,
  liveMoveArrow,
  useLiveAnalysis,
} from "./LiveAnalysis";

/**
 * The interactive review: one board, a clickable move list, an eval bar and an
 * eval graph, all driven by a single "which position are we on" index.
 */
export function GameReview({
  moves,
  userColor,
  analysed,
  missedMotifs = {},
  initialIndex = 0,
}: {
  moves: MoveRow[];
  userColor: string;
  analysed: boolean;
  /** Tactics the player missed, keyed by ply. */
  missedMotifs?: Record<number, string[]>;
  /**
   * Position to open on, so a dashboard example can link straight to the move
   * it is evidence for.
   */
  initialIndex?: number;
}) {
  const review = useMemo(
    () => buildReview({ moves, userColor }),
    [moves, userColor],
  );

  // Position 0 is the starting position; position N is after ply N.
  const [index, setIndex] = useState(() =>
    Math.min(Math.max(0, initialIndex), review.lastPositionIndex),
  );
  const lastPosition = review.lastPositionIndex;

  /**
   * The line being explored off the game, or undefined when the board is
   * showing the game itself.
   *
   * Cleared whenever the position changes: an exploration belongs to the
   * position it branched from, and carrying it to the next move would show a
   * line that was never played from a position it was never played in.
   */
  const [exploring, setExploring] = useState<Exploration | undefined>();
  const [engineOn, setEngineOn] = useState(false);

  const step = useCallback(
    (delta: number) => {
      setExploring(undefined);
      setIndex((current) =>
        Math.min(lastPosition, Math.max(0, current + delta)),
      );
    },
    [lastPosition],
  );

  const jumpTo = useCallback((next: number) => {
    setExploring(undefined);
    setIndex(next);
  }, []);

  /**
   * Positions the user should actually look at: their own inaccuracies,
   * mistakes and blunders.
   *
   * A 60-move game has 61 positions and no reason to step through all of
   * them. Stored as the position the error was played FROM — ply N is chosen
   * at position N-1 — matching where the best-move arrow is drawn.
   */
  const mistakePositions = useMemo(
    () =>
      moves
        .filter(
          (move) =>
            move.isUserMove &&
            move.classification !== null &&
            ["inaccuracy", "mistake", "blunder"].includes(move.classification),
        )
        .map((move) => move.ply - 1)
        .sort((a, b) => a - b),
    [moves],
  );

  const jumpToMistake = useCallback(
    (direction: 1 | -1) => {
      setExploring(undefined);
      setIndex((current) => {
        const next =
          direction === 1
            ? mistakePositions.find((p) => p > current)
            : [...mistakePositions].reverse().find((p) => p < current);
        return next ?? current;
      });
    },
    [mistakePositions],
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

      // Only the horizontal keys are claimed. Up/Down/Home/End belong to
      // scrolling the page, and taking them makes a long game unreadable.
      const actions: Record<string, () => void> = {
        ArrowLeft: () => step(-1),
        ArrowRight: () => step(1),
        // The review shortcut: skip straight to what went wrong.
        n: () => jumpToMistake(1),
        p: () => jumpToMistake(-1),
      };

      const action = actions[event.key];
      if (!action) return;
      // Modified presses are the browser's (back/forward, word navigation).
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return;
      }
      event.preventDefault();
      action();
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, lastPosition, jumpToMistake]);

  const position = review.positions[index];
  // The evaluation shown is the one for the move that LED to this position.
  // Looked up by ply rather than by array position: those coincide today, but
  // tying the board, the bar and the highlight to three different indexing
  // schemes is how they quietly drift apart later.
  const currentMove = moves.find((move) => move.ply === index);
  const storedScore = currentMove ? whitePovScore(currentMove) : undefined;

  // What the board is actually showing: the explored line when there is one,
  // the game position otherwise.
  const shownFen = exploring?.fen ?? position?.fen;

  /**
   * Off the game line, every stored number is about a position that is no
   * longer on the board.
   *
   * The eval bar, the score readout, the verdict and the scoresheet cursor all
   * describe the move that was PLAYED at this index. Leaving them up while an
   * explored position is shown is the exact failure this project keeps naming:
   * the board showing one position while the evaluation beside it describes
   * another. Playing the engine's suggestion and watching the bar not move
   * reads as the engine contradicting itself.
   *
   * So they are withdrawn rather than recomputed. What the explored position
   * is worth is a question only the engine can answer, and the live panel is
   * where that answer already appears.
   */
  const score = exploring ? undefined : storedScore;
  const fraction = evalBarFraction(score);

  const play = useCallback(
    (from: Key, to: Key) => {
      setExploring((current) => {
        // The first move off the game line starts the exploration; every one
        // after it extends the line already in hand.
        const line =
          current ?? (shownFen ? startExploration(shownFen) : undefined);
        if (!line) return current;
        // An illegal move leaves the line as it was rather than clearing it.
        return playExploration(line, from, to) ?? line;
      });
    },
    [shownFen],
  );

  // Legal moves for whatever is on the board. Without them chessground permits
  // any drag at all, and a bishop moved like a rook would be "explored".
  const dests = useMemo(
    () => (shownFen ? legalDests(shownFen) : undefined),
    [shownFen],
  );

  // The engine analyses what is on the board, explored line included — that
  // is the whole point of being able to play a move here.
  const liveState = useLiveAnalysis(shownFen ?? "", engineOn && !!shownFen);

  if (!position) return null;

  return (
    <div className="review">
      <div className="review-board">
        <EvalBar
          fraction={fraction}
          orientation={review.orientation}
          unknown={!!exploring}
        />
        <Board
          fen={shownFen ?? position.fen}
          orientation={review.orientation}
          lastMove={exploring ? exploring.lastMove : position.lastMove}
          // The stored verdict belongs to the game line. Off the line it is
          // an answer to a question nobody asked.
          bestMove={exploring ? undefined : position.bestMove}
          liveMove={liveMoveArrow(liveState)}
          onMove={play}
          movableColor={sideToMoveColor(shownFen ?? position.fen)}
          dests={dests}
        />
      </div>

      <div className="review-side">
        <ReviewControls
          index={index}
          last={lastPosition}
          onStep={step}
          onJump={jumpTo}
          onJumpToMistake={jumpToMistake}
          mistakeCount={mistakePositions.length}
          score={score}
        />

        {/*
          Above the stored verdict, because when a line is being explored the
          verdict below is about the game and this is about the board.
        */}
        <LiveAnalysisPanel
          state={liveState}
          fen={shownFen ?? position.fen}
          enabled={engineOn}
          onToggle={setEngineOn}
        />

        {exploring && exploring.moves.length > 0 && (
          <ExplorationLine
            line={exploring}
            onUndo={() => setExploring((current) => current && undoExploration(current))}
            onReset={() => setExploring(undefined)}
          />
        )}
        {/*
          The tactic was available at the position the ply was played FROM,
          which is position index + 1 in ply terms. Keyed off `index + 1` so
          the note appears on the same position as the best-move arrow rather
          than one step after it.
        */}
        <MoveVerdict
          // Withdrawn off the game line: it accuses the reader of a move that
          // is not playable from the position they are looking at.
          move={exploring ? undefined : moves.find((m) => m.ply === index + 1)}
          // The following ply's stored line is the engine's refutation of
          // this move — what the opponent does about it.
          next={moves.find((m) => m.ply === index + 2)}
          missed={exploring ? undefined : missedMotifs[index + 1]}
          analysed={analysed}
        />
        {/*
          Kept as-is while exploring, unlike the bar and the verdict: the
          cursor marks where the line BRANCHED FROM, which is orienting rather
          than misleading, and clicking any move is the way back to the game.
        */}
        <ScoreSheet
          moves={moves}
          index={index}
          onSelect={jumpTo}
          analysed={analysed}
          missedMotifs={missedMotifs}
        />
        {analysed && <Legend />}
      </div>

      {analysed && review.graph.length > 0 && (
        <EvalGraph
          points={review.graph}
          current={index}
          lastPositionIndex={review.lastPositionIndex}
          onSelect={jumpTo}
        />
      )}
    </div>
  );
}

/** Which side may be moved on a position, for chessground. */
function sideToMoveColor(fen: string): "white" | "black" {
  return fen.split(/\s+/)[1] === "b" ? "black" : "white";
}

/**
 * The line being explored, and the way back out of it.
 *
 * Shown only once a move has been played, so the review is not cluttered by
 * an empty branch on every position.
 */
function ExplorationLine({
  line,
  onUndo,
  onReset,
}: {
  line: Exploration;
  onUndo: () => void;
  onReset: () => void;
}) {
  return (
    <div className="exploration">
      <p className="exploration-head">
        <span className="exploration-label">Exploring</span>
        <span className="exploration-moves">
          {line.moves.map((move) => move.san).join(" ")}
        </span>
      </p>
      <div className="exploration-controls">
        <button type="button" onClick={onUndo}>
          ← Take back
        </button>
        <button type="button" onClick={onReset}>
          Back to the game
        </button>
      </div>
    </div>
  );
}

/**
 * What the move played from this position was, and why it earned its mark.
 *
 * The scoresheet could only show a symbol. A reader who does not already know
 * the notation learns nothing from `??`, and even one who does is not told
 * what it cost or what was better.
 */
function MoveVerdict({
  move,
  next,
  missed,
  analysed,
}: {
  move: MoveRow | undefined;
  next: MoveRow | undefined;
  missed: string[] | undefined;
  analysed: boolean;
}) {
  if (!move || !analysed) return null;
  const explained = explainMove(move, next);
  if (!explained) return null;

  return (
    <div
      className={`verdict verdict-${move.classification}`}
      data-whose={move.isUserMove ? "yours" : "theirs"}
    >
      <p className="verdict-head">
        <span className="verdict-move">{move.san}</span>
        <span className={`tag ${move.classification}`}>{explained.name}</span>
        {/*
          Whose move this is, always. Without it an opponent's blunder reads
          as the reader's own, and "X was better" looks like advice for them
          when it is advice for the other side.
        */}
        <span className="verdict-whose">
          {move.isUserMove ? "your move" : "opponent"}
        </span>
      </p>
      {/*
        The concrete reason first, when there is one. "Cost 61.6 points of win
        probability" is the mark restated in other units, not a reason — it
        goes last, as the fallback for the majority of errors where nothing
        certain can be named.
      */}
      {explained.problem && (
        <p className="verdict-problem">{explained.problem}</p>
      )}
      {explained.betterIdea && (
        <p className="verdict-better">{explained.betterIdea}</p>
      )}
      {!explained.betterIdea && explained.betterMove && (
        <p className="verdict-better">
          Engine preferred <strong>{formatUci(explained.betterMove)}</strong>
        </p>
      )}
      <p className="verdict-why">{explained.cost}</p>
      {missed?.length ? (
        <p className="verdict-missed">You {missedSummary(missed)}.</p>
      ) : null}
    </div>
  );
}

/**
 * What the marks mean.
 *
 * Without this the scoresheet is a column of unexplained symbols, and the
 * thresholds behind them are invisible — so a reader cannot tell whether `?!`
 * is a rounding error or a real error.
 */
function Legend() {
  return (
    <details className="legend">
      <summary>What do the marks mean?</summary>
      <dl>
        {CLASSIFICATION_LEGEND.map((entry) => (
          <div key={entry.key} className="legend-row">
            <dt>
              <span className={`tag ${entry.key}`}>
                {entry.symbol || "\u2014"}
              </span>
              {entry.name}
            </dt>
            <dd>{entry.meaning}</dd>
          </div>
        ))}
      </dl>
      <p className="legend-note">
        Marks are decided by how much <strong>win probability</strong> a move
        gave up, not by material. Losing three pawns in an already-won position
        is not a blunder; hanging one in a level position is.
      </p>
    </details>
  );
}

function EvalBar({
  fraction,
  orientation,
  unknown = false,
}: {
  fraction: number;
  orientation: "white" | "black";
  /**
   * No stored evaluation applies to what is on the board — an explored line.
   * Greyed rather than left at its last value: a bar that keeps showing the
   * game's number beside a position that is not the game's is worse than one
   * that admits it does not know.
   */
  unknown?: boolean;
}) {
  const whitePercent = fraction * 100;
  return (
    <div
      className="eval-bar"
      // Flipped with the board, so the reviewer's own side is always at the
      // bottom of the bar as well as the board.
      data-flipped={orientation === "black" ? "true" : "false"}
      data-unknown={unknown ? "true" : "false"}
      role="img"
      aria-label={
        unknown
          ? "No stored evaluation for this position"
          : `White has ${whitePercent.toFixed(0)}% winning chances`
      }
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
  onJumpToMistake,
  mistakeCount,
  score,
}: {
  index: number;
  last: number;
  onStep: (delta: number) => void;
  onJump: (index: number) => void;
  onJumpToMistake: (direction: 1 | -1) => void;
  mistakeCount: number;
  score: ReturnType<typeof whitePovScore>;
}) {
  return (
    <>
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

      {/*
        The reason anyone opens a game they already played: find the moves
        that went wrong. Stepping through sixty positions to reach them is the
        difference between a review tool and a replay.
      */}
      {mistakeCount > 0 && (
        <div className="mistake-nav">
          <button onClick={() => onJumpToMistake(-1)}>
            ← Previous mistake
          </button>
          <span className="mistake-count">
            {mistakeCount} of your moves went wrong
          </span>
          <button onClick={() => onJumpToMistake(1)}>Next mistake →</button>
        </div>
      )}
    </>
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
  missedMotifs,
}: {
  moves: MoveRow[];
  index: number;
  onSelect: (index: number) => void;
  analysed: boolean;
  missedMotifs: Record<number, string[]>;
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
            missedMotifs={missedMotifs}
          />
          <MoveButton
            move={pair.black}
            index={index}
            onSelect={onSelect}
            analysed={analysed}
            activeRef={active}
            missedMotifs={missedMotifs}
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
  missedMotifs,
}: {
  move: MoveRow | undefined;
  index: number;
  onSelect: (index: number) => void;
  analysed: boolean;
  activeRef: React.RefObject<HTMLButtonElement | null>;
  missedMotifs: Record<number, string[]>;
}) {
  if (!move) return <span className="move-slot" />;

  const missed = missedMotifs[move.ply];

  /**
   * Highlight the move that is ABOUT to be played from this position, not the
   * one that led to it.
   *
   * Position N-1 is where ply N is chosen, and it is where the best-move
   * arrow and the "you missed" note for ply N are drawn (both keyed off
   * `index + 1`). Highlighting ply `index` instead put the scoresheet cursor
   * one move behind the arrow, so a dashboard example linking to a blunder
   * showed the cursor on the quiet move before it.
   *
   * Selecting a move likewise jumps to `ply - 1`, so clicking a move in the
   * list lands where that move's own arrow is drawn.
   */
  const isCurrent = index + 1 === move.ply;

  return (
    <button
      ref={isCurrent ? activeRef : undefined}
      className={`move-slot${isCurrent ? " current" : ""}${
        move.isUserMove ? " mine" : ""
      }`}
      onClick={() => onSelect(move.ply - 1)}
      aria-current={isCurrent ? "true" : undefined}
    >
      <span className="san">{move.san}</span>
      {missed?.length ? (
        <span className="motif-dot" title={`You ${missedSummary(missed)}`}>
          ◆
        </span>
      ) : null}
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
