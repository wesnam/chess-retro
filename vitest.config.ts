import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    // Tests are colocated with the code they cover.
    include: ["src/**/*.test.ts"],
    // Engine tests spawn a real Stockfish binary; they are slow and excluded
    // from the default run.
    exclude: ["**/node_modules/**", "src/**/*.slow.test.ts"],
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
