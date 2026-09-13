import { describe, it, expect } from "vitest";
import { syncOutcomeMessage } from "./sync-message";

/**
 * What the sync button says when a sync comes back. The incremental path made
 * this a real question: once complete months are skipped without a request, an
 * up-to-date re-sync returns zeros across the board — including `skipped`,
 * which only counts games that were actually fetched and found already held.
 */

describe("reporting a sync", () => {
  it("says it downloaded the new games", () => {
    expect(syncOutcomeMessage({ stored: 7, skipped: 0, monthsFetched: [] })).toBe(
      "Downloaded 7 new games.",
    );
  });

  it("says 'game' when there was one", () => {
    expect(syncOutcomeMessage({ stored: 1, skipped: 0, monthsFetched: [] })).toBe(
      "Downloaded 1 new game.",
    );
  });

  it("reports an up-to-date corpus when a month was fetched and held nothing new", () => {
    expect(
      syncOutcomeMessage({ stored: 0, skipped: 12, monthsFetched: ["2024-03"] }),
    ).toBe("Already up to date.");
  });

  it("reports an up-to-date corpus when every month was skipped without a request", () => {
    // The incremental path's normal quiet case: complete months are not
    // refetched, so nothing is stored AND nothing is skipped. Reading that as
    // "Downloaded 0 new games" tells someone their sync did nothing useful,
    // when in fact it confirmed there was nothing to do.
    expect(
      syncOutcomeMessage({ stored: 0, skipped: 0, monthsFetched: [] }),
    ).toBe("Already up to date.");
  });

  it("reports an up-to-date corpus when the current month was re-checked and had nothing new", () => {
    expect(
      syncOutcomeMessage({ stored: 0, skipped: 0, monthsFetched: ["2024-03"] }),
    ).toBe("Already up to date.");
  });
});
