import { describe, it, expect } from "vitest";
import {
  classify,
  gameAccuracy,
  invert,
  MATE_CP,
  moveAccuracy,
  THRESHOLDS,
  toCp,
  winPct,
  type Score,
} from "./accuracy";

const cp = (n: number): Score => ({ kind: "cp", cp: n });
const mate = (n: number): Score => ({ kind: "mate", moves: n });

describe("win probability", () => {
  it("is even in a level position", () => {
    expect(winPct(cp(0))).toBe(50);
  });

  it("rises for the side to move when they are better", () => {
    expect(winPct(cp(100))).toBeGreaterThan(50);
    expect(winPct(cp(-100))).toBeLessThan(50);
  });

  it("is symmetric about level", () => {
    expect(winPct(cp(300)) + winPct(cp(-300))).toBeCloseTo(100, 6);
  });

  it("matches the published fit at a pawn up", () => {
    // 50 + 50 * (2 / (1 + exp(-0.00368208 * 100)) - 1)
    expect(winPct(cp(100))).toBeCloseTo(59.1, 1);
  });

  it("saturates rather than exceeding certainty", () => {
    expect(winPct(cp(100_000))).toBeLessThanOrEqual(100);
    expect(winPct(cp(-100_000))).toBeGreaterThanOrEqual(0);
  });

  it("clamps beyond ten pawns, where practical chances stop moving", () => {
    expect(winPct(cp(1000))).toBe(winPct(cp(5000)));
  });

  it("is certainty for a forced mate", () => {
    expect(winPct(mate(1))).toBe(100);
    expect(winPct(mate(5))).toBe(100);
    expect(winPct(mate(-1))).toBe(0);
  });
});

describe("perspective", () => {
  it("flips a centipawn score", () => {
    expect(invert(cp(250))).toEqual(cp(-250));
  });

  it("flips a mate score", () => {
    expect(invert(mate(3))).toEqual(mate(-3));
  });

  it("round-trips", () => {
    expect(invert(invert(cp(137)))).toEqual(cp(137));
  });

  it("turns a winning position into a losing one", () => {
    // The same position is +720 for the player to move and -720 for the other.
    // This is the convention the engine reports in, and getting it backwards
    // silently inverts every number downstream.
    expect(winPct(cp(720))).toBeGreaterThan(90);
    expect(winPct(invert(cp(720)))).toBeLessThan(10);
  });
});

describe("scores as numbers", () => {
  it("passes centipawns through", () => {
    expect(toCp(cp(42))).toBe(42);
  });

  it("puts mate far beyond any real evaluation", () => {
    expect(toCp(mate(1))).toBeGreaterThan(9000);
    expect(toCp(mate(-1))).toBeLessThan(-9000);
  });

  it("ranks a nearer mate above a distant one", () => {
    expect(toCp(mate(1))).toBeGreaterThan(toCp(mate(8)));
    // And for the losing side, a nearer mate is worse.
    expect(toCp(mate(-1))).toBeLessThan(toCp(mate(-8)));
  });

  it("treats mate 0 as already lost, not already won", () => {
    // Stockfish emits `score mate 0` for a position where the side to move is
    // ALREADY checkmated — verified directly against the engine. Reading it
    // as a win inverts the cost of every checkmating move.
    expect(toCp(mate(0))).toBe(-MATE_CP);
    expect(winPct(mate(0))).toBe(0);
  });

  it("makes delivering mate cost the loser, not the winner", () => {
    // White mates: before the move White had mate in 1; after it, the side to
    // move (Black) is mated, which in Black's own terms is mate 0.
    const moverBefore = mate(1);
    const opponentAfter = mate(0);
    const moverAfter = invert(opponentAfter);

    // The mover ends up winning, so the move costs them nothing.
    expect(winPct(moverAfter)).toBe(100);
    expect(toCp(moverBefore) - toCp(moverAfter)).toBeLessThanOrEqual(0);
  });
});

describe("move accuracy", () => {
  it("is full marks when nothing was lost", () => {
    expect(moveAccuracy(60, 60)).toBeCloseTo(100, 0);
  });

  it("is full marks when the position improved", () => {
    // A move cannot score above perfect for being lucky.
    expect(moveAccuracy(50, 70)).toBeCloseTo(100, 0);
  });

  it("falls as more win probability is thrown away", () => {
    const small = moveAccuracy(50, 48);
    const large = moveAccuracy(50, 20);
    expect(small).toBeGreaterThan(large);
  });

  it("approaches zero for a catastrophic move", () => {
    expect(moveAccuracy(95, 5)).toBeLessThan(5);
  });

  it("never leaves the 0-100 range", () => {
    for (const [before, after] of [
      [100, 0],
      [0, 100],
      [50, 50],
    ]) {
      const value = moveAccuracy(before!, after!);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });
});

describe("classification", () => {
  const label = (before: number, after: number, isBestMove = false) =>
    classify({ winPctBefore: before, winPctAfter: after, isBestMove });

  it("calls the engine's own choice best", () => {
    expect(label(50, 30, true)).toBe("best");
  });

  it("labels by how much win probability was lost", () => {
    expect(label(50, 49)).toBe("excellent");
    expect(label(50, 47)).toBe("good");
    expect(label(50, 43)).toBe("inaccuracy");
    expect(label(50, 35)).toBe("mistake");
    expect(label(50, 10)).toBe("blunder");
  });

  it("does not call a big centipawn drop in a won position a blunder", () => {
    // The heart of why classification keys on win probability. Going from
    // +900 to +600 is three pawns, but barely moves the win probability: the
    // position was winning and still is.
    const before = winPct(cp(900));
    const after = winPct(cp(600));
    expect(after).toBeGreaterThan(90);
    expect(label(before, after)).not.toBe("blunder");
  });

  it("does call a small centipawn drop across the balance point a blunder", () => {
    // +50 to -250 is the same three pawns, but it hands the game over.
    const before = winPct(cp(50));
    const after = winPct(cp(-250));
    expect(label(before, after)).toBe("blunder");
  });

  it("treats a move that improves the position as excellent", () => {
    expect(label(40, 60)).toBe("excellent");
  });

  it("uses the exported thresholds", () => {
    expect(label(50, 50 - THRESHOLDS.excellent + 0.1)).toBe("excellent");
    expect(label(50, 50 - THRESHOLDS.mistake - 0.1)).toBe("blunder");
  });
});

describe("game accuracy", () => {
  /** Moves of one colour, at the positions that colour actually played from. */
  const movesOf = (accuracies: number[], firstPly = 0) =>
    accuracies.map((accuracy, i) => ({
      accuracy,
      positionIndex: firstPly + i * 2,
    }));

  it("is unknown for a game with no moves", () => {
    expect(gameAccuracy([], [])).toBeUndefined();
  });

  it("is near perfect for a flawless game", () => {
    expect(
      gameAccuracy(movesOf(new Array(30).fill(100)), new Array(61).fill(50)),
    ).toBeCloseTo(100, 0);
  });

  it("is low for a game of constant errors", () => {
    expect(
      gameAccuracy(movesOf(new Array(30).fill(10)), new Array(61).fill(50)),
    ).toBeLessThan(30);
  });

  it("stays within 0-100", () => {
    const value = gameAccuracy(movesOf([0, 100, 50]), new Array(7).fill(50));
    expect(value!).toBeGreaterThanOrEqual(0);
    expect(value!).toBeLessThanOrEqual(100);
  });

  it("is dragged down by one catastrophe among good moves", () => {
    // The harmonic mean is what stops a single disaster hiding behind a run of
    // easy accurate moves.
    const wins = new Array(41).fill(50);
    const clean = gameAccuracy(movesOf(new Array(20).fill(95)), wins)!;
    const withBlunder = gameAccuracy(
      movesOf([...new Array(19).fill(95), 2]),
      wins,
    )!;
    expect(withBlunder).toBeLessThan(clean - 5);
  });

  it("weights errors in sharp positions above errors in quiet ones", () => {
    // Same move accuracies; different volatility around them.
    const moves = movesOf([95, 95, 40, 95, 95, 95, 95, 95, 95, 95]);
    const quiet = new Array(21).fill(50);
    const swinging = [
      50, 51, 52, 48, 20, 80, 30, 70, 45, 55, 50, 50, 50, 50, 50, 50, 50, 50,
      50, 50, 50,
    ];

    const inQuiet = gameAccuracy(moves, quiet)!;
    const inSharp = gameAccuracy(moves, swinging)!;
    expect(inSharp).not.toBeCloseTo(inQuiet, 3);
  });

  it("weights each colour by the volatility around its own moves", () => {
    // The bug this pins: mapping a colour-filtered list proportionally onto
    // the full position sequence weights Black's moves by White's volatility.
    // Here the game is calm early and wild late, and one poor move sits at
    // each end — so which end is weighted heavily decides the figure.
    const winPercents = [
      50, 50, 50, 50, 50, 50, 50, 50, 20, 80, 15, 85, 10, 90, 50, 50, 50, 50,
      50, 50, 50,
    ];
    const accuracies = [40, 95, 95, 95, 95, 95, 95, 95, 95, 40];

    // The same ten accuracies, read at the calm end versus the wild end.
    const early = gameAccuracy(
      accuracies.map((accuracy, i) => ({ accuracy, positionIndex: i })),
      winPercents,
    )!;
    const late = gameAccuracy(
      accuracies.map((accuracy, i) => ({ accuracy, positionIndex: i + 10 })),
      winPercents,
    )!;

    expect(early).not.toBeCloseTo(late, 3);
  });
});

describe("the cost of a losing blunder", () => {
  it("is a large positive number for the player who made it", () => {
    // A game-losing blunder must cost the mover, not credit them. This is the
    // single easiest thing to invert, and nothing downstream would complain.
    const beforeMoverPov = cp(50);
    // The engine reports the position after the move from the opponent's
    // perspective; normalising to the mover means negating it.
    const afterOpponentPov = cp(600);
    const afterMoverPov = invert(afterOpponentPov);

    const cpLoss = toCp(beforeMoverPov) - toCp(afterMoverPov);

    expect(cpLoss).toBe(650);
    expect(cpLoss).toBeGreaterThan(0);

    const drop = winPct(beforeMoverPov) - winPct(afterMoverPov);
    expect(drop).toBeGreaterThan(20);
    expect(
      classify({
        winPctBefore: winPct(beforeMoverPov),
        winPctAfter: winPct(afterMoverPov),
        isBestMove: false,
      }),
    ).toBe("blunder");
  });

  it("costs nothing when the mover keeps the position level", () => {
    const before = cp(20);
    const after = invert(cp(-20)); // opponent sees -20, so the mover sees +20
    expect(toCp(before) - toCp(after)).toBe(0);
  });

  it("is negative only when the mover actually improved", () => {
    const before = cp(0);
    const after = invert(cp(-100)); // mover is now +100
    expect(toCp(before) - toCp(after)).toBeLessThan(0);
  });
});

/**
 * One catastrophic move must not become the whole game.
 *
 * The harmonic mean is here to stop a run of easy moves hiding a disaster,
 * and it earns its place — the plain arithmetic mean rates these games ~88%,
 * which flatters them. But `moveAccuracy` returns exactly 0 for any move
 * throwing away 80 win-percentage points or more, and a single 0 makes the
 * reciprocal sum diverge: the harmonic mean collapses to ~0 and halves the
 * game's accuracy no matter how the other moves went.
 *
 * Measured on this project's own corpus: 41 of 423 analysed games contain a
 * zero-accuracy move, and each had its accuracy understated by roughly half.
 * One real game scored 39.5% from 25 moves whose mean was 88.5% — chess.com
 * rated the same game 77.6%, and chess.com was the closer of the two.
 */
describe("a single lost move", () => {
  /** 24 strong moves and one catastrophe: a good game with a blunder in it. */
  const oneBlunder = [
    87.78, 94.75, 0, 98.87, 97.52, 100, 90.49, 85.75, 93.75, 100, 83.52,
    95.57, 91.16, 85.2, 98.9, 96.36, 91.68, 97.61, 67.78, 97.51, 93.6, 97.66,
    79.4, 100, 87.86,
  ].map((accuracy, positionIndex) => ({ accuracy, positionIndex }));

  it("does not halve a game that was otherwise played well", () => {
    // The arithmetic mean of these moves is 88.5. A blunder should cost real
    // ground, but the result has to stay recognisably a strong game.
    const accuracy = gameAccuracy(oneBlunder, [])!;

    expect(accuracy).toBeGreaterThan(65);
  });

  it("still costs more than the blunder's share of the moves", () => {
    // One move in 25 is 4% of the game; the harmonic mean is supposed to
    // punish a catastrophe harder than its count. It must not become a
    // plain average.
    const accuracy = gameAccuracy(oneBlunder, [])!;

    expect(accuracy).toBeLessThan(88.5);
  });

  it("is barely moved by how far past the zero the move went", () => {
    // Accuracy saturates at 0 for any drop of 80 win-points or more, so a
    // game with one 0 and a game with one 0.5 are the same game. Before the
    // floor was raised these differed by 30 points.
    const nearZero = oneBlunder.map((m, i) =>
      i === 2 ? { accuracy: 0.5, positionIndex: i } : m,
    );

    const withZero = gameAccuracy(oneBlunder, [])!;
    const withNearZero = gameAccuracy(nearZero, [])!;

    expect(Math.abs(withZero - withNearZero)).toBeLessThan(2);
  });

  it("still ranks a game with two catastrophes below one with a single", () => {
    const twoBlunders = oneBlunder.map((m, i) =>
      i === 10 ? { accuracy: 0, positionIndex: i } : m,
    );

    expect(gameAccuracy(twoBlunders, [])!).toBeLessThan(
      gameAccuracy(oneBlunder, [])!,
    );
  });
});
