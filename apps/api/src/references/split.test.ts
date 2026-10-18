import { describe, expect, it } from "vitest";
import { splitReferences } from "@scholar/shared";

const A = "Desai, A., & Verma, R. (2021). Graph neural networks for protein function prediction. Bioinformatics, 37(5), 1-12.";
const B = "Kumar, S. (2019). Plagiarism detection in Indian universities. Journal of Academic Ethics, 17(2), 101-118.";
const C = "Rao, P., Singh, T., & Iyer, M. (2020). Open access publishing trends in India. Scientometrics, 124, 55-70.";

describe("splitReferences", () => {
  it("returns nothing for empty input", () => {
    expect(splitReferences("")).toEqual([]);
    expect(splitReferences("   \n\n  ")).toEqual([]);
  });

  it("splits one reference per line", () => {
    expect(splitReferences(`${A}\n${B}\n${C}`)).toEqual([A, B, C]);
  });

  it("splits blank-line separated entries and joins wrapped lines inside one entry", () => {
    const wrapped = "Desai, A., & Verma, R. (2021). Graph neural networks for\nprotein function prediction. Bioinformatics, 37(5), 1-12.";
    expect(splitReferences(`${wrapped}\n\n${B}`)).toEqual([A, B]);
  });

  it("strips [1], 1. and 1) style numbering and joins continuation lines", () => {
    const text = `[1] Desai, A., & Verma, R. (2021). Graph neural networks for\nprotein function prediction. Bioinformatics, 37(5), 1-12.\n[2] ${B}\n[3] ${C}`;
    expect(splitReferences(text)).toEqual([A, B, C]);
    expect(splitReferences(`1. ${A}\n2. ${B}`)).toEqual([A, B]);
    expect(splitReferences(`1) ${A}\n2) ${B}`)).toEqual([A, B]);
  });

  it("recognises wrapped entries with no markers by their author-list start", () => {
    const text = "Desai, A., & Verma, R. (2021). Graph neural networks for\nprotein function prediction. Bioinformatics, 37(5), 1-12.\nKumar, S. (2019). Plagiarism detection in Indian\nuniversities. Journal of Academic Ethics, 17(2), 101-118.";
    expect(splitReferences(text)).toEqual([A, B]);
  });

  it("strips bullets", () => {
    expect(splitReferences(`• ${A}\n• ${B}`)).toEqual([A, B]);
  });

  it("treats a single pasted reference as one entry", () => {
    expect(splitReferences(A)).toEqual([A]);
  });

  it("converts BibTeX, including nested braces and a DOI", () => {
    const bib = `@article{desai2021,
  author = {Desai, Anita and Verma, Rahul},
  title = {Graph neural networks for {protein} function prediction},
  journal = {Bioinformatics},
  year = {2021},
  doi = {10.1000/real.1}
}

@inproceedings{kumar2019,
  author = "Kumar, S.",
  title = "Plagiarism detection in Indian universities",
  booktitle = "Proc. of Academic Ethics",
  year = 2019
}`;
    const out = splitReferences(bib);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe("Desai, Anita; Verma, Rahul (2021) Graph neural networks for protein function prediction. Bioinformatics. https://doi.org/10.1000/real.1");
    expect(out[1]).toContain("Plagiarism detection in Indian universities.");
    expect(out[1]).toContain("(2019)");
  });
});
