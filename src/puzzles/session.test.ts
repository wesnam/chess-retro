import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { openPuzzle, playMove, type PuzzlePosition } from "./session";

/**
 * A real puzzle from the Lichess database, kept whole so the setup-move rule
 * is tested against published data rather than a position invented to suit the
 * implementation.
 *
 * FEN is the position BEFORE the setup move. Black plays f2g3; only then is it
 * White to move, and White's Re6-e7 is the answer.
 */
const PUZZLE = {
  id: "00008",
  fen: "r6k/pp2r2p/4Rp1Q/3p4/8/1N1P2R1/PqP2bPP/7K b - - 0 24",
  movesUci: "f2g3 e6e7 b2b1 b3c1 b1c1 h6c1",
  rating: 1797,
};

describe("openPuzzle", () => {
  /**
   * The single detail the ticket calls out as reliably caught: the stored
   * position is the one before the opponent's setup move, so a puzzle shown
   * at `fen` is one move too early and makes no sense.
   */
  it("applies the setup move before the puzzle is shown", () => {
    const position = openPuzzle(PUZZLE)!;

    expect(position.fen).not.toBe(PUZZLE.fen);

    const board = new Chess(PUZZLE.fen);
    board.move({ from: "f2", to: "g3", promotion: "q" });
    expect(position.fen).toBe(board.fen());
  });

  it("shows the setup move as the last move, so it can be highlighted", () => {
    expect(openPuzzle(PUZZLE)!.lastMove).toEqual(["f2", "g3"]);
  });

  /**
   * The side to move after the setup move is the side the solver plays, and
   * the board must be oriented to face them. Getting this from the raw FEN
   * would orient it for the opponent on every puzzle.
   */
  it("orients the board for the side that must solve it", () => {
    // Black plays the setup move, so White solves and faces the board.
    expect(openPuzzle(PUZZLE)!.orientation).toBe("white");
  });

  it("starts unsolved with no moves played", () => {
    const position = openPuzzle(PUZZLE)!;
    expect(position.status).toBe("solving");
    expect(position.solvedPlies).toBe(0);
  });
});

describe("playMove", () => {
  it("accepts the solution move and advances past the opponent's reply", () => {
    const position = openPuzzle(PUZZLE)!;
    const next = playMove(position, "e6", "e7");

    expect(next.status).toBe("solving");
    // The solver's move AND the opponent's scripted answer are both applied,
    // so the board is back on the solver's turn.
    expect(next.solvedPlies).toBe(2);
    expect(next.lastMove).toEqual(["b2", "b1"]);
    expect(new Chess(next.fen).turn()).toBe("w");
  });

  it("solves the puzzle when the last move of the line is played", () => {
    let position = openPuzzle(PUZZLE)!;
    position = playMove(position, "e6", "e7"); // solution 1
    position = playMove(position, "b3", "c1"); // solution 2
    position = playMove(position, "h6", "c1"); // solution 3, the last

    expect(position.status).toBe("solved");
  });

  /**
   * A wrong move must not advance the puzzle, and the solution has to be
   * available to show — the ticket asks for the answer when they get one
   * wrong, and a board left on the wrong move cannot demonstrate it.
   */
  it("rejects a wrong move and names the move that was right", () => {
    const position = openPuzzle(PUZZLE)!;
    const next = playMove(position, "g3", "g6");

    expect(next.status).toBe("failed");
    expect(next.solution).toEqual(["e6", "e7"]);
    // The position is unchanged: the wrong move is not played onto the board.
    expect(next.fen).toBe(position.fen);
  });

  it("rejects a move that is not legal at all", () => {
    const next = playMove(openPuzzle(PUZZLE)!, "a1", "a8");
    expect(next.status).toBe("failed");
  });

  /**
   * Once a puzzle is finished it stays finished. Without this a solver could
   * keep moving on a solved board, and an attempt already recorded as failed
   * could be walked forward into a pass.
   */
  it("ignores moves once the puzzle is over", () => {
    const failed = playMove(openPuzzle(PUZZLE)!, "g3", "g6");
    expect(playMove(failed, "e6", "e7")).toBe(failed);
  });

  /**
   * Every published puzzle has an even number of moves: the setup move, then
   * solver/opponent pairs, ending on a solver move. Verified over the real
   * database — 91,715 puzzles, every one even. This pins the assumption behind
   * the solved check, which reads "the line has run out".
   */
  it("solves on the last move of a two-move line, the shortest there is", () => {
    const shortest = {
      id: "short",
      fen: "r6k/pp2r2p/4Rp1Q/3p4/8/1N1P2R1/PqP2bPP/7K b - - 0 24",
      movesUci: "f2g3 e6e7",
      rating: 1000,
    };

    const position = playMove(openPuzzle(shortest)!, "e6", "e7");
    expect(position.status).toBe("solved");
  });

  it("treats a promotion as the queen the database records", () => {
    // A puzzle whose solution promotes: the mover must not be asked which
    // piece, since the recorded line settles it.
    const promo = {
      id: "promo",
      fen: "7k/P7/8/8/8/8/8/6K1 b - - 0 1",
      movesUci: "h8h7 a7a8q",
      rating: 1000,
    };
    const position = openPuzzle(promo)!;
    const next = playMove(position, "a7", "a8");

    expect(next.status).toBe("solved");
  });

  /**
   * Nothing validates a row's FEN or its moves at import, so one corrupt row
   * among six million reaches the page. `openPuzzle` runs inside a render
   * effect with no error boundary above it, so a throw blanks the practice
   * page — and since puzzles are drawn at random, refreshing appears to fix
   * it. Undefined lets the caller skip to the next puzzle instead.
   */
  it("returns nothing for a puzzle it cannot open, rather than throwing", () => {
    expect(
      openPuzzle({ id: "bad-fen", fen: "not a fen", movesUci: "e2e4 e7e5", rating: 1 }),
    ).toBeUndefined();

    expect(
      openPuzzle({
        id: "illegal-setup",
        fen: "r6k/pp2r2p/4Rp1Q/3p4/8/1N1P2R1/PqP2bPP/7K b - - 0 24",
        // a1a8 is not a legal move in this position.
        movesUci: "a1a8 e6e7",
        rating: 1,
      }),
    ).toBeUndefined();
  });
});

describe("a puzzle position", () => {
  it("never exposes the raw stored FEN as something to display", () => {
    const position: PuzzlePosition = openPuzzle(PUZZLE)!;
    // Guards the one mistake this whole module exists to prevent.
    expect(position.fen).not.toBe(PUZZLE.fen);
  });
});
