import { describe, expect, it } from "vitest";
import { arxivIdFromDoi, cleanArxivId, cleanDoi, cleanPmcid, oaKey, refFromPaper } from "@scholar/shared";

describe("cleanDoi", () => {
  it.each([
    ["10.1038/nature14539", "10.1038/nature14539"],
    ["https://doi.org/10.1038/NATURE14539", "10.1038/nature14539"],
    ["http://dx.doi.org/10.1038/nature14539", "10.1038/nature14539"],
    ["doi: 10.1038/nature14539.", "10.1038/nature14539"],
    ["  10.1371/journal.pmed.0020124) ", "10.1371/journal.pmed.0020124"],
  ])("%s -> %s", (raw, want) => expect(cleanDoi(raw)).toBe(want));
  it("is null for what is not a DOI", () => {
    for (const bad of [null, undefined, 5, "", "nature14539", "10.12/abc", "11.1038/abc", "https://example.org/10.1038/x y", "10.1038/" + "a".repeat(250)]) expect(cleanDoi(bad)).toBeNull();
  });
});

describe("cleanArxivId and arxivIdFromDoi", () => {
  it.each([
    ["1706.03762", "1706.03762"], ["1706.03762v5", "1706.03762"], ["arXiv:1706.03762", "1706.03762"], ["https://arxiv.org/abs/1706.03762v2", "1706.03762"],
    ["https://arxiv.org/pdf/1706.03762.pdf", "1706.03762"], ["https://www.arxiv.org/pdf/2301.00001v3?x=1", "2301.00001"], ["hep-th/9901001", "hep-th/9901001"], ["math.GT/0309136v1", "math.GT/0309136"],
  ])("%s -> %s", (raw, want) => expect(cleanArxivId(raw)).toBe(want));
  it("is null for the rest", () => {
    for (const bad of [null, "", "17.03762", "https://example.org/abs/1706.03762", "arxiv", 3]) expect(cleanArxivId(bad)).toBeNull();
  });
  it("reads the number out of an arXiv DOI", () => {
    expect(arxivIdFromDoi("10.48550/arxiv.1706.03762")).toBe("1706.03762");
    expect(arxivIdFromDoi("10.1038/nature14539")).toBeNull();
  });
  it("cleanPmcid", () => {
    expect(cleanPmcid("pmc1182327")).toBe("PMC1182327");
    for (const bad of ["1182327", "PMC", "PMCabc", null, 5]) expect(cleanPmcid(bad)).toBeNull();
  });
});

describe("oaKey and refFromPaper", () => {
  it("one paper is one key: DOI in any spelling, else arXiv number", () => {
    expect(oaKey({ doi: "https://doi.org/10.1038/NATURE14539" })).toBe("doi:10.1038/nature14539");
    expect(oaKey({ doi: "10.1038/nature14539", arxivId: "1706.03762" })).toBe("doi:10.1038/nature14539");
    expect(oaKey({ arxivId: "arXiv:1706.03762v5" })).toBe("arxiv:1706.03762");
    expect(oaKey({})).toBeNull();
    expect(oaKey({ doi: "nope" })).toBeNull();
  });
  it("reads where a paper can be read from a search result: its DOI, and an arXiv number from the DOI or the link", () => {
    expect(refFromPaper({ doi: "10.1038/nature14539", oaUrl: null })).toEqual({ doi: "10.1038/nature14539" });
    expect(refFromPaper({ doi: "10.48550/arXiv.1706.03762", oaUrl: null })).toEqual({ doi: "10.48550/arxiv.1706.03762", arxivId: "1706.03762" });
    expect(refFromPaper({ doi: null, oaUrl: "https://arxiv.org/pdf/1706.03762v7" })).toEqual({ arxivId: "1706.03762" });
    expect(refFromPaper({ doi: null, oaUrl: "https://example.org/a.pdf" })).toBeNull();
  });
});
