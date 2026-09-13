import { describe, it, expect } from "vitest";
import { syncOutcomeMessage } from "./sync-message";

/**
 * What the sync button says when a sync comes back. The incremental path made
 * this a real question: once complete months are skipped without a request, an
 * up-to-date re-sync returns zero stored — and zero skipped with it, because
 * `skipped` only counts games that were fetched and found already held.
 */

describe("reporting a sync", () => {
  it("says it downloaded the new games", () => {
    expect(syncOutcomeMessage(7)).toBe("Downloaded 7 new games.");
  });

  it("says 'game' when there was one", () => {
    expect(syncOutcomeMessage(1)).toBe("Downloaded 1 new game.");
  });

  it("reports an up-to-date corpus when nothing new was stored", () => {
    // The case the old rule got wrong. It asked for "nothing stored but
    // something skipped", which is false for the commonest sync there is:
    // every month complete, none fetched, nothing skipped either.
    expect(syncOutcomeMessage(0)).toBe("Already up to date.");
  });
});
