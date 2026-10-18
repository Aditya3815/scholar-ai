import { describe, expect, it } from "vitest";
import { checkMatch, extractDoi, extractYears, guessTitle, pickBest, verdict, type Candidate } from "./match";

const attention: Candidate = {
  doi: "10.48550/arxiv.1706.03762",
  title: "Attention is All you Need",
  authorFamilies: ["Vaswani", "Shazeer", "Parmar", "Uszkoreit"],
  authors: ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar", "Jakob Uszkoreit"],
  year: 2017,
  venue: "NeurIPS",
};
const v = (ref: string, c: Candidate) => verdict(c, checkMatch(ref, c));

describe("extractDoi / extractYears", () => {
  it.each([
    ["see https://doi.org/10.1038/NATURE14539.", "10.1038/nature14539"],
    ["doi:10.1016/j.cell.2015.03.017)", "10.1016/j.cell.2015.03.017"],
    ["DOI: 10.1126/science.1225829, 2012", "10.1126/science.1225829"],
    ["no identifier here", null],
  ])("%s", (text, expected) => expect(extractDoi(text)).toBe(expected));

  it("ignores year-like digits inside a DOI", () => {
    expect(extractYears("Wu Z. (2020). Title. J. https://doi.org/10.1109/tnnls.2020.2978386")).toEqual([2020]);
    expect(extractYears("Smith 1998; Jones, 2003, p. 1999")).toEqual([1998, 2003, 1999]);
    expect(extractYears("vol 12345 and 3000 pages")).toEqual([]);
  });
});

describe("verdict: real, fabricated and altered references", () => {
  it("verifies a normal APA-style reference", () => {
    const ref = "Vaswani, A., Shazeer, N., Parmar, N., & Uszkoreit, J. (2017). Attention is all you need. Advances in Neural Information Processing Systems, 30.";
    expect(v(ref, attention)).toBe("verified");
  });

  it("verifies a messy reference with no punctuation conventions", () => {
    expect(v("Attention is all you need - Vaswani et al 2017 NeurIPS", attention)).toBe("verified");
  });

  it("tolerates a +-1 year difference (online-first vs print)", () => {
    expect(v("Vaswani A, Shazeer N. Attention is all you need. 2018.", attention)).toBe("verified");
  });

  it("does NOT verify a real title with invented authors (the typical AI fabrication)", () => {
    expect(v("Smith, J., Brown, K., & Lee, M. (2017). Attention is all you need. Journal of Machine Learning, 18, 1-20.", attention)).toBe("title_only");
  });

  it("does NOT verify a real title with the wrong year", () => {
    expect(v("Vaswani, A., Shazeer, N. (2009). Attention is all you need. NeurIPS.", attention)).toBe("title_only");
  });

  it("an unrelated reference is `different`", () => {
    expect(v("Kumar, R. (2019). Groundwater depletion in Punjab: an econometric assessment. Water Policy, 21, 45-60.", attention)).toBe("different");
  });

  it("a short title only counts when its words appear together, not scattered through a longer title", () => {
    const generic: Candidate = { doi: "10.1000/dc", title: "Distributed Consensus", authorFamilies: ["Bashir"], authors: [], year: 2022, venue: null };
    const fake = "Sharma, R., & Mehta, K. (2022). Quantum-inspired blockchain consensus for rural healthcare records in India, distributed systems. Journal of Health, 14(3), 211-229.";
    expect(v(fake, generic)).toBe("different");
    expect(v("Bashir, I. (2022). Distributed consensus. Packt.", generic)).toBe("verified");
    const bc: Candidate = { doi: "10.1000/bc", title: "Blockchain Consensus", authorFamilies: ["Bashir"], authors: [], year: 2022, venue: null };
    expect(v(fake, bc)).toBe("different"); // contiguous, but only a fragment of the reference's own longer title
    const graphene: Candidate = { doi: "10.1000/g", title: "Graphene", authorFamilies: ["Smith"], authors: [], year: 2020, venue: null };
    expect(v("Smith, J., & Lee, K. (2020). Graphene. Journal of Physical Chemistry and Applied Materials Science, 5, 1-10.", graphene)).not.toBe("different"); // a long journal name must not be mistaken for the title
    const three: Candidate = { doi: "10.1000/cb", title: "Consensus in Blockchain", authorFamilies: ["Gramoli"], authors: [], year: 2022, venue: null };
    expect(v(fake, three)).toBe("different"); // all three words occur, but scattered
    // a journal name that shares words with a real record must not make an unrelated reference look like it:
    const journalWords: Candidate = { doi: "10.1000/ir", title: "International Regulation of Emerging Technologies", authorFamilies: ["Girasa"], authors: [], year: 2022, venue: null };
    expect(v("Patel, R. (2018). Industrial Internet of Things: Challenges, Opportunities, and Directions. International Journal of Emerging Technologies and Society, 19(4), 819-829.", journalWords)).toBe("different");
  });

  it("generic short titles need BOTH author and year", () => {
    const deep: Candidate = { doi: "10.1038/nature14539", title: "Deep learning", authorFamilies: ["LeCun", "Bengio", "Hinton"], authors: [], year: 2015, venue: "Nature" };
    expect(v("LeCun Y, Bengio Y, Hinton G. Deep learning. Nature. 2015;521:436-444.", deep)).toBe("verified");
    expect(v("Anon. Deep learning. 2015.", deep)).toBe("title_only"); // year matches but no author
    expect(v("LeCun Y, Bengio Y, Hinton G. Deep learning. 2003.", deep)).toBe("title_only"); // wrong year
  });

  it("organisation authors are matched by name (tolerating abbreviation and word order)", () => {
    const who: Candidate = { doi: "10.1000/who.1", title: "Global tuberculosis report", authorFamilies: ["World Health Organization"], authors: ["World Health Organization"], year: 2020, venue: null };
    expect(v("World Health Organization. Global tuberculosis report 2020. Geneva: WHO.", who)).toBe("verified");
    expect(v("Organization, World Health (2020). Global tuberculosis report.", who)).toBe("verified");
    expect(v("Smith, J. (2020). Global tuberculosis report. Geneva.", who)).toBe("title_only"); // invented author, real title
  });

  it("a record whose only author is a group cannot confirm individual authors (unverifiable, not a mismatch)", () => {
    const amr: Candidate = { doi: "10.1016/s0140-6736(21)02724-0", title: "Global burden of bacterial antimicrobial resistance in 2019: a systematic analysis", authorFamilies: ["Antimicrobial Resistance Collaborators"], authors: ["Antimicrobial Resistance Collaborators"], year: 2022, venue: "The Lancet" };
    expect(v("Murray, C. J. L., Ikuta, K. S., et al. (2022). Global burden of bacterial antimicrobial resistance in 2019: a systematic analysis. The Lancet.", amr)).toBe("no_authors");
    // but a reference that names the group is verified normally
    expect(v("Antimicrobial Resistance Collaborators (2022). Global burden of bacterial antimicrobial resistance in 2019: a systematic analysis. The Lancet.", amr)).toBe("verified");
  });

  it("a record with NO authors is never verified, even if title and year match (letters and stubs share real titles)", () => {
    const stub: Candidate = { doi: "10.1056/nejmc1902837", title: "Dapagliflozin and Cardiovascular Outcomes in Type 2 Diabetes", authorFamilies: [], authors: [], year: 2019, venue: "NEJM" };
    const fake = "Lindqvist, S., Haddad, D., & Chatterjee, L. (2019). Dapagliflozin and Cardiovascular Outcomes in Type 2 Diabetes. Intl J Emerging Tech, 17(2).";
    expect(v(fake, stub)).toBe("no_authors");
    expect(v("Dapagliflozin and Cardiovascular Outcomes in Type 2 Diabetes. 2012.", stub)).toBe("title_only"); // wrong year
  });

  it("matches across diacritics and author order", () => {
    const c: Candidate = { doi: null, title: "Über die Elektrodynamik bewegter Körper", authorFamilies: ["Einstein", "Müller"], authors: [], year: 1905, venue: null };
    expect(v("Muller; Einstein A. Uber die Elektrodynamik bewegter Korper. Annalen der Physik 1905.", c)).toBe("verified");
  });

  it("works for non-Latin titles", () => {
    const c: Candidate = { doi: null, title: "भारतीय शिक्षा नीति का विश्लेषण", authorFamilies: ["शर्मा"], authors: [], year: 2021, venue: null };
    expect(v("शर्मा, आर. (2021). भारतीय शिक्षा नीति का विश्लेषण. शिक्षा पत्रिका.", c)).toBe("verified");
  });

  it("partial title coverage is title_only, never verified", () => {
    const ref = "Vaswani A, Shazeer N. Attention mechanisms for sequence transduction. 2017.";
    expect(v(ref, attention)).not.toBe("verified");
  });
});

describe("guessTitle", () => {
  it.each([
    ["Desai, A., & Verma, R. (2021). Graph neural networks for protein function prediction. Bioinformatics, 37(5), 1-12.", "Graph neural networks for protein function prediction"],
    ['A. Desai and R. Verma, "Graph neural networks for protein function prediction," Bioinformatics, 2021.', "Graph neural networks for protein function prediction"],
    ["Desai A, Verma R, Rao S. Graph neural networks for protein function prediction. Bioinformatics. 2021;37:1-12.", "Graph neural networks for protein function prediction"],
    ["Desai et al., Graph neural networks for protein function prediction, Bioinformatics 2021", null], // no sentence structure to split on
  ])("%s", (ref, expected) => expect(guessTitle(ref)).toBe(expected));
});

describe("pickBest", () => {
  it("prefers the candidate that covers the title and confirms author/year", () => {
    const decoy: Candidate = { ...attention, doi: "10.1/decoy", title: "Attention is all you need for protein folding", authorFamilies: ["Zhang"], year: 2022 };
    const ref = "Vaswani A et al. (2017) Attention is all you need. NeurIPS.";
    expect(pickBest(ref, [decoy, attention])?.cand.doi).toBe(attention.doi);
    expect(pickBest(ref, [])).toBeNull();
  });
});
