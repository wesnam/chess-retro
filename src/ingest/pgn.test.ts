import { describe, it, expect } from "vitest";
import {
  openingNameFromEcoUrl,
  parseClockMs,
  parseIncrementMs,
  parsePgn,
} from "./pgn";
import archive from "./__fixtures__/archive-2024-03.json";

const firstPgn = archive.games[0]!.pgn;

describe("clock parsing", () => {
  it("reads a whole-second clock", () => {
    expect(parseClockMs("[%clk 0:03:00]")).toBe(180_000);
  });

  it("reads the decimal precision fast time controls use", () => {
    expect(parseClockMs("[%clk 0:02:58.7]")).toBe(178_700);
  });

  it("reads clocks over an hour", () => {
    expect(parseClockMs("[%clk 1:30:00]")).toBe(5_400_000);
  });

  it("returns nothing for a comment with no clock", () => {
    expect(parseClockMs("a fine move")).toBeUndefined();
    expect(parseClockMs("")).toBeUndefined();
  });
});

describe("increment parsing", () => {
  it("is zero when the time control has no increment", () => {
    expect(parseIncrementMs("180")).toBe(0);
  });

  it("reads the increment in milliseconds", () => {
    expect(parseIncrementMs("600+5")).toBe(5_000);
  });

  it("is zero for a missing or odd time control", () => {
    expect(parseIncrementMs(undefined)).toBe(0);
    expect(parseIncrementMs("1/259200")).toBe(0);
  });
});

describe("opening name", () => {
  it("reads a readable name out of chess.com's ECO url", () => {
    expect(
      openingNameFromEcoUrl(
        "https://www.chess.com/openings/Sicilian-Defense-2.Nf3-d6",
      ),
    ).toBe("Sicilian Defense 2.Nf3 d6");
  });

  it("returns nothing when there is no url", () => {
    expect(openingNameFromEcoUrl(undefined)).toBeUndefined();
  });
});

describe("parsing a real chess.com PGN", () => {
  const parsed = parsePgn(firstPgn);

  it("reads the headers we depend on", () => {
    expect(parsed.eco).toBe("B50");
    expect(parsed.timeControl).toBe("180");
    expect(parsed.openingName).toMatch(/Sicilian Defense/);
  });

  it("extracts every move", () => {
    expect(parsed.moves.length).toBeGreaterThan(50);
  });

  it("numbers plies from one, alternating colour", () => {
    expect(parsed.moves[0]).toMatchObject({ ply: 1, color: "w", san: "e4" });
    expect(parsed.moves[1]).toMatchObject({ ply: 2, color: "b" });
    expect(parsed.moves[2]).toMatchObject({ ply: 3, color: "w" });
  });

  it("records the position before each move, not after", () => {
    // The first move is played from the starting position.
    expect(parsed.moves[0]!.fenBefore).toMatch(
      /^rnbqkbnr\/pppppppp\/8\/8\/8\/8\/PPPPPPPP\/RNBQKBNR w/,
    );
  });

  it("records UCI alongside SAN, since the engine speaks UCI", () => {
    expect(parsed.moves[0]!.uci).toBe("e2e4");
  });

  it("records the moving piece", () => {
    expect(parsed.moves[0]!.piece).toBe("p");
  });

  it("attaches a clock reading to every move of a timed game", () => {
    const withClock = parsed.moves.filter((m) => m.clockMs !== undefined);
    expect(withClock.length).toBe(parsed.moves.length);
  });

  it("starts both players at the full time control", () => {
    expect(parsed.moves[0]!.clockMs).toBe(180_000);
    expect(parsed.moves[1]!.clockMs).toBe(180_000);
  });

  it("cannot know time spent on a player's first move", () => {
    // There is no earlier reading to subtract from.
    expect(parsed.moves[0]!.moveTimeMs).toBeUndefined();
    expect(parsed.moves[1]!.moveTimeMs).toBeUndefined();
  });

  it("derives time spent from the drop in that player's own clock", () => {
    // White: 180.0s before, 178.7s after their second move.
    expect(parsed.moves[2]!.moveTimeMs).toBe(1_300);
  });

  it("never reports negative time spent", () => {
    for (const move of parsed.moves) {
      if (move.moveTimeMs !== undefined) {
        expect(move.moveTimeMs).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("time spent with an increment", () => {
  it("adds the increment back before measuring the drop", () => {
    // With a 5s increment, a clock that rises by 3s means 2s were spent.
    const pgn = [
      '[Event "Test"]',
      '[TimeControl "600+5"]',
      "",
      "1. e4 {[%clk 0:10:00]} 1... e5 {[%clk 0:10:00]}",
      "2. Nf3 {[%clk 0:10:03]} 2... Nc6 {[%clk 0:10:03]} *",
    ].join("\n");

    const parsed = parsePgn(pgn);
    expect(parsed.moves[2]!.moveTimeMs).toBe(2_000);
  });
});

describe("gaps and anomalies in the clock record", () => {
  it("does not charge a move for a gap in that player's clocks", () => {
    // White's second move has no clock. Without forgetting the stale reading,
    // White's third move would be charged for both moves' time.
    const pgn = [
      '[Event "Test"]',
      '[TimeControl "600"]',
      "",
      "1. e4 {[%clk 0:10:00]} 1... e5 {[%clk 0:10:00]}",
      "2. Nf3 2... Nc6 {[%clk 0:09:50]}",
      "3. Bb5 {[%clk 0:09:40]} 3... a6 {[%clk 0:09:45]} *",
    ].join("\n");

    const parsed = parsePgn(pgn);

    // White's 2nd move (ply 3) has no reading of its own.
    expect(parsed.moves[2]!.clockMs).toBeUndefined();
    // White's 3rd move (ply 5) cannot be measured, since the previous
    // reading is unknown — not charged the full 20s since 10:00.
    expect(parsed.moves[4]!.moveTimeMs).toBeUndefined();
  });

  it("clamps to zero rather than discarding an instant move", () => {
    // A clock that rises by more than the increment is not trustworthy, but
    // the move was still played instantly.
    const pgn = [
      '[Event "Test"]',
      '[TimeControl "600"]',
      "",
      "1. e4 {[%clk 0:10:00]} 1... e5 {[%clk 0:10:00]}",
      "2. Nf3 {[%clk 0:10:05]} 2... Nc6 {[%clk 0:09:55]} *",
    ].join("\n");

    const parsed = parsePgn(pgn);
    expect(parsed.moves[2]!.moveTimeMs).toBe(0);
  });
});

describe("a game with no clocks at all", () => {
  it("parses the moves and leaves the clocks empty", () => {
    const pgn = ['[Event "Test"]', "", "1. e4 e5 2. Nf3 *"].join("\n");
    const parsed = parsePgn(pgn);

    expect(parsed.moves.map((m) => m.san)).toEqual(["e4", "e5", "Nf3"]);
    expect(parsed.moves.every((m) => m.clockMs === undefined)).toBe(true);
  });
});
