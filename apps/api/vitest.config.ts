import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // eval/lib holds the statistics the eval gates are read with (metrics.ts): its tests are plain unit tests, so they run here, not in the eval run (vitest.eval.config.ts runs only the gates)
    include: ["src/**/*.test.ts", "eval/lib/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
