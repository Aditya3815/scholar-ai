import { describe, expect, it } from "vitest";
import { carryOver } from "./router";

const ctx = (...qs: string[]) => ({ history: { turns: qs.length, entries: qs.flatMap((q) => [{ role: "user", text: q }, { role: "assistant", text: "an answer" }]) } }) as never;

describe("carryOver: the search words of a follow-up that no model reads (the day's allowance is used)", () => {
  it("puts the last question in front of a pronoun question", () => {
    expect(carryOver("what are its main limitations?", ctx("What is retrieval augmented generation and why is it used?"))).toBe("retrieval augmented generation main limitations");
  });
  it("uses the most recent question, not the first", () => {
    const q = carryOver("and its cost?", ctx("graph neural networks", "node classification benchmarks"));
    expect(q).toContain("node classification benchmarks");
    expect(q).not.toContain("graph neural networks");
  });
  it("leaves the words alone when there is no earlier question", () => {
    expect(carryOver("its limitations", ctx())).toBe("its limitations");
  });
  it("keeps the words of a kind the follow-up asks for, and drops the question frame and repeats", () => {
    expect(carryOver("and side effects in children?", ctx("effect of green tea on weight loss"))).toBe("green tea weight loss side effects children");
    expect(carryOver("tea ke bare me aur batao", ctx("green tea and weight loss"))).not.toMatch(/\b(and|ke|me)\b/);
  });
  it("falls back to the whole earlier question when it has no subject words", () => {
    expect(carryOver("its limitations", ctx("what is it?"))).toBe("what is it? its limitations");
  });
  it("is capped, so a long earlier question does not swamp the search", () => {
    expect(carryOver("its limitations", ctx("x".repeat(900))).length).toBeLessThanOrEqual(260);
  });
});
