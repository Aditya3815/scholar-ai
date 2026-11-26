import { describe, expect, it } from "vitest";
import { isKnownPath } from "./known-path";

describe("isKnownPath", () => {
  it.each(["/", "", "/verify", "/verify/", "/idea", "/literature-scan", "/privacy", "/terms", "/how-we-verify", "/library", "/settings", "/home", "/admin", "/papers", "/papers/abcdef123456"])("%s is a page of the app", (p) => {
    expect(isKnownPath(p)).toBe(true);
  });
  it.each(["/nope", "/verify/extra", "/papers/XYZ", "/random/deep/path", "/privacy.html"])("%s is not", (p) => {
    expect(isKnownPath(p)).toBe(false);
  });
});
