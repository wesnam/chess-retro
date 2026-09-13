import { describe, it, expect } from "vitest";
import { DEFAULT_MODEL, resolveModel } from "./model";

/**
 * Which model writes the coaching.
 *
 * Sonnet 5 is the default: the task is rephrasing statistics that deterministic
 * code has already computed, `validate.ts` drops anything unsupported, and on
 * the real corpus Sonnet matched Opus on every gate at roughly a third of the
 * cost. Overridable because that is a judgement, not a fact, and reverting it
 * should not need a code change.
 */

describe("choosing the coaching model", () => {
  it("defaults to Sonnet 5", () => {
    expect(DEFAULT_MODEL).toBe("claude-sonnet-5");
    expect(resolveModel(undefined)).toBe("claude-sonnet-5");
  });

  it("takes an override from the environment", () => {
    expect(resolveModel("claude-opus-5")).toBe("claude-opus-5");
  });

  it("ignores blank or whitespace overrides", () => {
    // An empty variable is how a shell reports "unset" often enough to matter,
    // and sending "" as a model id is a 400 at request time rather than here.
    expect(resolveModel("")).toBe(DEFAULT_MODEL);
    expect(resolveModel("   ")).toBe(DEFAULT_MODEL);
  });

  it("trims an override, since a trailing newline is easy to paste", () => {
    expect(resolveModel(" claude-opus-5\n")).toBe("claude-opus-5");
  });
});
