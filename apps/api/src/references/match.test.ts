import { describe, expect, it } from "vitest";
import { arxivDoi, arxivYear, spacedTitle, checkIdentified, checkLocator, checkMatch, doiCandidates, dropBrokenWords, firstAuthorFamily, extractArxivId, extractDoi, extractYears, guessTitle, joinHyphenated, looksLikeAuthors, pickBest, referenceKind, searchTitle, titleAfterAuthors, verdict, type Candidate } from "./match";

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

describe("a reference with no title has no title to search for", () => {
  // what is left of these once the authors are gone is the journal and its numbers, not a title: it used to be searched for as one
  it.each([
    "Abdo, A. A., Ackermann, M., Ajello, M., et al. 2009a, ApJ, 699, 976",
    "Ant\u00f3n, S., Browne, I. W. A., & March\u00e3, M. J. 2008, A&A, 490, 583",
    "D. Finkelstein, Phys. Rev. 110, 965 (1958).",
    "A. Einstein, Sitzungsber. K. Preuss. Akad. Wiss. 1, 688 (1916).",
    "B. P. Abbott et al., Phys. Rev. Lett. 116, 061102 (2016).",
  ])("%s", (ref) => expect(searchTitle(ref)).toBeNull());

  it("a short or numeric title is still a title", () => {
    expect(searchTitle("Hu, X. (2020). COVID-19: a 2020 review. Lancet.")).toBe("COVID-19: a 2020 review");
    expect(searchTitle("Jimmy Lei Ba, Jamie Ryan Kiros, and Geoffrey E Hinton. Layer normalization. arXiv preprint arXiv:1607.06450, 2016.")).toBe("Layer normalization");
    expect(searchTitle("Rao, S. (2021). 3D shape matching. Journal of Things, 4(2), 1-10.")).toBe("3D shape matching");
  });
});

describe("words a PDF broke across lines", () => {
  it("rejoins them, and leaves real compounds alone", () => {
    expect(joinHyphenated("Deep residual learning for im- age recognition. In Proceedings")).toBe("Deep residual learning for image recognition. In Proceedings");
    expect(joinHyphenated("Convolu- tional sequence to sequence learning")).toBe("Convolutional sequence to sequence learning");
    expect(joinHyphenated("a pre- and post-test design")).toBe("a pre- and post-test design");
    expect(joinHyphenated("Springer- Verlag, New York; state-of-the-art")).toBe("Springer- Verlag, New York; state-of-the-art");
  });

  it("lets a title with a broken word verify, with or without rejoining it first", () => {
    const resnet: Candidate = { doi: "10.1109/cvpr.2016.90", title: "Deep Residual Learning for Image Recognition", authorFamilies: ["He", "Zhang", "Ren", "Sun"], authors: [], year: 2016, venue: null };
    const ref = "Kaiming He, Xiangyu Zhang, Shaoqing Ren, and Jian Sun. Deep residual learning for im- age recognition. In CVPR, 2016.";
    expect(v(joinHyphenated(ref), resnet)).toBe("verified");
    expect(v(ref, resnet)).toBe("verified"); // the record says "image": two pieces that make one of its words are that word
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
    ["Rajeev Nongpiur and Tianyu Xu. 2025. Passively measuring room reverb. U.S. Patent Application No. 18/739,899. Published December 11, 2025.", "patent"],
    ["Dongeek Shin, Tianyu Xu, and Jennifer Irturk. 2025. Saliency-based mixed-order ambisonics encoding of multiple sound sources. U.S. Patent No. 12,494,214. Issued December 9, 2025.", "patent"],
    ["Kumar R. (2009) Water purification by solar stills. Indian Patent No. 223456", "patent"],
  ] as const)("%s", (ref, kind) => expect(referenceKind(ref)).toBe(kind));

  it("a paper that is about patents is a paper", () => {
    expect(referenceKind("Rao, S. (2020). Patent citations in nanotechnology. Scientometrics, 12(3), 11-29.")).toBeNull();
    expect(referenceKind("Mehta K. Patent landscape of CRISPR. World Patent Information, vol. 4, no. 3, 2019.")).toBeNull();
  });

  it.each([
    "Kumar, A. (2020). A study of rivers. Journal of Water, 4(2), 1-10.",
    "Smith J. Springer-Verlag handbook chapter, Journal of Things 12:33-40, 2011.",
    "Desai, A. (2021). Graph networks for proteins. Bioinformatics 37(5), 1-12. https://doi.org/10.1093/bioinformatics/btab001",
    "Kapoor, S., & Menon, V. (2022). Quantum reservoir scheduling for monsoon-aware banking. Journal of Applied Fictional Studies, 12(3), 55-71.",
  ])("leaves an article-looking reference alone: %s", (ref) => expect(referenceKind(ref)).toBeNull());
});

describe("a DOI the PDF wrapped after a dot or a slash", () => {
  it.each([
    ["Association for Computing Machinery, New York, NY, USA, 384-396. doi:10.1145/3498361. 3538933", "10.1145/3498361.3538933"],
    ["In 2021 Immersive and 3D Audio (I3DA). 1-9. doi:10.1109/I3DA48870. 2021.9610916", "10.1109/i3da48870.2021.9610916"],
    ["Cell 2020. https://doi.org/10.1016/j.cell.2020. 01.002", "10.1016/j.cell.2020.01.002"],
    ["Proc. ACM. doi:10.1145/ 3491102.3502020", "10.1145/3491102.3502020"],
  ])("%s", (ref, expected) => expect(extractDoi(ref)).toBe(expected));

  it("does not swallow the words that follow a DOI that ends the sentence", () => {
    expect(extractDoi("Proc. ACM. doi:10.1145/3498361. Association for Computing Machinery, New York")).toBe("10.1145/3498361");
    expect(doiCandidates("Proc. ACM. doi:10.1145/3498361. Association for Computing Machinery")).toEqual(["10.1145/3498361"]);
  });

  it("offers the plain DOI too when the joined one could be a sentence end followed by a number", () => {
    expect(doiCandidates("Smith J. A title. J Things. doi:10.1000/abc.5. 2019 IEEE Conference on Things")).toEqual(["10.1000/abc.5.2019", "10.1000/abc.5"]);
    expect(doiCandidates("no doi here")).toEqual([]);
    expect(doiCandidates("Smith J. https://doi.org/10.1000/abc.5")).toEqual(["10.1000/abc.5"]);
  });
});

describe("the title of a reference written \"Authors: Title. In: Venue (year)\"", () => {
  it.each([
    ["Bahdanau, D., Cho, K., Bengio, Y.: Neural machine translation by jointly learning to align and translate. In: ICLR (2015)", "Neural machine translation by jointly learning to align and translate"],
    ["Vaswani, A., Shazeer, N., Parmar, N., Uszkoreit, J., Jones, L., Gomez, A.N., Kaiser, L., Polosukhin, I.: Attention is all you need. In: NeurIPS (2017)", "Attention is all you need"],
    ["Radford, A., Wu, J., Child, R., Luan, D., Amodei, D., Sutskever, I.: Language models are unsupervised multitask learners (2019)", "Language models are unsupervised multitask learners"],
    ["Paszke, A., Gross, S., Massa, F., Lerer, A., Bradbury, J., Chanan, G., Killeen, T., Lin, Z., Gimelshein, N., Antiga, L.: Pytorch: An imperative style, high-performance deep learning library. In: NeurIPS (2019)", "Pytorch: An imperative style, high-performance deep learning library"],
    ["Rezatofighi, H., Tsoi, N., Gwak, J., Sadeghian, A., Reid, I., Savarese, S.: General- ized intersection over union. In: CVPR (2019)", "General- ized intersection over union"],
    ["Synnaeve, G., Xu, Q., Kahn, J., Grave, E., Likhomanenko, T., Collobert, R.: End-to-end ASR: from supervised to semi- supervised learning with modern architectures. arXiv:1911.08460 (2019)", "End-to-end ASR: from supervised to semi- supervised learning with modern architectures"],
    ["Hinton, G.E., Salakhutdinov, R.R.: Reducing the dimensionality of data with neural networks. Science 313(5786), 504-507 (2006)", "Reducing the dimensionality of data with neural networks"],
  ])("%s", (ref, expected) => expect(searchTitle(ref)).toBe(expected));

  it("also for authors followed by the year in brackets (Springer, Harvard)", () => {
    expect(searchTitle("Vaswani A, Shazeer N, Parmar N, Uszkoreit J, Jones L et al (2017) Attention is all you need. In: NeurIPS")).toBe("Attention is all you need");
    expect(searchTitle("Hochreiter S, Schmidhuber J (1997) Long short-term memory. Neural Comput 9:1735-1780")).toBe("Long short-term memory");
  });

  it("a title that has its own colon is not cut at it", () => {
    expect(searchTitle("Cai, Z., Vasconcelos, N.: Cascade R-CNN: High quality object detection and instance segmentation. PAMI (2019)")).toBe("Cascade R-CNN: High quality object detection and instance segmentation");
  });

  it("an opening quote that a PDF printed in place of a colon does not start the title", () => {
    expect(searchTitle("Jiangfan Feng , Tao Jin\u201cCEH-YOLO \u201cA composite enhanced YOLO- based model for underwater object detection\u201d Ecological Informatics 82 (2024) 102758")).toBe("A composite enhanced YOLO- based model for underwater object detection");
  });

  it("the title ends at its own full stop: not at an acronym that ends it, not after the venue that follows", () => {
    expect(searchTitle("Mondal D, Kanamadi S, Das K (2019) The need for design history in HCI. Journal of Applied Computational Research, 13, 130-142")).toBe("The need for design history in HCI");
    expect(searchTitle("Rao S, Iyer K (2023) Large-scale assessment of federated fine-tuning for clinical triage agents. npj Digital Medicine 6, 11-19")).toBe("Large-scale assessment of federated fine-tuning for clinical triage agents");
    expect(searchTitle("Rao, S., Iyer, K.: Machine learning for 3D shape matching in AI. arXiv:2101.00001 (2021)")).toBe("Machine learning for 3D shape matching in AI");
    // an initial or an abbreviation inside the title does not end it
    expect(searchTitle("Singh R, Rao S (2020) Genetic studies on jassid resistance in Gossypium hirsutum L. X Gossypium barbadense L. cotton. Indian J Genet 80, 1-9")).toBe("Genetic studies on jassid resistance in Gossypium hirsutum L. X Gossypium barbadense L. cotton");
    expect(searchTitle("Singh R, Rao S (2020) Bayesian vs. frequentist methods for small samples. J Stat 12, 1-9")).toBe("Bayesian vs. frequentist methods for small samples");
  });

  it("the references that already worked keep their titles", () => {
    expect(searchTitle("Desai, A., & Verma, R. (2021). Graph neural networks for protein function prediction. Bioinformatics, 37(5), 1-12.")).toBe("Graph neural networks for protein function prediction");
    expect(searchTitle("Jimmy Lei Ba, Jamie Ryan Kiros, and Geoffrey E Hinton. Layer normalization. arXiv preprint arXiv:1607.06450, 2016.")).toBe("Layer normalization");
  });
});

describe("a title whose words a PDF broke, or glued, differently from the record", () => {
  const luong: Candidate = { doi: "10.48550/arxiv.1508.04025", title: "Effective Approaches to Attention-based Neural Machine Translation", authorFamilies: ["Luong", "Pham", "Manning"], authors: ["Minh-Thang Luong", "Hieu Pham", "Christopher D. Manning"], year: 2015, venue: null };
  const head = "Minh-Thang Luong, Hieu Pham, and Christopher D Manning.";

  it("a real compound broken after its hyphen verifies (\"attention- based\", or \"attentionbased\" once the break was rejoined)", () => {
    expect(v(`${head} Effective approaches to attention- based neural machine translation. arXiv preprint arXiv:1508.04025, 2015.`, luong)).toBe("verified");
    expect(v(`${head} Effective approaches to attentionbased neural machine translation. arXiv preprint arXiv:1508.04025, 2015.`, luong)).toBe("verified");
  });

  it("a title with a real hyphen and a soft one in the same line verifies (neither way of rejoining fits both)", () => {
    expect(v(`${head} Effective approaches to attention- based neural ma- chine translation. 2015.`, luong)).toBe("verified");
  });

  it("two words printed where the record has one (\"Under water\") verify", () => {
    const uw: Candidate = { doi: "10.1016/j.optlastec.2024.110039", title: "Underwater image enhancement utilizing adaptive color correction and model conversion for dehazing", authorFamilies: ["Li", "Li", "Gao"], authors: ["Yiming Li", "Daoyu Li", "Zhijie Gao"], year: 2024, venue: null };
    expect(v("Yiming Li, Daoyu Li, Zhijie Gao \u201cUnder water image enhancement utilizing adaptive color correction and model conversion for dehazing\u201d Optics Laser Technology 169 (2024) 110039", uw)).toBe("verified");
  });

  it("words that lost their space verify too (\"filtersimultaneous\")", () => {
    const ekf: Candidate = { doi: "10.1000/ekf", title: "An extended Kalman filter simultaneous localization and mapping method for humanoid robot navigation", authorFamilies: ["Wen", "Zhang"], authors: ["S. Wen", "Z. Zhang"], year: 2023, venue: null };
    expect(v("S. Wen, Z. Zhang, An extended Kalman filtersimultaneous localization and mapping method for humanoid robot navigation, 2023", ekf)).toBe("verified");
  });

  it("this does not let a different title through: the words still have to be the record's words, in order", () => {
    const other = "Minh-Thang Luong, Hieu Pham, and Christopher D Manning. Neural machine translation with attention based pointer networks. 2015.";
    expect(v(other, luong)).not.toBe("verified");
  });

  it("the words around a break are left out of a title search (a search needs every word, and either reading of the break is a guess)", () => {
    expect(dropBrokenWords("Effective approaches to attention- based neural machine translation")).toBe("Effective approaches to neural machine translation");
    expect(dropBrokenWords("Convolu- tional sequence to sequence learning")).toBe("sequence to sequence learning");
    expect(dropBrokenWords("Deep residual learning for image recognition")).toBe("Deep residual learning for image recognition");
    // too little would be left to search for: keep the words (the caller then tries them joined)
    expect(dropBrokenWords("Semi- supervised learning")).toBe("Semi- supervised learning");
  });
});

describe("the title as the PDF printed it, with its line breaks", () => {
  it("is found again in the reference after the title was read from the rejoined text", () => {
    expect(spacedTitle("Effective approaches to attentionbased neural machine translation", "Luong M. Effective approaches to attention- based neural machine translation. In EMNLP, 2015.")).toBe("Effective approaches to attention- based neural machine translation");
    expect(spacedTitle("Deep residual learning for image recognition", "He K. Deep residual learning for im- age recognition. In CVPR 2016")).toBe("Deep residual learning for im- age recognition");
  });

  it("is the title itself when it has no break, or when it is not there", () => {
    expect(spacedTitle("The winograd schema challenge", "Levesque H. 2011. The winograd schema challenge. In AAAI.")).toBe("The winograd schema challenge");
    expect(spacedTitle("Something else entirely", "Levesque H. 2011. The winograd schema challenge. In AAAI.")).toBe("Something else entirely");
  });
});

describe("a reference that gives a shortened title", () => {
  const parikh: Candidate = { doi: "10.18653/v1/d16-1244", title: "A Decomposable Attention Model for Natural Language Inference", authorFamilies: ["Parikh", "T\u00e4ckstr\u00f6m", "Das", "Uszkoreit"], authors: ["Ankur Parikh"], year: 2016, venue: null };
  const real = "Ankur Parikh, Oscar T\u00e4ckstr\u00f6m, Dipanjan Das, and Jakob Uszkoreit. A decomposable attention model. In Empirical Methods in Natural Language Processing, 2016.";

  it("verifies when the title is the start of the record's, and the authors and the year agree", () => {
    const k = checkMatch(real, parikh);
    expect(k.shortened).toBe(true);
    expect(verdict(parikh, k)).toBe("verified");
  });

  it("not when the authors, or the year, do not agree (a half title with invented details is still not the paper)", () => {
    expect(v("Rahul Mehta, Priya Nair, and Karan Joshi. A decomposable attention model. In Empirical Methods in Natural Language Processing, 2016.", parikh)).not.toBe("verified");
    expect(v(real.replace("2016", "2009"), parikh)).not.toBe("verified");
  });

  it("not when what the reference gives is only a couple of words", () => {
    const dl: Candidate = { doi: "10.1000/dl", title: "Deep Learning for Natural Language Processing: A Survey", authorFamilies: ["Parikh"], authors: ["Ankur Parikh"], year: 2016, venue: null };
    expect(v("Ankur Parikh. Deep learning. In Empirical Methods, 2016.", dl)).not.toBe("verified");
  });

  it("not when the reference's title is only somewhere inside the record's (it has to be its beginning)", () => {
    const later: Candidate = { ...parikh, title: "Notes on a Decomposable Attention Model for Natural Language Inference" };
    expect(v(real, later)).not.toBe("verified");
  });
});

describe("a year that is two years from the record's", () => {
  const cascade: Candidate = { doi: "10.1109/tpami.2019.2956516", title: "Cascade R-CNN: High Quality Object Detection and Instance Segmentation", authorFamilies: ["Cai", "Vasconcelos"], authors: ["Zhaowei Cai", "Nuno Vasconcelos"], year: 2021, venue: "IEEE TPAMI" };
  const ref = (year: number) => `Cai, Z., Vasconcelos, N.: Cascade R-CNN: High quality object detection and instance segmentation. PAMI (${year})`;

  it("is a paper first printed online or in its conference form: title and author agree, so it verifies", () => {
    expect(v(ref(2019), cascade)).toBe("verified");
    expect(checkMatch(ref(2019), cascade).year).toBe(false); // and the answer still says the years differ
  });

  it("three years or more is still a difference", () => {
    expect(v(ref(2018), cascade)).toBe("title_only");
    expect(v(ref(2009), cascade)).toBe("title_only");
  });

  it("needs the authors: a real title with invented authors and a year that is close is still not verified", () => {
    expect(v("Smith, J., Brown, K.: Cascade R-CNN: High quality object detection and instance segmentation. PAMI (2019)", cascade)).toBe("title_only");
  });

  it("a short, generic title keeps asking for the year to agree", () => {
    const dl: Candidate = { doi: "10.1000/dl", title: "Deep learning", authorFamilies: ["LeCun"], authors: ["Yann LeCun"], year: 2015, venue: null };
    expect(v("LeCun, Y. (2013). Deep learning. Nature.", dl)).toBe("title_only");
  });
});

describe("a year that is part of the title is not the year of the reference", () => {
  // from the held-out fakes of the eval: the genuine reference with its year moved by five years. "2006-2015" is in the title, and 2015 is two years from the record's 2017.
  const scientometrics: Candidate = { doi: "10.14429/djlit.37.11655", title: "Contribution by Indian Authors in Foreign Origin Library and Information Science Journals during 2006-2015: A Scientometrics Study", authorFamilies: ["Mondal", "Kanamadi", "Das"], authors: ["Dipak Mondal"], year: 2017, venue: null };
  const text = (year: number) => `Mondal D, Kanamadi S, Das K. Contribution by Indian Authors in Foreign Origin Library and Information Science Journals during 2006-2015: A Scientometrics Study. DESIDOC Journal of Library & Information Technology. ${year}.`;

  it("a moved year is still a different year, whatever years the title mentions", () => {
    expect(v(text(2022), scientometrics)).toBe("title_only");
    expect(v(text(2012), scientometrics)).toBe("title_only");
    const dogs: Candidate = { doi: "10.1016/j.jvc.2009.12.003", title: "Retrospective analysis of an implantable loop recorder for evaluation of syncope, collapse, or intermittent weakness in 23 dogs (2004-2008)", authorFamilies: ["MacKie", "Stepien", "Kellihan"], authors: [], year: 2010, venue: null };
    expect(v("MacKie, B. A., Stepien, R. L., & Kellihan, H. B. (2015). Retrospective analysis of an implantable loop recorder for evaluation of syncope, collapse, or intermittent weakness in 23 dogs (2004-2008). Journal of Veterinary Cardiology.", dogs)).toBe("title_only");
  });

  it("the year that is printed besides the title still counts", () => {
    expect(v(text(2017), scientometrics)).toBe("verified");
    expect(v(text(2018), scientometrics)).toBe("verified");
    expect(checkMatch(text(2017), scientometrics).yearOff).toBe(0);
  });

  it("a title that is a year (a report named for it) does not lose the year it is published in", () => {
    const census: Candidate = { doi: "10.1000/c", title: "Census 2011: Provisional Population Totals", authorFamilies: ["Registrar"], authors: [], year: 2011, venue: null };
    expect(checkMatch("Registrar General. Census 2011: Provisional Population Totals. New Delhi, 2011.", census).year).toBe(true);
  });
});

describe("a reference that prints no year", () => {
  it("is not contradicted by the record's year: there is nothing to compare (it used to count as a year that differs)", () => {
    const k = checkMatch("Vaswani A, Shazeer N, Parmar N, Uszkoreit J. Attention is all you need. Advances in Neural Information Processing Systems.", attention);
    expect(k.year).toBeNull();
    expect(verdict(attention, k)).toBe("verified");
  });

  it("a short, generic title still needs the year, and a title with invented authors is still not verified", () => {
    const dl: Candidate = { doi: "10.1000/dl", title: "Deep learning", authorFamilies: ["LeCun"], authors: ["Yann LeCun"], year: 2015, venue: null };
    expect(v("LeCun, Y. Deep learning. Nature.", dl)).toBe("title_only");
    expect(v("Smith, J., Brown, K. Attention is all you need. Journal of Machine Learning.", attention)).toBe("title_only");
  });

  it("a year that is only in the title is not the reference's own either", () => {
    const census: Candidate = { doi: "10.1000/c", title: "Census 2011: Provisional Population Totals", authorFamilies: ["Registrar"], authors: [], year: 2012, venue: null };
    expect(checkMatch("Registrar General. Census 2011: Provisional Population Totals. New Delhi.", census).year).toBeNull();
  });
});

describe("a letter that a manuscript printed after a surname for the author's affiliation", () => {
  const uw: Candidate = { doi: "10.1016/j.optlastec.2024.110039", title: "Underwater image enhancement utilizing adaptive color correction and model conversion for dehazing", authorFamilies: ["Li", "Li", "Gao", "Wang"], authors: ["Yiming Li"], year: 2024, venue: null };
  const title = "\u201cUnderwater image enhancement utilizing adaptive color correction and model conversion for dehazing\u201d Optics Laser Technology 169 (2024) 110039";

  it("does not hide the author: \"Lia\", \"Gaob\"", () => {
    expect(v(`Yiming Lia, Daoyu Lia, Zhijie Gaob, Shuai Wangc ${title}`, uw)).toBe("verified");
  });

  it("is only for one letter: a different name is still a different author", () => {
    expect(v(`Rahul Lianos, Priya Nair ${title}`, uw)).toBe("title_only");
    expect(v(`Rahul Smith, Priya Nair ${title}`, uw)).toBe("title_only");
  });
});

describe("a reference that gives no title", () => {
  const abdo: Candidate = { doi: "10.1088/0004-637x/699/2/976", title: "Fermi/Large Area Telescope Discovery of Gamma-Ray Emission from a Relativistic Jet in the Narrow-Line Quasar PMN J0948+0022", authorFamilies: ["Abdo", "Ackermann", "Ajello"], authors: ["A. A. Abdo"], year: 2009, venue: "ApJ", volume: "699", pages: ["976"] };
  const ref = "Abdo, A. A., Ackermann, M., Ajello, M., et al. 2009a, ApJ, 699, 976";

  it("is told by who, when and where: the first author, the year, the volume and the first page are the record's", () => {
    expect(checkLocator(ref, abdo)).toBe(true);
    expect(checkLocator("A. A. Abdo et al., Astrophys. J. 699, 976 (2009).", abdo)).toBe(true);
    expect(checkLocator("Abdo, A. A. et al. 2010, ApJ, 699, 976", abdo)).toBe(true); // a year off: online first
  });

  it("not when any one of the four is not", () => {
    expect(checkLocator(ref.replace("Abdo", "Smith"), abdo)).toBe(false); // another author
    expect(checkLocator(ref.replace("2009a", "2003"), abdo)).toBe(false); // another year
    expect(checkLocator(ref.replace("699", "700"), abdo)).toBe(false); // another volume
    expect(checkLocator(ref.replace("976", "977"), abdo)).toBe(false); // another page
  });

  it("an article number counts as the page, with its letters (L105, 061102, e068060)", () => {
    const press: Candidate = { doi: "10.1086/180498", title: "Press and Teukolsky", authorFamilies: ["Press"], authors: [], year: 1971, venue: "The Astrophysical Journal", volume: "170", pages: ["L105"] };
    expect(checkLocator("W. H. Press, Astrophys. J. 170, L105 (1971).", press)).toBe(true);
    const ligo: Candidate = { doi: "10.1103/physrevlett.116.061102", title: "Observation of Gravitational Waves", authorFamilies: ["Abbott"], authors: [], year: 2016, venue: "Physical Review Letters", volume: "116", pages: ["061102"] };
    expect(checkLocator("B. P. Abbott et al., Phys. Rev. Lett. 116, 061102 (2016).", ligo)).toBe(true);
  });

  it("not when the reference has a title of its own: a made-up title on a real page is not that paper", () => {
    expect(checkLocator("Abdo, A. A., Ackermann, M. (2009). An invented study of quasars that was never written. The Astrophysical Journal, 699, 976-984.", { ...abdo, venue: "The Astrophysical Journal" })).toBe(false);
    // the journal's abbreviation is words of the journal's name, and the authors are the record's: nothing is left over
    expect(checkLocator("A. A. Abdo, M. Ackermann et al., Astrophys. J. 699, 976 (2009).", { ...abdo, venue: "The Astrophysical Journal" })).toBe(true);
    expect(checkLocator("Abdo, A. A., Ackermann, M., & Ajello, M. 2009, ApJ, 699, 976", abdo)).toBe(true); // ApJ: one unexplained word is the journal's acronym
  });

  it("a record that carries no volume or page cannot be told apart this way", () => {
    expect(checkLocator(ref, { ...abdo, volume: null })).toBe(false);
    expect(checkLocator(ref, { ...abdo, pages: [] })).toBe(false);
    expect(checkLocator(ref, { ...abdo, volume: undefined, pages: undefined })).toBe(false);
  });

  it("small numbers that happen to be in any reference are not a locator, but a two-digit volume and an article number are", () => {
    const tiny: Candidate = { ...abdo, volume: "1", pages: ["3"] };
    expect(checkLocator("Abdo, A. A. 2009, J. Things, 1, 3", tiny)).toBe(false);
    const blanchet: Candidate = { doi: "10.12942/lrr-2014-2", title: "Gravitational Radiation from Post-Newtonian Sources and Inspiralling Compact Binaries", authorFamilies: ["Blanchet"], authors: ["Luc Blanchet"], year: 2014, venue: "Living Reviews in Relativity", volume: "17", pages: ["2"] };
    expect(checkLocator("L. Blanchet, Living Rev. Relativity 17, 2 (2014).", blanchet)).toBe(true);
  });

  it("the year of a reference that gives no title is its own, even when the record's title names the same year", () => {
    const monitoring: Candidate = { ...abdo, title: "Multiwavelength Monitoring of the Enigmatic Narrow-Line Seyfert 1 PMN J0948+0022 in 2009 March-July", volume: "707", pages: ["727"], venue: "The Astrophysical Journal" };
    expect(checkLocator("Abdo, A. A., Ackermann, M., Ajello, M., et al. 2009b, ApJ, 707, 727", monitoring)).toBe(true);
  });

  it("reads the first author's family name from the head of the reference", () => {
    expect(firstAuthorFamily("A. Einstein, Sitzungsber. K. Preuss. Akad. Wiss. 1, 688 (1916).")).toBe("Einstein");
    expect(firstAuthorFamily("Abdo, A. A., Ackermann, M., Ajello, M., et al. 2009a, ApJ, 699, 976")).toBe("Abdo");
    expect(firstAuthorFamily("B. P. Abbott et al., Phys. Rev. Lett. 116, 061102 (2016).")).toBe("Abbott");
    expect(firstAuthorFamily("van der Waals, J. D. 1873, Thesis")).toBe("Waals");
    expect(firstAuthorFamily("2009")).toBeNull();
  });
});

describe("a reference that gives no title but an identifier of its own (an arXiv id)", () => {
  const chen: Candidate = { doi: "10.48550/arxiv.1801.07234", title: "Black hole masses of radio-loud narrow-line Seyfert 1 galaxies", authorFamilies: ["Chen", "Berton", "La Mura"], authors: ["Shiyu Chen", "Marco Berton", "Giovanni La Mura"], year: 2018, venue: "arXiv" };
  const ref = "Chen, S., Berton, M., La Mura, G., et al. 2018, ArXiv: 1801.07234";

  it("is told by its first author and its year", () => {
    expect(checkIdentified(ref, chen)).toBe(true);
    expect(checkIdentified("S. Chen et al., arXiv:1801.07234 (2018).", chen)).toBe(true);
  });

  it("not by another author, another year, or a title of its own", () => {
    expect(checkIdentified(ref.replace("Chen", "Smith"), chen)).toBe(false);
    expect(checkIdentified(ref.replace("2018", "2009"), chen)).toBe(false);
    expect(checkIdentified("Chen, S., Berton, M. 2018. A completely different study of quasars, ArXiv: 1801.07234", chen)).toBe(false);
  });
});

describe("titles of references written initials first, without quotes (IEEE as a PDF gives it)", () => {
  it("the title ends at its own full stop: the arXiv id and the year are not part of it", () => {
    expect(searchTitle("M. Lin, Q. Chen, and S. Yan. Network in network. arXiv:1312.4400, 2013.")).toBe("Network in network");
    expect(searchTitle("I. J. Goodfellow, D. Warde-Farley, M. Mirza, A. Courville, and Y. Bengio. Maxout networks. arXiv:1302.4389, 2013.")).toBe("Maxout networks");
    expect(guessTitle("Smith J, Rao K, Lee M. Graph neural networks for protein function prediction. arXiv preprint arXiv:2101.00001, 2021.")).toBe("Graph neural networks for protein function prediction");
  });

  it("a title in capitals with an \"and\" in it is a title, not a list of authors", () => {
    expect(looksLikeAuthors("Liunian Harold Li, Mark Yatskar, Da Yin, Cho-Jui Hsieh, and Kai-Wei Chang")).toBe(true);
    expect(looksLikeAuthors("VisualBERT: A Simple and Performant Baseline for Vision and Language")).toBe(false);
    expect(looksLikeAuthors("Dropout: A Simple Way to Prevent Neural Networks from Overfitting")).toBe(false);
    expect(searchTitle("Liunian Harold Li, Mark Yatskar, Da Yin, Cho-Jui Hsieh, and Kai-Wei Chang. VisualBERT: A Simple and Performant Baseline for Vision and Language. In Arxiv, 2019.")).toBe("VisualBERT: A Simple and Performant Baseline for Vision and Language");
  });
});

describe("a record that has words in its title that the reference does not (an acronym written out)", () => {
  const wu: Candidate = { doi: "10.1093/cid/ciaa199", title: "Clinical Characteristics of Imported Cases of Coronavirus Disease 2019 (COVID-19) in Jiangsu Province: A Multicenter Descriptive Study", authorFamilies: ["Wu", "Liu", "Zhao"], authors: ["Jian Wu", "Jun Liu", "Xinguo Zhao"], year: 2020, venue: "Clinical Infectious Diseases" };
  const ref = "Wu J, Liu J, Zhao X, Liu C, Wang W, Wang D, et al. Clinical characteristics of imported cases of COVID-19 in Jiangsu Province: A multicenter descriptive study. Clin Infect Dis 2020;71:706-12.";

  it("verifies when the reference's title is the record's with words taken out, and the authors and the year agree", () => {
    expect(v(ref, wu)).toBe("verified");
  });

  it("not when authors or year do not agree, nor when the record has a lot more than the reference", () => {
    expect(v(ref.replace("Wu J, Liu J, Zhao X, Liu C, Wang W, Wang D", "Rao S, Iyer K, Nair P"), wu)).not.toBe("verified");
    expect(v(ref.replace("2020", "2009"), wu)).not.toBe("verified");
    const long: Candidate = { ...wu, title: "Clinical Characteristics of Imported Cases of Coronavirus Disease 2019 in Jiangsu Province: A Multicenter Descriptive Study of Hospitalised Adults and Children with Severe Acute Respiratory Illness in Three Hospitals" };
    expect(v(ref, long)).not.toBe("verified");
  });
});
