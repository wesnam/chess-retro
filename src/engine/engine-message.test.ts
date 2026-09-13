import { describe, it, expect } from "vitest";
import { engineErrorMessage } from "./engine-message";

/**
 * What someone is told when the engine will not start.
 *
 * This is the first wall a person hits on a fresh clone — analysis is the one
 * step that needs a dependency they have to install themselves — so the
 * message is part of the setup instructions, not an afterthought.
 */

describe("reporting an engine failure", () => {
  it("keeps the install hint that the missing-binary error already carries", () => {
    const message = engineErrorMessage(
      'Could not find the engine at "stockfish". Install it with: brew install stockfish',
    );

    expect(message).toContain("brew install stockfish");
    // Said once. The route used to append its own copy of the hint to an
    // error that already ended with one, so a newcomer read "Install it with:
    // brew install stockfish Is Stockfish installed? Try: brew install
    // stockfish" — the same advice twice in one sentence.
    expect(message.match(/brew install stockfish/g)).toHaveLength(1);
  });

  it("adds the hint when the failure does not already explain itself", () => {
    const message = engineErrorMessage("Engine failed: EACCES");

    expect(message).toContain("Engine failed: EACCES");
    expect(message).toContain("brew install stockfish");
  });

  it("does not blame a missing install for an engine that is plainly running", () => {
    // "Is Stockfish installed?" is wrong and misleading here: it started, it
    // answered, it simply took too long. Sending someone to reinstall it
    // wastes their time on the wrong problem.
    const message = engineErrorMessage("Engine did not respond within 120000ms");

    expect(message).toContain("did not respond");
    expect(message).not.toContain("brew install");
  });
});
