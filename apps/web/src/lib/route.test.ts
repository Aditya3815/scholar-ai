import { describe, expect, it } from "vitest";
import { routeForPath } from "./route";

describe("routeForPath", () => {
  it("knows every real page", () => {
    expect(routeForPath("/").notFound).toBeFalsy();
    expect(routeForPath("/verify").view).toBe("verify");
    expect(routeForPath("/verify/").view).toBe("verify");
    expect(routeForPath("/how-we-verify").view).toBe("how");
    expect(routeForPath("/papers/abcdef12").docId).toBe("abcdef12");
    expect(routeForPath("/home").home).toBe(true);
  });
  it("marks a path that is no page as not found, so it is not shown as the home page", () => {
    for (const p of ["/foo", "/verify/extra", "/papers/NOT-HEX", "/admin/x", "/index.html"]) {
      expect(routeForPath(p).notFound, p).toBe(true);
    }
  });
});
