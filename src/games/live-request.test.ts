import { describe, it, expect } from "vitest";
import { readLiveRequest } from "./live-request";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("reading a live-analysis request", () => {
  it("accepts a position and returns it", () => {
    expect(readLiveRequest({ fen: START })).toEqual({ fen: START });
  });

  it("refuses a position that is not a position", () => {
    // This string becomes a `position fen ...` command on the engine's stdin.
    // Anything that is not a board must be turned away here, not sent on to
    // be interpreted as whatever it happens to parse as.
    expect(readLiveRequest({ fen: "not a fen" })).toBeUndefined();
    expect(readLiveRequest({ fen: "" })).toBeUndefined();
    expect(readLiveRequest({})).toBeUndefined();
    expect(readLiveRequest({ fen: 42 })).toBeUndefined();
    expect(readLiveRequest(null)).toBeUndefined();
  });

  it("refuses a position carrying a newline, which would be a second command", () => {
    // UCI is a line protocol. A newline in the FEN ends the `position` command
    // and makes everything after it a command of the caller's choosing.
    expect(
      readLiveRequest({ fen: `${START}\nquit` }),
    ).toBeUndefined();
  });

  it("refuses a legal-looking board that chess.js reads as something else", () => {
    // A FEN with no kings parses as a board but is not a position any engine
    // can be asked about.
    expect(
      readLiveRequest({ fen: "8/8/8/8/8/8/8/8 w - - 0 1" }),
    ).toBeUndefined();
  });

  it("accepts a midgame position with no castling rights", () => {
    const fen = "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3";
    expect(readLiveRequest({ fen })).toEqual({ fen });
  });
});
