import { describe, expect, it } from "vitest";
import { unmark } from "./plain-written";

describe("unmark", () => {
  it("takes bold, italic and code marks out and keeps the words", () => {
    expect(unmark("**Bias** tab hota hai. *Example:* Maan lo `y = 2x`.")).toBe("Bias tab hota hai. Example: Maan lo y = 2x.");
  });
  it("leaves a sum or a star that is not a mark alone", () => {
    expect(unmark("2 * 3 * 4 = 24 and p < 0.05*")).toBe("2 * 3 * 4 = 24 and p < 0.05*");
  });
  it("drops heading hashes at the start of a line", () => {
    expect(unmark("## Variance\nIt is spread.")).toBe("Variance\nIt is spread.");
  });
  it("leaves plain text untouched", () => {
    const t = "A confidence interval is a range. It is not a probability that the value lies in it.";
    expect(unmark(t)).toBe(t);
  });
});
