import { describe, expect, it } from "vitest";
import { parsePuzzleRow, parseThemes, MIN_POPULARITY } from "./parse";

/**
 * Rows taken verbatim from the real lichess_db_puzzle.csv, so the parser is
 * tested against the file it will actually read rather than a shape invented
 * here. The header is included because the stream hands it over like any other
 * line and it must be rejected rather than stored as a puzzle called
 * "PuzzleId".
 */
const HEADER =
  "PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags,DailyDate";

const REAL_ROW =
  "00008,r6k/pp2r2p/4Rp1Q/3p4/8/1N1P2R1/PqP2bPP/7K b - - 0 24,f2g3 e6e7 b2b1 b3c1 b1c1 h6c1,1797,76,95,10183,crushing hangingPiece long middlegame,https://lichess.org/787zsVup/black#48,,";

describe("parsePuzzleRow", () => {
  it("reads every column of a real row", () => {
    const puzzle = parsePuzzleRow(REAL_ROW);

    expect(puzzle).toEqual({
      id: "00008",
      fen: "r6k/pp2r2p/4Rp1Q/3p4/8/1N1P2R1/PqP2bPP/7K b - - 0 24",
      movesUci: "f2g3 e6e7 b2b1 b3c1 b1c1 h6c1",
      rating: 1797,
      ratingDeviation: 76,
      popularity: 95,
      nbPlays: 10183,
      gameUrl: "https://lichess.org/787zsVup/black#48",
      themes: ["crushing", "hangingPiece", "long", "middlegame"],
    });
  });

  it("rejects the header row", () => {
    expect(parsePuzzleRow(HEADER)).toBeUndefined();
  });

  it("rejects blank and short rows rather than storing a broken puzzle", () => {
    expect(parsePuzzleRow("")).toBeUndefined();
    expect(parsePuzzleRow("   ")).toBeUndefined();
    expect(parsePuzzleRow("00008,r6k/7K b - - 0 24,f2g3")).toBeUndefined();
  });

  it("rejects a row whose rating is not a number", () => {
    const bad = REAL_ROW.replace(",1797,", ",notarating,");
    expect(parsePuzzleRow(bad)).toBeUndefined();
  });

  /**
   * A puzzle with no solution move cannot be played: `movesUci[0]` is the
   * setup move, so a single-move entry leaves nothing to solve after it is
   * applied.
   */
  it("rejects a puzzle with no move after the setup move", () => {
    const bad = REAL_ROW.replace(
      "f2g3 e6e7 b2b1 b3c1 b1c1 h6c1",
      "f2g3",
    );
    expect(parsePuzzleRow(bad)).toBeUndefined();
  });

  it("treats an empty optional column as absent rather than zero", () => {
    const row =
      "0000D,5rk1/1p3ppp/pq3b2/8/8/1P1Q1N2/P4PPP/3R2K1 w - - 2 27,d3d6 f8d8 d6d8 f6d8,1468,,96,,advantage endgame short,,,";
    const puzzle = parsePuzzleRow(row);

    expect(puzzle?.ratingDeviation).toBeUndefined();
    expect(puzzle?.nbPlays).toBeUndefined();
    expect(puzzle?.gameUrl).toBeUndefined();
    // Popularity is required — it is a filter, and a missing value must not
    // read as a well-liked puzzle.
    expect(puzzle?.popularity).toBe(96);
  });
});

describe("parseThemes", () => {
  it("splits on whitespace and drops empties", () => {
    expect(parseThemes("crushing hangingPiece  long ")).toEqual([
      "crushing",
      "hangingPiece",
      "long",
    ]);
  });

  it("returns nothing for an untagged puzzle", () => {
    expect(parseThemes("")).toEqual([]);
  });
});

describe("MIN_POPULARITY", () => {
  /**
   * Lichess popularity runs -100..100 and is the community's own verdict on
   * whether a puzzle is worth solving. The floor exists so practice material
   * is good; pinning it here stops it drifting silently.
   */
  it("keeps a well-liked puzzle and drops a disliked one", () => {
    expect(95).toBeGreaterThanOrEqual(MIN_POPULARITY);
    expect(-20).toBeLessThan(MIN_POPULARITY);
  });
});
