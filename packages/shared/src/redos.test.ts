import { describe, expect, it } from "vitest";
import { cleanArxivId, cleanDoi, normalizeDoi, replaceMarks, stripMarks } from "./ids";
import { replaceEmails, scrubText } from "./text";

/**
 * The patterns CodeQL found polynomial on a long run of one character (PR #40, js/polynomial-redos) are loops now. Each keeps its output on ordinary text (the same as the patterns gave: checked
 * over 320,000 generated texts against the patterns before the change) and finishes a 50,000-character run of the bad character fast.
 */
const N = 50_000;
const fast = (f: () => unknown) => {
  const t = performance.now();
  f();
  return performance.now() - t;
};

describe("linear on long runs (CodeQL js/polynomial-redos)", () => {
  it("normalizeDoi: trailing punctuation, and a run of ')'", () => {
    expect(normalizeDoi("https://doi.org/10.1000/ABC.);")).toBe("10.1000/abc");
    expect(normalizeDoi("10.1051/bioconf/202621302009/pdf")).toBe("10.1051/bioconf/202621302009");
    expect(normalizeDoi("10.1000/a]).")).toBe("10.1000/a");
    expect(fast(() => normalizeDoi("10.1000/x" + ")".repeat(N) + "y"))).toBeLessThan(100);
  });

  it("cleanDoi: trailing space and punctuation, and a run of tabs", () => {
    expect(cleanDoi(" doi: 10.1000/ABC.) ")).toBe("10.1000/abc");
    expect(cleanDoi("https://dx.doi.org/10.1000/x , ;")).toBe("10.1000/x");
    expect(fast(() => cleanDoi("10.1000/x" + "\t".repeat(N) + "y"))).toBeLessThan(100);
  });

  it("cleanArxivId: the id of an arxiv.org address, and many 'a#'", () => {
    expect(cleanArxivId("https://arxiv.org/abs/1706.03762v5?context=cs")).toBe("1706.03762");
    expect(cleanArxivId("http://www.arxiv.org/pdf/1706.03762v2.pdf")).toBe("1706.03762");
    expect(cleanArxivId("https://arxiv.org/pdf/hep-th/9901001.PDF#page=2")).toBe("hep-th/9901001");
    expect(cleanArxivId("https://arxiv.org/abs/")).toBeNull();
    expect(cleanArxivId("https://arxiv.org/abs/1706.03762\nx")).toBeNull();
    expect(fast(() => cleanArxivId("http://arxiv.org/abs/" + "a#".repeat(N)))).toBeLessThan(100);
  });

  it("stripMarks and replaceMarks: the marks with the space before them, and a run of tabs", () => {
    expect(stripMarks("A claim [1] and\t [12]. More [x] [3")).toBe("A claim and. More [x] [3");
    expect(stripMarks("A claim [1] and more [", { unfinished: true })).toBe("A claim and more");
    expect(stripMarks("ends [4", { unfinished: true })).toBe("ends");
    expect(replaceMarks("a [1] b  [2]", (all, n) => (n === "1" ? all : ""))).toBe("a [1] b");
    const tabs = "x" + "\t".repeat(N) + "y";
    expect(fast(() => stripMarks(tabs, { unfinished: true }))).toBeLessThan(100);
    expect(fast(() => replaceMarks(tabs + " [1]", () => ""))).toBeLessThan(100);
  });

  it("replaceEmails and scrubText: addresses out, and a run of '%'", () => {
    expect(replaceEmails("write to a.b+c@mail.example.org or x@y.co.uk1, not z@@q or @a.bc", "#")).toBe("write to # or #1, not z@@q or @a.bc");
    expect(scrubText("ira@example.edu said\nhi https://lab.example.edu/x", 100)).toBe("said hi");
    expect(fast(() => scrubText("%".repeat(N) + "x", 100))).toBeLessThan(100);
    expect(fast(() => replaceEmails("a".repeat(N) + "@" + "b".repeat(N), "#"))).toBeLessThan(100);
  });
});
