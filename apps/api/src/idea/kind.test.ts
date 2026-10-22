import { describe, expect, it } from "vitest";
import { classifyWork } from "./kind";

const w = (workType: string | null, doi: string | null = "10.1000/x", venue: string | null = "A Journal") => classifyWork({ workType, doi, venue });

describe("classifyWork", () => {
  it("follows the index's own type", () => {
    expect(w("article")).toBe("paper");
    expect(w("review")).toBe("paper");
    expect(w("preprint")).toBe("preprint");
    expect(w("book-chapter")).toBe("book");
    expect(w("dissertation")).toBe("thesis");
    expect(w("report")).toBe("report");
    expect(w("dataset")).toBe("data");
  });
  it("leaves out what is not a work at all", () => {
    for (const t of ["paratext", "erratum", "peer-review", "grant", "supplementary-materials"]) expect(w(t)).toBeNull();
  });
  it("treats an untyped record deposited in a data repository as data, and an untyped journal record as a paper", () => {
    expect(w("other", "10.5281/zenodo.123", "Zenodo")).toBe("data");
    expect(w(null, "10.6084/m9.figshare.1", null)).toBe("data");
    expect(w(null, "10.1000/x", "GitHub")).toBe("data");
    expect(w(null, "10.1000/x", "Nature Methods")).toBe("paper");
    expect(w("other", null, null)).toBe("paper");
  });
  it("does not call a real article data just because it sits in Zenodo", () => {
    expect(w("article", "10.5281/zenodo.99", "Zenodo")).toBe("paper");
    expect(w("preprint", "10.5281/zenodo.98", "Zenodo")).toBe("preprint");
  });
});
