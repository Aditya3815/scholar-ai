import { describe, expect, it } from "vitest";
import {
  alignLabels,
  buildCiteIndex,
  describeTarget,
  findInTextCitations,
  joinPieces,
  labelledReferenceEntries,
  labelsUsable,
  linkCitation,
  referenceEntries,
  type CiteStyle,
  type Line,
  type TextPiece,
} from "@scholar/shared";

const AY: CiteStyle = { maxNumber: 0, keyed: false };
const NUM = (n: number): CiteStyle => ({ maxNumber: n, keyed: false });
const texts = (s: string, style: CiteStyle) => findInTextCitations(s, style).map((c) => c.text);
const targets = (s: string, style: CiteStyle) => findInTextCitations(s, style).map((c) => c.targets.map(describeTarget).join(" | "));

describe("finding author-year citations", () => {
  it("finds one citation in its own parentheses, with every common way of writing the authors", () => {
    expect(texts("Transformers (Vaswani et al., 2017) in particular", AY)).toEqual(["(Vaswani et al., 2017)"]);
    expect(targets("(Vaswani et al 2017)", AY)).toEqual(["Vaswani et al., 2017"]);
    expect(targets("(Vaswani et. al., 2017)", AY)).toEqual(["Vaswani et al., 2017"]);
    expect(targets("(Smith and Jones, 2019a)", AY)).toEqual(["Smith and Jones, 2019a"]);
    expect(targets("(Smith & Jones 2019)", AY)).toEqual(["Smith and Jones, 2019"]);
    expect(targets("(van der Berg, 2018)", AY)).toEqual(["van der Berg, 2018"]);
    expect(targets("(O'Neil, 2016)", AY)).toEqual(["O'Neil, 2016"]);
    expect(targets("(Rodríguez-García et al., 2021)", AY)).toEqual(["Rodríguez-García et al., 2021"]);
    expect(targets("(WHO, 2020)", AY)).toEqual(["WHO, 2020"]);
  });

  it("splits several citations in one pair of parentheses, skips the words in front, and keeps pages out of the year", () => {
    const s = "as before (e.g., Smith 2019; Lee et al., 2020, p. 4; see also Kumar and Rao 2021b).";
    expect(texts(s, AY)).toEqual(["Smith 2019", "Lee et al., 2020, p. 4", "Kumar and Rao 2021b"]);
    expect(targets(s, AY)).toEqual(["Smith, 2019", "Lee et al., 2020", "Kumar and Rao, 2021b"]);
    // a part with only years belongs to the authors before it
    expect(targets("(Smith, 2019; 2020)", AY)).toEqual(["Smith, 2019", "Smith, 2020"]);
  });

  it("reads citations separated by commas, pages without a comma, and a citation inside a longer remark (real: PMC and Planck papers)", () => {
    expect(targets("(see for instance Lucherini et al., 2017 p. 85, Rooke et al., 2016 p. e63)", AY)).toEqual(["Lucherini et al., 2017", "Rooke et al., 2016"]);
    expect(targets("(Rooke et al., 2016p. e63)", AY)).toEqual(["Rooke et al., 2016"]);
    expect(targets("(see, e.g., Galli et al. 2014, for further details)", AY)).toEqual(["Galli et al., 2014"]);
    // a name followed by other words is not a citation
    expect(texts("(the model of Smith 2019 was used)", AY)).toEqual([]);
  });

  it("reads names whose accents a PDF wrote as characters of their own", () => {
    expect(targets("(R¨uckl´e et al., 2020)", AY)).toEqual(["R¨uckl´e et al., 2020"]);
    const idx = buildCiteIndex(["Andreas Rücklé, Gregor Geigle, and Iryna Gurevych. AdapterDrop. 2020."], null);
    expect(findInTextCitations("(R¨uckl´e et al., 2020)", idx.style).map((c) => linkCitation(c, idx))).toEqual([[0]]);
  });

  it("reads several years and the short form of a letter", () => {
    expect(targets("(Smith 2019a, b)", AY)).toEqual(["Smith, 2019a | Smith, 2019b"]);
    expect(targets("(Smith 2019, 2020)", AY)).toEqual(["Smith, 2019 | Smith, 2020"]);
  });

  it("finds narrative citations, with round or square brackets", () => {
    expect(texts("as Vaswani et al. (2017) showed", AY)).toEqual(["Vaswani et al. (2017)"]);
    expect(texts("Smith and Jones (2019a, b) argue", AY)).toEqual(["Smith and Jones (2019a, b)"]);
    expect(texts("following Vaswani et al. [2017]", AY)).toEqual(["Vaswani et al. [2017]"]);
  });

  it("finds Hindi surnames and the Hindi word for and", () => {
    expect(targets("जैसा कि (शर्मा और वर्मा, 2019) ने दिखाया", AY)).toEqual(["शर्मा and वर्मा, 2019"]);
    expect(targets("(शर्मा, 2020)", AY)).toEqual(["शर्मा, 2020"]);
  });

  it("leaves out parentheses that are not citations", () => {
    expect(texts("the epidemic (COVID-19) grew", AY)).toEqual([]);
    expect(texts("measured in 2019 (n = 2019)", AY)).toEqual([]);
    expect(texts("(see Section 3)", AY)).toEqual([]);
    expect(texts("from 2015 to 2019 (both years included)", AY)).toEqual([]);
  });
});

describe("finding numbered and keyed citations", () => {
  it("finds a number, a range and a list, each number its own citation in a list", () => {
    expect(texts("shown in [12] and", NUM(40))).toEqual(["[12]"]);
    expect(targets("see [3-5]", NUM(40))).toEqual(["reference 3 | reference 4 | reference 5"]);
    expect(targets("see [3–5]", NUM(40))).toEqual(["reference 3 | reference 4 | reference 5"]);
    expect(texts("work [1, 4, 7–9] shows", NUM(40))).toEqual(["1", "4", "7–9"]);
  });

  it("takes no number when the paper's list is not numbered, and none past its last number", () => {
    expect(texts("shown in [12]", AY)).toEqual([]);
    expect(texts("shown in [41]", NUM(40))).toEqual([]);
    expect(texts("shown in [3, 41]", NUM(40))).toEqual([]);
  });

  it("does not take maths, indexing, intervals or decimals for citations", () => {
    expect(texts("for x ∈ [0, 1] we", NUM(40))).toEqual([]);
    expect(texts("for x ∈ [1, 2] we", NUM(40))).toEqual([]);
    expect(texts("let y = [2, 3]", NUM(40))).toEqual([]);
    expect(texts("the interval [1, 3] holds", NUM(40))).toEqual([]);
    expect(texts("a[1] + b[2]", NUM(40))).toEqual([]);
    expect(texts("f(x)[2]", NUM(40))).toEqual([]);
    expect(texts("scaled to [0.5, 1]", NUM(40))).toEqual([]);
    expect(texts("a backwards range [9-3]", NUM(40))).toEqual([]);
    // equation numbers in parentheses are never taken
    expect(texts("by (12) and (13)", NUM(40))).toEqual([]);
  });

  it("finds keys only in a keyed list", () => {
    expect(texts("as in [ADG16]", { maxNumber: 0, keyed: true })).toEqual(["[ADG16]"]);
    expect(targets("as in [BMR+20, KMH+20]", { maxNumber: 0, keyed: true })).toEqual(["BMR+20", "KMH+20"]);
    expect(texts("as in [ADG16]", AY)).toEqual([]);
  });

  it("gives the characters of each find in the page's text", () => {
    const s = "Self-attention (Vaswani et al., 2017) and [12].";
    const found = findInTextCitations(s, NUM(20));
    expect(found.map((c) => s.slice(c.start, c.end))).toEqual(["(Vaswani et al., 2017)", "[12]"]);
  });
});

const REFS = [
  "Ashish Vaswani, Noam Shazeer, Niki Parmar, Jakob Uszkoreit, Llion Jones, Aidan N Gomez, Łukasz Kaiser, and Illia Polosukhin. Attention is all you need. In NeurIPS, 2017.",
  "Smith, J. (2019a). A first paper. Journal A, 1, 1-10.",
  "Smith, J. (2019b). A second paper. Journal B, 2, 11-20.",
  "Smith, J., & Jones, K. (2018). Together. Journal C, 3, 21-30.",
  "Lee, H., Park, S., & Kim, D. (2020). Three authors. Journal D, 4, 1-5.",
  "Shazeer, N. (2019). Fast transformer decoding: one write-head is all you need. arXiv:1911.02150.",
  "van der Berg, A. (2018). Particles in names. Journal E.",
  "Kumar, R. (2017). A study that mentions Vaswani in its title, 2017. Journal F.",
  "शर्मा, र., और वर्मा, स. (2019). एक अध्ययन. पत्रिका.",
];

describe("linking a citation to its entry", () => {
  const idx = buildCiteIndex(REFS, null);
  const link = (s: string) => findInTextCitations(s, idx.style).map((c) => linkCitation(c, idx));

  it("links by first author and year, in both ways of writing names", () => {
    expect(link("(Vaswani et al., 2017)")).toEqual([[0]]);
    expect(link("Shazeer (2019)")).toEqual([[5]]);
    expect(link("(van der Berg, 2018)")).toEqual([[6]]);
    expect(link("(शर्मा और वर्मा, 2019)")).toEqual([[8]]);
  });

  it("tells 2019a from 2019b, and does not guess when the letter is missing", () => {
    expect(link("(Smith, 2019a)")).toEqual([[1]]);
    expect(link("(Smith, 2019a, b)")).toEqual([[1, 2]]);
    expect(link("(Smith, 2019)")).toEqual([null]);
  });

  it("needs the second named author, and a surname that is the FIRST author", () => {
    expect(link("(Smith and Jones, 2018)")).toEqual([[3]]);
    expect(link("(Smith and Brown, 2018)")).toEqual([null]);
    // Shazeer is an author of entry 0 (2017), but not its first: not linked to it
    expect(link("(Shazeer et al., 2017)")).toEqual([null]);
    // a title that mentions a surname and a year is not an author part
    expect(link("Vaswani (2017)")).toEqual([[0]]);
  });

  it("tells one author's paper from the same author's paper with others in the same year (real: Bahdanau et al. cite Graves 2013 twice)", () => {
    const g = buildCiteIndex(
      [
        "Graves, A. (2013). Generating sequences with recurrent neural networks. arXiv:1308.0850 [cs.NE].",
        "Graves, A., Jaitly, N., and Mohamed, A.-R. (2013). Hybrid speech recognition with deep bidirectional LSTM. In ASRU.",
        "Schuster, M. and Paliwal, K. K. (1997). Bidirectional recurrent neural networks. Signal Processing.",
      ],
      null,
    );
    const at = (s: string) => findInTextCitations(s, g.style).map((c) => linkCitation(c, g));
    expect(at("by Graves (2013) in")).toEqual([[0]]);
    expect(at("(Graves et al., 2013)")).toEqual([[1]]);
    // a word in front that is not a name: tried again without it
    expect(at("a bidirectional RNN (BiRNN, Schuster and Paliwal, 1997), which")).toEqual([[2]]);
  });

  it("finds a key whose '+' the PDF lost in the list, and links no key printed twice", () => {
    const k = buildCiteIndex(["a 2017", "b 2019", "c 2019", "d 2020"], ["VSP17", "RWC+19", "RWC19", "KMH+20"]);
    const at = (s: string) => findInTextCitations(s, k.style).map((c) => linkCitation(c, k));
    expect(at("[VSP+17]")).toEqual([[0]]);
    expect(at("[KMH+20]")).toEqual([[3]]);
    expect(at("[RWC+19]")).toEqual([null]);
  });

  it("does not link what it cannot find", () => {
    expect(link("(Nobody, 2017)")).toEqual([null]);
    expect(link("(Vaswani et al., 2016)")).toEqual([null]);
  });

  it("links numbers and keys by the label they were printed with, not by position", () => {
    // the list lost its marker 3: entry 3 in the list is printed [4]
    const labelled = buildCiteIndex(["A, 2001.", "B, 2002.", "D, 2004.", "E, 2005."], ["1", "2", "4", "5"]);
    expect(labelled.style).toEqual({ maxNumber: 5, keyed: false });
    const at = (s: string) => findInTextCitations(s, labelled.style).map((c) => linkCitation(c, labelled));
    expect(at("[4]")).toEqual([[2]]);
    expect(at("[3]")).toEqual([null]);
    const keyed = buildCiteIndex(["a 2016", "b 2020", "c 2020", "d 2021"], ["ADG16", "BMR+20", "KMH+20", "XYZ21"]);
    expect(keyed.style.keyed).toBe(true);
    expect(findInTextCitations("[BMR+20]", keyed.style).map((c) => linkCitation(c, keyed))).toEqual([[1]]);
  });
});

describe("the text of a page as one string", () => {
  const P = (str: string, x: number, y: number, w: number, eol = false): TextPiece => ({ str, x, y, w, h: 10, eol });
  it("joins touching pieces as they are, puts a space at a gap or a new line, and rejoins a word broken at a line end", () => {
    const { text, starts } = joinPieces([P("(Vas", 0, 100, 20), P("wani et al.,", 20.5, 100, 50), P("2017)", 75, 100, 20, true), P("by Ham-", 0, 88, 30, true), P("bardzumyan", 0, 76, 50), P("and Rodríguez-", 55, 76, 60, true), P("García", 0, 64, 30)]);
    expect(text).toBe("(Vaswani et al., 2017) by Hambardzumyan and Rodríguez- García");
    expect(starts.map((s, i) => text.slice(s, s + 3) + i)).toEqual(["(Va0", "wan1", "201" + "2", "by 3", "bar4", "and5", "Gar6"]);
  });
});

const L = (text: string, o: Partial<Line> = {}): Line => ({ text, size: 9, x: 56, y: 700, page: 7, ...o });

describe("the labels of a reference list", () => {
  it("keeps each entry's printed number and page, with exactly the text referenceEntries gives", () => {
    const block = [
      L("[1] A. Vaswani, N. Shazeer. Attention is all you need. In NeurIPS, 2017.", { y: 700 }),
      L("[2] J. Devlin, M. Chang. BERT: pre-training of deep bidirectional", { y: 686 }),
      L("transformers. In NAACL, 2019.", { y: 672, x: 66 }),
      // marker [3] was lost by the PDF: [4] follows
      L("[4] K. He, X. Zhang. Deep residual learning. In CVPR, 2016.", { y: 700, page: 8 }),
    ];
    const labelled = labelledReferenceEntries(block);
    expect(labelled.map((e) => e.text)).toEqual(referenceEntries(block));
    expect(labelled.map((e) => [e.label, e.page])).toEqual([
      ["1", 7],
      ["2", 7],
      ["4", 8],
    ]);
  });

  it("keeps a key broken over two lines whole", () => {
    const block = [
      L("[ADG16] M. Andrychowicz, M. Denil. Learning to learn by gradient descent. NeurIPS 2016."),
      L("[BMR+", { y: 686 }),
      L("20] T. Brown, B. Mann. Language models are few-shot learners. 2020.", { y: 672 }),
      L("[KMH+20] J. Kaplan, S. McCandlish. Scaling laws. 2020.", { y: 658 }),
      L("[XYZ21] A. Xu. Something else. 2021.", { y: 644 }),
    ];
    expect(labelledReferenceEntries(block).map((e) => e.label)).toEqual(["ADG16", "BMR+20", "KMH+20", "XYZ21"]);
  });

  it("lines a stored list up with the list read now, and refuses labels for a list that was changed", () => {
    const read = [
      { text: "A first entry, 2001.", label: "1", page: 9 },
      { text: "A second entry, 2002.", label: "2", page: 9 },
      { text: "A third entry, 2003.", label: "3", page: 10 },
    ];
    const same = alignLabels(read.map((r) => r.text), read);
    expect(same).toEqual({ labels: ["1", "2", "3"], pages: [9, 9, 10], aligned: 3 });
    expect(labelsUsable(read.map((r) => r.text), same)).toBe(true);
    // a list corrected by hand: the entries are not the ones read from the PDF
    const changed = ["Some other reference, 1999.", "And another, 1998.", "A third entry, 2003."];
    const a = alignLabels(changed, read);
    expect(a.aligned).toBe(1);
    expect(labelsUsable(changed, a)).toBe(false);
  });
});
