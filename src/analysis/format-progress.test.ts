import { describe, it, expect } from "vitest";
import { formatDuration, formatRate } from "./format-progress";

describe("formatDuration", () => {
  it("says less than a minute rather than a bare zero", () => {
    expect(formatDuration(30_000)).toBe("under a minute");
  });

  it("counts whole minutes", () => {
    expect(formatDuration(5 * 60_000)).toBe("5 min");
  });

  it("switches to hours and minutes for a long run", () => {
    expect(formatDuration(90 * 60_000)).toBe("1h 30m");
  });

  it("drops the minutes when there are none", () => {
    expect(formatDuration(2 * 60 * 60_000)).toBe("2h");
  });

  it("has nothing to say about an unknown duration", () => {
    expect(formatDuration(undefined)).toBe("—");
  });
});

describe("formatRate", () => {
  it("reports games per minute when that reads naturally", () => {
    // Two games a minute.
    expect(formatRate(2 / 60_000)).toBe("2.0 games/min");
  });

  it("reports games per hour when the rate is slow", () => {
    // A game every ten minutes is clearer as six an hour.
    expect(formatRate(1 / (10 * 60_000))).toBe("6 games/hr");
  });

  it("has nothing to say before a rate is known", () => {
    expect(formatRate(undefined)).toBe("—");
  });
});
