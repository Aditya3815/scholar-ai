import { describe, expect, it } from "vitest";
import { isNoise } from "@scholar/shared";

describe("isNoise", () => {
  it.each([
    ["Error", "ResizeObserver loop completed with undelivered notifications."],
    ["TypeError", "Failed to fetch"],
    ["TypeError", "Load failed"],
    ["AbortError", "The operation was aborted."],
    ["Error", "Script error."],
  ])("ignores %s: %s", (type, message) => expect(isNoise(type, message, "")).toBe(true));

  it("ignores errors that come from a browser extension", () => {
    expect(isNoise("Error", "x is not defined", "Error\n    at chrome-extension://abc/content.js:1:1")).toBe(true);
  });

  it("keeps real errors from our own code", () => {
    expect(isNoise("TypeError", "Cannot read properties of undefined (reading 'title')", "TypeError\n    at f (https://scholar/assets/app.js:1:1)")).toBe(false);
  });
});
