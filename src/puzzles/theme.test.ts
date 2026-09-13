import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { legalDests, practiceTheme } from "./theme";

/**
 * Which weaknesses can be practised, and the legal-move map the board needs.
 */

describe("practiceTheme", () => {
  /**
   * The whole feature rests on this: a motif key IS a Lichess theme string, so
   * matching puzzles is a direct lookup with no translation table.
   */
  it("returns the theme of a motif weakness", () => {
    expect(practiceTheme({ dimension: "motif", key: "fork" })).toBe("fork");
    expect(practiceTheme({ dimension: "motif", key: "backRankMate" })).toBe(
      "backRankMate",
    );
  });

  /**
   * The dangerous case, and the reason this is a function rather than a field
   * read. A phase weakness has the key "opening" or "endgame" — both of which
   * ARE real Lichess puzzle themes. A bare key lookup would silently serve
   * "endgame" puzzles for a weakness that is about how this player handles
   * endgames, not about a tactic they miss, and the page would look like it
   * was working.
   */
  it("refuses a phase weakness even though its key is a real Lichess theme", () => {
    expect(practiceTheme({ dimension: "phase", key: "endgame" })).toBeUndefined();
    expect(practiceTheme({ dimension: "phase", key: "opening" })).toBeUndefined();
  });

  it("refuses every other non-motif dimension", () => {
    expect(practiceTheme({ dimension: "piece", key: "n" })).toBeUndefined();
    expect(practiceTheme({ dimension: "time", key: "scramble" })).toBeUndefined();
    expect(
      practiceTheme({ dimension: "opening", key: "Sicilian Defense" }),
    ).toBeUndefined();
  });

  /**
   * A motif the detectors cannot emit has no puzzles to match, and a practice
   * link to an empty set is worse than no link.
   */
  it("refuses a motif that is not in the known vocabulary", () => {
    expect(practiceTheme({ dimension: "motif", key: "invented" })).toBeUndefined();
  });
});

describe("legalDests", () => {
  it("maps each square to the squares its piece may reach", () => {
    const dests = legalDests(new Chess().fen());

    expect(dests.get("e2")).toContain("e4");
    expect(dests.get("g1")).toContain("f3");
    // A blocked piece has no entry rather than an empty one.
    expect(dests.get("c1")).toBeUndefined();
  });

  /**
   * chessground allows any move it is not told is illegal, so a board handed
   * no map lets a solver drag a bishop like a rook and calls it wrong.
   */
  it("only offers moves for the side to move", () => {
    const dests = legalDests(new Chess().fen());
    expect(dests.get("e7")).toBeUndefined();
  });

  it("respects a position where the king is in check", () => {
    // Black is checked by the queen on h5 and must answer it.
    const dests = legalDests(
      "rnbqkbnr/pppp1ppp/8/4p2Q/4P3/8/PPPP1PPP/RNB1KBNR b KQkq - 0 1",
    );

    // Only the moves that answer the check exist at all.
    expect(dests.get("e5")).toBeUndefined();
    expect(dests.get("g7")).toContain("g6");
  });
});
