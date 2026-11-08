import { describe, expect, it } from "vitest";
import { guards, scrubQueries } from "./guards";

const REFS = [
  "Vaswani, A., Shazeer, N., Parmar, N. (2017). Attention is all you need. Advances in Neural Information Processing Systems, 30.",
  "He, K., Zhang, X., Ren, S., Sun, J. (2016). Deep residual learning for image recognition. In CVPR, pp. 770-778.",
  "Devlin, J., Chang, M. W., Lee, K., Toutanova, K. (2019). BERT: Pre-training of deep bidirectional transformers. NAACL. https://doi.org/10.18653/v1/N19-1423",
].join("\n");

describe("guards", () => {
  it("refuses an empty or over-long message", () => {
    expect(guards({ text: "", mode: "auto" })).toEqual({ kind: "refuse", reason: "empty_or_too_long" });
    expect(guards({ text: "   \n ", mode: "auto" })).toEqual({ kind: "refuse", reason: "empty_or_too_long" });
    expect(guards({ text: "x".repeat(20_001), mode: "auto" })).toEqual({ kind: "refuse", reason: "empty_or_too_long" });
  });

  it("puts the safety lane before everything, a hand-picked tool too", () => {
    expect(guards({ text: "hello", mode: "auto", safety: true })).toEqual({ kind: "safety" });
    expect(guards({ text: "10.1038/nature14539", mode: "verify", safety: true })).toEqual({ kind: "safety" });
  });

  it("never overrides a tool chosen by hand", () => {
    expect(guards({ text: "hi", mode: "search" })).toEqual({ kind: "chosen", mode: "search", text: "hi" });
    expect(guards({ text: REFS, mode: "idea" })).toMatchObject({ kind: "chosen", mode: "idea" });
  });

  it("searches a bare DOI or arXiv number as written", () => {
    for (const t of ["10.1038/nature14539", "doi: 10.1145/3292500.3330701", "https://doi.org/10.1016/j.cell.2020.02.052", "2106.09685", "arxiv:1706.03762", "https://arxiv.org/abs/2005.14165"])
      expect(guards({ text: t, mode: "auto" }), t).toEqual({ kind: "identifier", text: t });
  });

  it("offers Check references for a pasted list", () => {
    expect(guards({ text: REFS, mode: "auto" }).kind).toBe("reference_list");
  });

  it("answers a greeting without the model", () => {
    for (const t of ["HY", "hlo", "Aur batao sab badhiya?", "thanks bhai", "नमस्ते"]) expect(guards({ text: t, mode: "auto" }).kind, t).toBe("greeting");
  });

  it("sends everything else to Understand, through the scrub hook", () => {
    expect(guards({ text: "LoRA for medical VQA", mode: "auto" })).toEqual({ kind: "understand", text: "LoRA for medical VQA" });
    const scrub = (t: string) => t.replace(/\S+@\S+/g, "").trim();
    expect(guards({ text: "papers on sleep a@b.com", mode: "auto", scrub })).toEqual({ kind: "understand", text: "papers on sleep" });
  });
});

describe("scrubQueries", () => {
  it("applies the scrub and drops what is left empty", () => {
    const scrub = (t: string) => t.replace(/https?:\/\/\S+/g, "");
    expect(scrubQueries(["sleep memory", "https://x.y", " a  b "], scrub)).toEqual(["sleep memory", "a b"]);
  });
});
