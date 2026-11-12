import { defineConfig } from "vitest/config";

// The page's own unit tests, next to the code they test (docs/design/untangle.md, F1). Node, not a DOM: a test that needs the browser's storage or IndexedDB
// stands them in (src/test/). Separate from vite.config.ts, so the page's build plugins do not run for tests, and tests are never part of the build.
export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});
