import { defineConfig } from "vitest/config";

// Shared's own tests, next to the code they test (docs/design/untangle.md, F1). Plain functions and data: no DOM, no Worker.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
