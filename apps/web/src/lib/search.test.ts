import { describe, expect, it } from "vitest";
import { searchErrorText } from "./search";

/** The old results page's words when its stream fails (docs/design/untangle.md, F9), and bug B3. */
describe("searchErrorText", () => {
  it("the server's error event: its title, or Search failed without one; the browser's own error: Connection lost", () => {
    expect(searchErrorText(JSON.stringify({ type: "error", title: "The sources did not answer" }))).toBe("The sources did not answer");
    expect(searchErrorText(JSON.stringify({ type: "error" }))).toBe("Search failed");
    expect(searchErrorText(undefined)).toBe("Connection lost");
    expect(searchErrorText("")).toBe("Connection lost");
  });

  // Bug B3 (docs/design/untangle.md, section 5): the event was parsed with no guard inside the listener.
  it("B3: an error event that cannot be read says Search failed instead of throwing", () => {
    expect(searchErrorText("{not json")).toBe("Search failed");
    expect(searchErrorText("null")).toBe("Search failed");
  });
});
