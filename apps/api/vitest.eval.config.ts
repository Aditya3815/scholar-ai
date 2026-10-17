import { defineConfig } from "vitest/config";

// Separate from the unit-test run (`npm test`): the eval is slower and talks to recorded or live APIs.
export default defineConfig({
  test: {
    include: ["eval/**/*.eval.ts"],
    testTimeout: 60_000,
    hookTimeout: 3 * 60 * 60 * 1000,
    fileParallelism: false,
  },
});
