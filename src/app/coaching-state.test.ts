import { describe, it, expect } from "vitest";
import { nextCoachingState } from "./coaching-state";

/**
 * What the coaching panel settles on when there is no coaching.
 *
 * Running without an API key is a supported way to use this app, so the
 * no-key path has to end somewhere honest. The panel starts on "Writing your
 * coaching…" — correct while a request is in flight, and a lie the moment the
 * answer is "there is no coach". `/api/coach` says so in the body rather than
 * by failing (it is a missing enhancement, not an error), so the decision is
 * made from a 200 response and is easy to get wrong.
 */

const RAPID = "rapid";

describe("settling the coaching panel", () => {
  it("is unavailable when no key is configured", () => {
    // What /api/coach actually returns with ANTHROPIC_API_KEY unset.
    const state = nextCoachingState(
      { timeClass: RAPID, coaching: null, cached: false, reason: "unavailable" },
      RAPID,
    );

    expect(state.status).toBe("unavailable");
  });

  it("is unavailable when there is nothing worth explaining", () => {
    const state = nextCoachingState(
      { timeClass: RAPID, coaching: null, cached: false, reason: "nothing-to-explain" },
      RAPID,
    );

    expect(state.status).toBe("unavailable");
  });

  it("is unavailable when the coaching describes another time control", () => {
    // Prose about blitz beside rapid numbers is worse than no prose at all.
    const state = nextCoachingState(
      {
        timeClass: "blitz",
        cached: false,
        reason: null,
        coaching: {
          weaknesses: [{ key: "hangingPiece", explanation: "e", why: "w" }],
          practice: undefined,
        },
      },
      RAPID,
    );

    expect(state.status).toBe("unavailable");
  });

  it("is ready when coaching arrives for the control on screen", () => {
    const state = nextCoachingState(
      {
        timeClass: RAPID,
        cached: false,
        reason: null,
        coaching: {
          weaknesses: [{ key: "hangingPiece", explanation: "e", why: "w" }],
          practice: undefined,
        },
      },
      RAPID,
    );

    expect(state.status).toBe("ready");
    expect(state.byKey.get("hangingPiece")).toEqual({ explanation: "e", why: "w" });
  });

  it("never settles on loading, whatever the body says", () => {
    // The panel shows "Writing your coaching…" while loading, so any response
    // that leaves it there is a spinner that never resolves.
    const bodies = [
      { timeClass: RAPID, coaching: null, cached: false, reason: "unavailable" },
      { timeClass: RAPID, coaching: null, cached: false, reason: "failed" },
      { timeClass: RAPID, coaching: null, cached: false, reason: "rejected" },
      { timeClass: "blitz", coaching: null, cached: false, reason: null },
    ];

    for (const body of bodies) {
      expect(nextCoachingState(body, RAPID).status).not.toBe("loading");
    }
  });
});
