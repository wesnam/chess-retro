import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * The slow suite: tests that spawn a real Stockfish process.
 *
 * Kept out of the default run because a real search takes seconds and its
 * exact evaluations vary by engine version and hardware. Run with
 * `npm run test:slow`, and whenever the engine layer changes.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.slow.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // One engine process at a time keeps the machine usable and the timings
    // predictable.
    fileParallelism: false,
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
