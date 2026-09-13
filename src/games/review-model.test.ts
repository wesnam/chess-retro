import { describe, it, expect } from "vitest";
import {
  buildReview,
  evalBarFraction,
  whitePovScore,
  type ReviewMoveInput,
} from "./review-model";

/**
 * The pure model behind the board. Everything the reviewer sees — which
 * position a step lands on, which way the board faces, where the arrow points,
 * how tall the eval bar is, where the graph turns — is decided here, so it can
 * be asserted without a DOM or an engine.
 */

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const AFTER_E4 =
  "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
const AFTER_E5 =
  "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";

function move(overrides: Partial<ReviewMoveInput> & { ply: number }): ReviewMoveInput {
  return {
    color: overrides.ply % 2 === 1 ? "w" : "b",
    san: "e4",
    uci: "e2e4",
    fenBefore: START,
    isUserMove: true,
    evalBefore: 20,
    evalAfter: 20,
    mateBefore: null,
    mateAfter: null,
    bestMoveUci: null,
    classification: null,
    ...overrides,
  };
}

describe("buildReview", () => {
  it("gives one more position than there are moves, so the final position is reachable", () => {
    // Stored rows hold the position BEFORE each move; the position after the
    // last move belongs to no row and has to be derived, or a reviewer could
    // never see how the game actually ended.
    const review = buildReview({
      moves: [
        move({ ply: 1, uci: "e2e4", san: "e4", fenBefore: START }),
        move({ ply: 2, uci: "e7e5", san: "e5", fenBefore: AFTER_E4 }),
      ],
      userColor: "w",
    });

    expect(review.positions).toHaveLength(3);
    expect(review.positions[0]!.fen).toBe(START);
    expect(review.positions[1]!.fen).toBe(AFTER_E4);
    expect(review.positions[2]!.fen).toBe(AFTER_E5);
  });

  it("marks each position with the move that produced it, for last-move highlighting", () => {
    const review = buildReview({
      moves: [move({ ply: 1, uci: "e2e4", fenBefore: START })],
      userColor: "w",
    });

    expect(review.positions[0]!.lastMove).toBeUndefined();
    expect(review.positions[1]!.lastMove).toEqual(["e2", "e4"]);
  });

  it("reads a promotion's last move without the promotion suffix", () => {
    // chessground takes squares, not UCI. Passing "a7a8q" whole would give it
    // a three-character square and highlight nothing.
    const review = buildReview({
      moves: [
        move({
          ply: 1,
          uci: "a7a8q",
          san: "a8=Q",
          fenBefore: "8/P7/8/8/8/8/8/K6k w - - 0 1",
        }),
      ],
      userColor: "w",
    });

    expect(review.positions[1]!.lastMove).toEqual(["a7", "a8"]);
  });

  it("indexes positions by ply, so the board and the evaluation agree", () => {
    // The board, the eval bar and the scoresheet all key off the same number.
    // Position N must be the position reached after ply N, or a click on a
    // move shows one position with another's evaluation.
    const review = buildReview({
      moves: [
        move({ ply: 1, uci: "e2e4", fenBefore: START }),
        move({ ply: 2, uci: "e7e5", fenBefore: AFTER_E4 }),
      ],
      userColor: "w",
    });

    expect(review.positions[1]!.fen).toBe(AFTER_E4);
    expect(review.graph.map((g) => g.positionIndex)).toEqual([1, 2]);
  });

  it("stops at the last position it could actually derive", () => {
    // An unreplayable last move leaves no final position. Stepping must stop
    // at the last real one rather than at an index holding nothing.
    const review = buildReview({
      moves: [
        move({ ply: 1, uci: "e2e4", san: "e4", fenBefore: START }),
        move({ ply: 2, uci: "h7h8", san: "??", fenBefore: AFTER_E4 }),
      ],
      userColor: "w",
    });

    expect(review.positions).toHaveLength(2);
    expect(review.lastPositionIndex).toBe(1);
    expect(review.positions[review.lastPositionIndex]).toBeDefined();
  });

  it("orients the board to the colour the person played", () => {
    expect(buildReview({ moves: [], userColor: "b" }).orientation).toBe("black");
    expect(buildReview({ moves: [], userColor: "w" }).orientation).toBe("white");
  });

  it("draws a best-move arrow on a position where a serious error was played", () => {
    const review = buildReview({
      moves: [
        move({
          ply: 1,
          uci: "e2e4",
          fenBefore: START,
          classification: "blunder",
          bestMoveUci: "d2d4",
        }),
      ],
      userColor: "w",
    });

    // The arrow belongs to the position the mistake was played FROM, not the
    // one it led to: it shows what should have been played instead.
    expect(review.positions[0]!.bestMove).toEqual(["d2", "d4"]);
    expect(review.positions[1]!.bestMove).toBeUndefined();
  });

  it("draws an arrow on a good move the engine disagreed with", () => {
    // "The engine would have played this instead" is worth seeing on a move
    // that was merely good. Restricting arrows to errors hid the alternative
    // on exactly the moves a player is most curious about.
    const review = buildReview({
      moves: [move({ ply: 1, classification: "good", bestMoveUci: "d2d4" })],
      userColor: "w",
    });

    expect(review.positions[0]!.bestMove).toEqual(["d2", "d4"]);
  });

  it("draws an arrow on an excellent move the engine disagreed with", () => {
    const review = buildReview({
      moves: [move({ ply: 1, classification: "excellent", bestMoveUci: "d2d4" })],
      userColor: "w",
    });

    expect(review.positions[0]!.bestMove).toEqual(["d2", "d4"]);
  });

  it("draws no arrow on a best move", () => {
    // The move played IS the engine's choice, so there is nothing to point at.
    const review = buildReview({
      moves: [move({ ply: 1, classification: "best", bestMoveUci: "e7e5" })],
      userColor: "w",
    });

    expect(review.positions[0]!.bestMove).toBeUndefined();
  });

  it("does not draw an arrow when the best move is what was played", () => {
    // A move can be classified an inaccuracy on win-probability drop while
    // still being the engine's top choice; an arrow pointing at the played
    // move would read as "you should have played what you played".
    const review = buildReview({
      moves: [
        move({
          ply: 1,
          uci: "e2e4",
          classification: "inaccuracy",
          bestMoveUci: "e2e4",
        }),
      ],
      userColor: "w",
    });

    expect(review.positions[0]!.bestMove).toBeUndefined();
  });

  it("ignores a square it cannot read rather than passing it to the board", () => {
    // Squares are a closed set of 64 names. A malformed one reaching the board
    // silently highlights nothing, which is harder to notice than no arrow.
    const review = buildReview({
      moves: [
        move({
          ply: 1,
          uci: "e2e4",
          classification: "blunder",
          bestMoveUci: "zz99",
        }),
      ],
      userColor: "w",
    });

    expect(review.positions[0]!.bestMove).toBeUndefined();
  });

  it("only draws arrows for the reviewer's own mistakes", () => {
    // The opponent's blunders are not the reviewer's lesson, and arrowing them
    // clutters the board on exactly the positions worth studying.
    const review = buildReview({
      moves: [
        move({
          ply: 1,
          isUserMove: false,
          classification: "blunder",
          bestMoveUci: "d2d4",
        }),
      ],
      userColor: "b",
    });

    expect(review.positions[0]!.bestMove).toBeUndefined();
  });
});

describe("whitePovScore", () => {
  it("leaves a white move's evaluation alone", () => {
    expect(whitePovScore({ evalAfter: 150, mateAfter: null, color: "w" })).toEqual({
      kind: "cp",
      cp: 150,
    });
  });

  it("flips a black move's evaluation into White's perspective", () => {
    // Stored evaluations are in the MOVER's perspective. A graph that plotted
    // them raw would zig-zag every ply regardless of what happened.
    expect(whitePovScore({ evalAfter: 150, mateAfter: null, color: "b" })).toEqual({
      kind: "cp",
      cp: -150,
    });
  });

  it("flips mate distances too", () => {
    expect(whitePovScore({ evalAfter: null, mateAfter: 3, color: "b" })).toEqual({
      kind: "mate",
      moves: -3,
    });
  });

  it("returns nothing when the position was never evaluated", () => {
    expect(
      whitePovScore({ evalAfter: null, mateAfter: null, color: "w" }),
    ).toBeUndefined();
  });
});

describe("evalBarFraction", () => {
  it("puts a balanced position at half", () => {
    expect(evalBarFraction({ kind: "cp", cp: 0 })).toBeCloseTo(0.5, 5);
  });

  it("gives White more of the bar when White is better", () => {
    expect(evalBarFraction({ kind: "cp", cp: 300 })).toBeGreaterThan(0.5);
  });

  it("gives White less of the bar when Black is better", () => {
    expect(evalBarFraction({ kind: "cp", cp: -300 })).toBeLessThan(0.5);
  });

  it("saturates at the extremes without leaving the bar", () => {
    expect(evalBarFraction({ kind: "mate", moves: 1 })).toBeLessThanOrEqual(1);
    expect(evalBarFraction({ kind: "mate", moves: 1 })).toBeGreaterThan(0.97);
    expect(evalBarFraction({ kind: "mate", moves: -1 })).toBeGreaterThanOrEqual(0);
    expect(evalBarFraction({ kind: "mate", moves: -1 })).toBeLessThan(0.03);
  });

  it("sits at half when there is no evaluation", () => {
    expect(evalBarFraction(undefined)).toBe(0.5);
  });
});
