import { describe, expect, it } from "vitest";
import { arxivDoi, arxivYear, checkMatch, extractArxivId, extractDoi, extractYears, guessTitle, joinHyphenated, looksLikeAuthors, pickBest, referenceKind, searchTitle, titleAfterAuthors, verdict, type Candidate } from "./match";

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

describe("arXiv ids", () => {
  it.each([
    ["Ba, J. et al. Layer normalization. arXiv preprint arXiv:1607.06450, 2016.", "1607.06450"],
    ["Gehring J. Convolutional sequence to sequence learning. arXiv preprint arXiv:1705.03122v2, 2017.", "1705.03122"],
    ["Vaswani et al. Attention is all you need. https://arxiv.org/abs/1706.03762", "1706.03762"],
    ["Bahdanau D. Neural machine translation by jointly learning to align and translate. CoRR, abs/1409.0473, 2014.", "1409.0473"],
    ["Smith J. A paper. Journal of Things 1234.5678, 2020.", null], // a page range or volume, not an arXiv id
    ["Smith J. A paper. arXiv:9913.00001", null], // month 13 does not exist
  ])("%s", (ref, expected) => expect(extractArxivId(ref)).toBe(expected));

  it("turns an id into the DOI arXiv registers, and reads the first-submission year from it", () => {
    expect(arxivDoi("1607.06450")).toBe("10.48550/arxiv.1607.06450");
    expect(arxivYear("10.48550/arxiv.1706.03762")).toBe(2017);
    expect(arxivYear("10.1000/other")).toBeNull();
    expect(arxivYear(null)).toBeNull();
  });
});

describe("titles after an author list", () => {
  it("recognises author lists, not titles", () => {
    expect(looksLikeAuthors("Jimmy Lei Ba, Jamie Ryan Kiros, and Geoffrey E Hinton")).toBe(true);
    expect(looksLikeAuthors("Nal Kalchbrenner, Lasse Espeholt, and Koray Kavukcuoglu")).toBe(true);
    expect(looksLikeAuthors("Deep residual learning for image recognition")).toBe(false);
    expect(looksLikeAuthors("Layer normalization")).toBe(false);
    expect(looksLikeAuthors("Attention Is All You Need")).toBe(false);
  });

  it("finds a short title that guessTitle skips", () => {
    const ref = "Jimmy Lei Ba, Jamie Ryan Kiros, and Geoffrey E Hinton. Layer normalization. arXiv preprint arXiv:1607.06450, 2016.";
    expect(titleAfterAuthors(ref)).toBe("Layer normalization");
    expect(guessTitle(ref)).toMatch(/Jimmy Lei Ba/); // the reason this exists
  });

  it("does not return a venue, and gives up when there is no author-first structure", () => {
    expect(titleAfterAuthors("Jimmy Ba and Diederik Kingma. In International Conference on Learning Representations, 2015.")).toBeNull();
    expect(titleAfterAuthors("Layer normalization is a thing people cite a lot, 2016")).toBeNull();
  });
});

describe("a venue is not a title", () => {
  const venue: Candidate = { doi: "10.7551/mitpress/7503.001.0001", title: "Advances in Neural Information Processing Systems 19", authorFamilies: [], authors: [], year: 2007, venue: null };
  it("does not treat the proceedings a paper appeared in as the paper", () => {
    const ref = "Ilya Sutskever, Oriol Vinyals, and Quoc V Le. Sequence to sequence learning with neural networks. In Advances in Neural Information Processing Systems 19, pages 3104-3112, 2014.";
    expect(checkMatch(ref, venue).title).toBeLessThan(0.5);
    expect(v(ref, venue)).toBe("different");
  });

  it("still matches a real title that merely contains the venue's words, and a title that follows \"in\" inside the title itself", () => {
    const real: Candidate = { ...attention, title: "Advances in Neural Information Processing Systems" , year: 2017, authorFamilies: ["Guyon"], authors: ["Isabelle Guyon"] };
    expect(checkMatch("Guyon I. (2017) Advances in Neural Information Processing Systems. Proceedings.", real).title).toBe(1);
    const inner: Candidate = { ...attention, title: "Mobility in India", authorFamilies: ["Rao"], authors: ["Rao"], year: 2019 };
    expect(checkMatch("Rao S. (2019) Mobility in India. Journal of Cities.", inner).title).toBe(1);
  });
});

describe("DOIs as a PDF delivers them", () => {
  it.each([
    ["Available at: http://dx.doi.org/10.3168/jds.2016- 12210.", "10.3168/jds.2016-12210"],
    ["Available at: http://dx.doi.org/10.3168/jds.S0022- 0302(06)72335-9.", "10.3168/jds.s0022-0302(06)72335-9"],
    ["Available at: https://www.annualreviews.org/doi/full/10.1146/annurev-resource-100518- 093954.", "10.1146/annurev-resource-100518-093954"],
    ["PLoS ONE 13(8). https://doi.org/10.1371/journal.pone.0198436%0AEditor: Someone", "10.1371/journal.pone.0198436"],
    ["Smith J. (2020). A title. J Things. https://doi.org/10.1000/abc.5 Next Reference Here", "10.1000/abc.5"], // no wrap, nothing swallowed
    ["Smith J. (2020). A title. doi:10.1000/abc.5.", "10.1000/abc.5"],
  ])("%s", (ref, expected) => expect(extractDoi(ref)).toBe(expected));
});

describe("searchTitle", () => {
  it.each([
    ["Jimmy Lei Ba, Jamie Ryan Kiros, and Geoffrey E Hinton. Layer normalization. arXiv preprint arXiv:1607.06450, 2016.", "Layer normalization"],
    ["Alex Graves. Generating sequences with recurrent neural networks. arXiv preprint arXiv:1308.0850, 2013.", "Generating sequences with recurrent neural networks"],
    ["Łukasz Kaiser and Ilya Sutskever. Neural GPUs learn algorithms. In International Conference on Learning Representations (ICLR), 2016.", "Neural GPUs learn algorithms"],
    ["Yoon Kim, Carl Denton, Luong Hoang, and Alexander M. Rush. Structured attention networks. In International Conference on Learning Representations, 2017.", "Structured attention networks"],
    ["Desai, A., & Verma, R. (2021). Graph neural networks for protein function prediction. Bioinformatics, 37(5), 1-12.", "Graph neural networks for protein function prediction"],
    ["Smith J. \"A quoted title for the search\", Journal of Things, 2020.", "A quoted title for the search"],
    // APA with initials: the text splits at every initial, and what follows the first part is more of the author list, not the title
    ["McMurray, J. J. V., Solomon, S. D., Inzucchi, S. E., Køber, L., Kosiborod, M. N., & Martinez, F. A. (2019). Dapagliflozin in Patients with Heart Failure and Reduced Ejection Fraction. New England Journal of Medicine.", "Dapagliflozin in Patients with Heart Failure and Reduced Ejection Fraction"],
  ])("%s", (ref, expected) => expect(searchTitle(ref)).toBe(expected));
});

describe("words a PDF broke across lines", () => {
  it("rejoins them, and leaves real compounds alone", () => {
    expect(joinHyphenated("Deep residual learning for im- age recognition. In Proceedings")).toBe("Deep residual learning for image recognition. In Proceedings");
    expect(joinHyphenated("Convolu- tional sequence to sequence learning")).toBe("Convolutional sequence to sequence learning");
    expect(joinHyphenated("a pre- and post-test design")).toBe("a pre- and post-test design");
    expect(joinHyphenated("Springer- Verlag, New York; state-of-the-art")).toBe("Springer- Verlag, New York; state-of-the-art");
  });

  it("lets a title with a broken word verify", () => {
    const resnet: Candidate = { doi: "10.1109/cvpr.2016.90", title: "Deep Residual Learning for Image Recognition", authorFamilies: ["He", "Zhang", "Ren", "Sun"], authors: [], year: 2016, venue: null };
    const ref = "Kaiming He, Xiangyu Zhang, Shaoqing Ren, and Jian Sun. Deep residual learning for im- age recognition. In CVPR, 2016.";
    expect(v(ref, resnet)).not.toBe("verified"); // the broken word alone breaks the match...
    expect(v(joinHyphenated(ref), resnet)).toBe("verified"); // ...rejoined, it matches
  });
});

describe("one-word record titles", () => {
  const one: Candidate = { doi: "10.1/x", title: "ry", authorFamilies: ["Asu"], authors: ["Rohit Asu"], year: 2026, venue: null };
  it("are never offered as a similar paper", () => {
    expect(v("NDDB. 2019. Handbook of Good Dairy Husbandry Practices. Anand: ry National Dairy Development Board.", one)).toBe("different");
  });
});

describe("referenceKind", () => {
  it.each([
    ["Reuters, Cholera vaccination campaign starts in Yemen after year delay: WHO, 07 May 2018, Available from: https://www.reuters.com/article/us-health-yemen", "web"],
    ["Wikipedia, 2016-2018 Yemen Cholera Outbreak, 08 June 2018, http://en.m.wikipedia.org/wiki/2016-18_Yemen_cholera_outbreak", "web"],
    ["P. Laws, Workshop Physics, Wiley (1999).", "book"],
    ["A. Schoenfeld, Mathematical Problem Solving (Academic Press, NY, 1985).", "book"],
    ["F. Reif, Understanding Basic Mechanics, ISBN 978-0-471-11624-0, Wiley, NY 1995.", "book"],
    ["Government of Haryana. 2020. Handbook on 20th Livestock Census.", "report"],
    ["NDDB. 2019. Handbook of Good Dairy Husbandry Practices. Anand, Gujarat.", "report"],
    ["Rao, S. (2018). Rural credit in Odisha. PhD thesis, Utkal University.", "thesis"],
  ] as const)("%s", (ref, kind) => expect(referenceKind(ref)).toBe(kind));

  it.each([
    "Kumar, A. (2020). A study of rivers. Journal of Water, 4(2), 1-10.",
    "Smith J. Springer-Verlag handbook chapter, Journal of Things 12:33-40, 2011.",
    "Desai, A. (2021). Graph networks for proteins. Bioinformatics 37(5), 1-12. https://doi.org/10.1093/bioinformatics/btab001",
    "Kapoor, S., & Menon, V. (2022). Quantum reservoir scheduling for monsoon-aware banking. Journal of Applied Fictional Studies, 12(3), 55-71.",
  ])("leaves an article-looking reference alone: %s", (ref) => expect(referenceKind(ref)).toBeNull());
});
