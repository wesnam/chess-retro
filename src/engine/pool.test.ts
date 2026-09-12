import { describe, it, expect } from "vitest";
import { poolSize } from "./pool";

describe("poolSize", () => {
  it("leaves one core free so the machine stays usable", () => {
    expect(poolSize(10)).toBe(9);
    expect(poolSize(4)).toBe(3);
  });

  it("still returns a working pool on a single-core machine", () => {
    expect(poolSize(1)).toBe(1);
    expect(poolSize(0)).toBe(1);
  });
});
