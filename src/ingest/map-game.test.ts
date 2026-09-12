import { describe, it, expect } from "vitest";
import {
  mapGame,
  NotThisUsersGameError,
  openingFamilyOf,
  resultFor,
  UnusableGameError,
} from "./map-game";
import type { ChesscomGame } from "./chesscom";
import archive from "./__fixtures__/archive-2024-03.json";

const fixtures = archive.games as ChesscomGame[];
const findByWhite = (name: string) =>
  fixtures.find((g) => g.white?.username?.toLowerCase() === name.toLowerCase())!;

describe("result from the user's perspective", () => {
  it("reads a win as a win", () => {
    expect(resultFor("win")).toBe("win");
  });

  it.each(["resigned", "checkmated", "timeout", "abandoned", "lose"])(
    "reads %s as a loss",
    (raw) => {
      expect(resultFor(raw)).toBe("loss");
    },
  );

  it.each([
    "agreed",
    "repetition",
    "stalemate",
    "insufficient",
    "50move",
    "timevsinsufficient",
  ])("reads %s as a draw", (raw) => {
    expect(resultFor(raw)).toBe("draw");
  });

  it("reports an unknown token rather than guessing", () => {
    // Guessing "loss" would quietly depress every measured figure if
    // chess.com added a draw token we did not know about.
    expect(resultFor(undefined)).toBeUndefined();
    expect(resultFor("some_new_token")).toBeUndefined();
  });
});

describe("opening family", () => {
  it("keeps the family and drops the move detail", () => {
    expect(openingFamilyOf("Sicilian Defense 2.Nf3 d6 3.Bc4")).toBe(
      "Sicilian Defense",
    );
  });

  it("returns the whole name when there is no move detail", () => {
    expect(openingFamilyOf("Kings Gambit")).toBe("Kings Gambit");
  });

  it("returns nothing for a missing name", () => {
    expect(openingFamilyOf(undefined)).toBeUndefined();
  });
});

describe("colour attribution", () => {
  it("attributes a game the user played as White", () => {
    const { game } = mapGame(findByWhite("Hikaru"), "hikaru");

    expect(game.userColor).toBe("w");
    expect(game.userResult).toBe("win");
    expect(game.opponentUsername).toBe("Robert_Angier");
  });

  it("attributes a game the user played as Black just as well", () => {
    // The same fixture game, read from the other player's point of view.
    const { game } = mapGame(findByWhite("Hikaru"), "robert_angier");

    expect(game.userColor).toBe("b");
    expect(game.userResult).toBe("loss");
    expect(game.opponentUsername).toBe("Hikaru");
  });

  it("matches the username regardless of case", () => {
    // chess.com reports "Hikaru"; we store and query lowercase.
    expect(() => mapGame(findByWhite("Hikaru"), "hikaru")).not.toThrow();
  });

  it("refuses a game the user did not play in", () => {
    expect(() => mapGame(findByWhite("Hikaru"), "someone_else")).toThrow(
      NotThisUsersGameError,
    );
  });

  it("takes ratings and accuracies from the right side of the board", () => {
    const raw = findByWhite("Hikaru");
    const asWhite = mapGame(raw, "hikaru").game;
    const asBlack = mapGame(raw, "robert_angier").game;

    expect(asWhite.userRating).toBe(raw.white!.rating);
    expect(asWhite.opponentRating).toBe(raw.black!.rating);
    expect(asBlack.userRating).toBe(raw.black!.rating);
    expect(asBlack.opponentRating).toBe(raw.white!.rating);

    expect(asWhite.ccAccuracyUser).toBe(raw.accuracies!.white);
    expect(asBlack.ccAccuracyUser).toBe(raw.accuracies!.black);
  });
});

describe("game metadata", () => {
  it("records the time class", () => {
    const blitz = fixtures.find((g) => g.time_class === "blitz")!;
    const bullet = fixtures.find((g) => g.time_class === "bullet")!;

    expect(mapGame(blitz, blitz.white!.username!.toLowerCase()).game.timeClass).toBe("blitz");
    expect(mapGame(bullet, bullet.white!.username!.toLowerCase()).game.timeClass).toBe("bullet");
  });

  it("records a draw as a draw for both players", () => {
    const drawn = fixtures.find((g) => g.white?.result === "agreed");
    if (!drawn) return; // fixture set has no drawn game

    expect(mapGame(drawn, drawn.white!.username!.toLowerCase()).game.userResult).toBe("draw");
    expect(mapGame(drawn, drawn.black!.username!.toLowerCase()).game.userResult).toBe("draw");
  });

  it("carries the moves through", () => {
    const { moves } = mapGame(findByWhite("Hikaru"), "hikaru");
    expect(moves.length).toBeGreaterThan(50);
  });
});

describe("chess.com's own accuracy", () => {
  it("is stored when chess.com computed it", () => {
    const withAccuracy = fixtures.find((g) => g.accuracies)!;
    const { game } = mapGame(
      withAccuracy,
      withAccuracy.white!.username!.toLowerCase(),
    );
    expect(game.ccAccuracyUser).toBeTypeOf("number");
  });

  it("is null on the games chess.com never reviewed", () => {
    const without = fixtures.find((g) => !g.accuracies);
    if (!without) return; // fixture set has no such game

    const { game } = mapGame(without, without.white!.username!.toLowerCase());
    expect(game.ccAccuracyUser).toBeNull();
    expect(game.ccAccuracyOpponent).toBeNull();
  });
});

describe("games we cannot use", () => {
  const base = findByWhite("Hikaru");

  it("skips variants, whose rules would corrupt the analysis", () => {
    expect(() =>
      mapGame({ ...base, rules: "chess960" }, "hikaru"),
    ).toThrow(UnusableGameError);
  });

  it("skips a game with no PGN", () => {
    expect(() => mapGame({ ...base, pgn: undefined }, "hikaru")).toThrow(
      UnusableGameError,
    );
  });

  it("skips a game with no id", () => {
    expect(() => mapGame({ ...base, uuid: undefined }, "hikaru")).toThrow(
      UnusableGameError,
    );
  });

  it("skips a PGN the parser cannot read, rather than throwing raw", () => {
    // chess.js raises its own parser error; if it escaped as-is the caller
    // could not tell a bad game from a bug, and would abort the sync.
    const broken = { ...base, pgn: '[Event "x"]\n\n1. zz9 ??' };
    expect(() => mapGame(broken, "hikaru")).toThrow(UnusableGameError);
  });

  it("skips a game whose result token we do not recognise", () => {
    const odd = {
      ...base,
      white: { ...base.white, result: "some_new_token" },
    };
    expect(() => mapGame(odd, "hikaru")).toThrow(UnusableGameError);
  });
});
