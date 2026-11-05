import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Paper } from "@scholar/shared";
import { isRelevant, matchOf } from "../litscan/relevance";
import { MAX_TIER_STEMS, STUB_TITLE_WORDS, isStubRecord, listState, tiererFor, type Tier } from "./tiers";

/**
 * R9 (docs/design/intent-and-state.md, 4.9): three tiers per paper on the READ topic, by the SAME rule as the literature scan (`isRelevant`, imported and never copied), and the trust rule that says when the page
 * may judge a list at all (1 to 6 content stems). The stub-title list and the thresholds are the plan's own and were written before any list was measured; the lists of the saved recordings are read by
 * eval/tiers.eval.ts, never here, so that nothing in this file is tuned to them.
 */

const paper = (title: string, abstract: string | null = null, extra: Partial<Paper> = {}): Paper => ({
  id: `t:${title}`, doi: null, pmid: null, title, authors: [], year: 2020, venue: null, abstract, citationCount: null, oaUrl: null, retracted: false, retractionSources: [], sources: ["openalex"], score: 1, ...extra,
});

const SOURCE = readFileSync(fileURLToPath(new URL("./tiers.ts", import.meta.url)), "utf8");

describe("the rule is the literature scan's own, imported and not copied", () => {
  it("tiers.ts imports isRelevant and matchOf from litscan/relevance and writes no stem rule of its own", () => {
    expect(SOURCE).toMatch(/import \{[^}]*\bisRelevant\b[^}]*\} from "\.\.\/litscan\/relevance"/);
    expect(SOURCE).toMatch(/import \{[^}]*\bmatchOf\b[^}]*\} from "\.\.\/litscan\/relevance"/);
    // a copy of the rule would slice stems to five letters, name a list of study-design words or divide matched by total
    expect(SOURCE).not.toMatch(/\.slice\(0,\s*5\)/);
    expect(SOURCE).not.toMatch(/GENERIC/);
    expect(SOURCE).not.toMatch(/matched\s*\/\s*total/);
  });

  it("is pure: it imports no network client, no database and no flag reader", () => {
    const imports = [...SOURCE.matchAll(/^import .* from "([^"]+)";?$/gm)].map((m) => m[1]);
    expect(imports.sort()).toEqual(["../litscan/relevance", "@scholar/shared"].sort());
    expect(SOURCE).not.toMatch(/\bfetch\b|\bconsole\b|\bDate\.now\b|\bMath\.random\b/);
  });

  it("strong is exactly what isRelevant says, for papers that are not stubs", () => {
    const query = "air pollution asthma children";
    const cases = [
      paper("Air pollution and asthma in children", "Exposure was measured."),
      paper("Asthma", "A review of asthma."),
      paper("Air pollution", "and more"),
      paper("Malaria vaccines", null),
      paper("Children and asthma", "Traffic air was measured near homes."),
      paper("Particulate matter and lung function", "Pollution of the air near roads."),
    ];
    const t = tiererFor(query)!;
    for (const p of cases) expect(t.tier(p) === "strong", p.title).toBe(isRelevant(query, p));
  });
});

describe("the three tiers", () => {
  const t = tiererFor("air pollution asthma children")!;
  it("strong: the rule passes (half the content stems, at least two)", () => {
    expect(t.tier(paper("Air pollution and asthma in children"))).toBe("strong");
    expect(t.tier(paper("Pollution", "Asthma in children near busy roads."))).toBe("strong");
  });
  it("medium: at least one content stem matches and the rule does not pass", () => {
    expect(t.tier(paper("Asthma", "A review of asthma."))).toBe("medium");
    expect(t.tier(paper("Air quality in Delhi"))).toBe("medium");
    // two of four is half, which passes; one of four does not
    expect(matchOf("air pollution asthma children", paper("Air quality in Delhi")).matched).toBe(1);
  });
  it("weak: no content stem matches", () => {
    expect(t.tier(paper("Malaria vaccines", "Trial of a vaccine in infants of Mali."))).toBe("weak");
    expect(t.tier(paper("", null))).toBe("weak");
  });
  it("a title-only record is judged by its title (there is no abstract to count)", () => {
    expect(t.tier(paper("Air pollution and asthma in children", null))).toBe("strong");
    expect(t.tier(paper("Notes on optic nerve imaging", null))).toBe("weak");
  });
  it("words that name a kind of study count neither for nor against, as in the scan", () => {
    const u = tiererFor("systematic review of randomized trial of air pollution")!;
    // the content stems are "air" and "pollu" only
    expect(u.tier(paper("Air pollution in cities"))).toBe("strong");
    expect(u.tier(paper("A systematic review of randomized trials"))).toBe("weak");
  });
});

describe("a stub record is forced weak (folded, never deleted)", () => {
  const stubs = [
    "Introduction", "introduction", "INTRODUCTION.", "  Introduction  ", "Summary", "Contents", "Index", "Frontmatter", "Notes", "Acknowledgements", "Acknowledgments", "Preface", "Foreword", "Cover", "Inactive DOIs", "inactive dois",
    "Figure 1: Flow of the participants", "Figure 12: The map", "Table 3: Characteristics of the sample", "table 2: Results", "FIGURE 4: x",
  ];
  const notStubs = [
    "Introduction to machine learning", "Summary statistics for the mean", "Notes on optic nerve imaging", "Index of refraction of water", "Covering letter", "Cover crops and soil carbon", "Contents of the gut",
    "Figure skating injuries", "Table of contents effects", "Table 1 shows", "Figure 8 knot: a study", "The Introduction", "Foreword to the second edition", "Preface to the study of rivers", "Acknowledgements of the editors",
  ];
  it.each(stubs)("%j is a stub", (title) => expect(isStubRecord(title)).toBe(true));
  it.each(notStubs)("%j is not a stub", (title) => expect(isStubRecord(title)).toBe(false));

  it("the list is the plan's: its eleven words and the spelling variants of two of them (acknowledgments, front matter); nothing was added after any list was read", () => {
    expect([...STUB_TITLE_WORDS].sort()).toEqual(["acknowledgements", "acknowledgments", "contents", "cover", "foreword", "front matter", "frontmatter", "inactive dois", "index", "introduction", "notes", "preface", "summary"].sort());
  });

  it("a stub is weak even when its abstract holds every word of the topic, and a real paper with the same words is strong", () => {
    const t = tiererFor("air pollution asthma children")!;
    const stub = paper("Introduction", "Air pollution and asthma in children is the subject of this volume.");
    expect(isRelevant("air pollution asthma children", stub)).toBe(true);
    expect(t.tier(stub)).toBe("weak");
    expect(t.tier(paper("Air pollution and asthma in children", stub.abstract))).toBe("strong");
    expect(t.tier(paper("Figure 2: Air pollution and asthma in children", "Air pollution and asthma in children."))).toBe("weak");
  });
});

describe("the trust rule: the page judges a list only when the words are a topic it can read", () => {
  it("1 to 6 content stems are judged; none and seven or more are not", () => {
    expect(MAX_TIER_STEMS).toBe(6);
    expect(tiererFor("tuberculosis")).not.toBeNull();
    expect(tiererFor("convoluton nueral netwrk")).not.toBeNull();
    expect(tiererFor("alpha beta gamma delta epsilon zeta")).not.toBeNull(); // six
    expect(tiererFor("alpha beta gamma delta epsilon zeta eta")).toBeNull(); // seven
    expect(tiererFor("study of the review")).toBeNull(); // no content stem: nothing to compare
    expect(tiererFor("")).toBeNull();
    expect(tiererFor("   ")).toBeNull();
  });
  it("counts stems, not words: seven words that make six stems are judged, and twelve words that make eight are not", () => {
    expect(tiererFor("children child childhood asthma asthmatic lungs lung")).not.toBeNull(); // child, child(hood), asthm, lungs, lung -> stems
    const long = "mobile phone screen time children visual symptoms refractive error";
    expect(tiererFor(long)).toBeNull();
  });
  it("the owner's message as he typed it has eight content stems and is not judged; once the frame is off it has three and is", () => {
    expect(tiererFor("Can you search about convoluton nueral netwrk all papers")).toBeNull();
    expect(tiererFor("convoluton nueral netwrk")).not.toBeNull();
  });
  it("a long ramble is not judged", () => {
    const ramble = "I have been wondering for a long time whether the thing that my uncle told me about the effect of walking after dinner on blood sugar in older people with diabetes is really true and what the doctors say";
    expect(tiererFor(ramble)).toBeNull();
  });
  it("words in a script the tokeniser cuts in the middle of a word (Devanagari) are not judged; Latin and Greek letters are", () => {
    expect(tiererFor("मधुमेह में व्यायाम का प्रभाव")).toBeNull();
    expect(tiererFor("मधुमेह diabetes exercise")).toBeNull();
    expect(tiererFor("diabetes me exercise ka asar")).not.toBeNull(); // Hinglish is Latin letters
    expect(tiererFor("α-synuclein aggregation parkinson")).not.toBeNull();
  });
  it("never throws, whatever it is given", () => {
    for (const q of ["\u0000", "x".repeat(100_000), "😀😀😀", "á".repeat(5000), "10.1000/xyz", "((((", "\n\t "]) expect(() => tiererFor(q)).not.toThrow();
  });
});

describe("the owner's own message, read: no strong paper, whatever the list holds", () => {
  const t = tiererFor("convoluton nueral netwrk")!;
  // with his typing the rule can only ever match one of the three stems (convo), because "nueral" and "netwrk" are not the stems of "neural" and "network": no paper reaches two, so none is strong
  it("a list of true convolutional network papers is medium, never strong, and an advertisement is weak", () => {
    const list = [
      paper("ImageNet classification with deep convolutional neural networks", "We trained a large deep convolutional neural network."),
      paper("Deep residual learning for image recognition", "Deeper neural networks are more difficult to train."),
      paper("We can tell you all about 1-Formylpiperidine.", null, { year: 1980 }),
    ];
    expect(list.map((p) => t.tier(p))).toEqual(["medium", "weak", "weak"]);
    expect(listState(t.counts(list))).toBe("none");
  });
  it("the same list for the topic spelt right is strong, which is what R12 will offer", () => {
    const right = tiererFor("convolutional neural network")!;
    expect(right.tier(paper("ImageNet classification with deep convolutional neural networks", "We trained a large deep convolutional neural network."))).toBe("strong");
  });
});

describe("the order: strong, medium, weak, each in its old relative order", () => {
  const t = tiererFor("air pollution asthma children")!;
  const mk = (n: number, kind: Tier) =>
    paper(`${kind} ${n}`, kind === "strong" ? "Air pollution and asthma in children." : kind === "medium" ? "Air quality." : "Malaria.", { id: `id:${kind}:${n}` });
  const list = [mk(1, "weak"), mk(2, "strong"), mk(3, "medium"), mk(4, "weak"), mk(5, "strong"), mk(6, "medium"), mk(7, "strong"), mk(8, "weak")];

  it("puts the tiers in order and keeps the order inside a tier", () => {
    expect(t.order(list).map((p) => p.id)).toEqual(["id:strong:2", "id:strong:5", "id:strong:7", "id:medium:3", "id:medium:6", "id:weak:1", "id:weak:4", "id:weak:8"]);
  });
  it("keeps every paper (a fold, never a delete), changes nothing about a paper and does not touch the list it was given", () => {
    const before = JSON.stringify(list);
    const out = t.order(list);
    expect(JSON.stringify(list)).toBe(before);
    expect(out).toHaveLength(list.length);
    expect([...out].sort((a, b) => a.id.localeCompare(b.id))).toEqual([...list].sort((a, b) => a.id.localeCompare(b.id)));
    for (const p of out) expect(p).toBe(list.find((x) => x.id === p.id));
  });
  it("is idempotent, and the empty list and a list of one are themselves", () => {
    expect(t.order(t.order(list)).map((p) => p.id)).toEqual(t.order(list).map((p) => p.id));
    expect(t.order([])).toEqual([]);
    expect(t.order([list[0]!]).map((p) => p.id)).toEqual(["id:weak:1"]);
  });
  it("a list of the list so far (a snapshot while the sources answer) is ordered by the same rule: its order is the final order with the later papers taken away", () => {
    const finalOrder = t.order(list).map((p) => p.id);
    for (let k = 1; k <= list.length; k++) {
      const snapshot = list.slice(0, k);
      const ids = new Set(snapshot.map((p) => p.id));
      expect(t.order(snapshot).map((p) => p.id), `first ${k}`).toEqual(finalOrder.filter((id) => ids.has(id)));
    }
  });
  it("the tier of a paper does not depend on the others in the list", () => {
    for (const p of list) expect(t.order([p])[0]).toBe(p);
    expect(list.map((p) => t.tier(p))).toEqual(["weak", "strong", "medium", "weak", "strong", "medium", "strong", "weak"]);
  });
  it("a stub that matches is last of its own old place: it goes after every strong and every medium paper", () => {
    const stub = paper("Introduction", "Air pollution and asthma in children.", { id: "id:stub" });
    const out = t.order([stub, mk(1, "medium"), mk(2, "strong")]).map((p) => p.id);
    expect(out).toEqual(["id:strong:2", "id:medium:1", "id:stub"]);
  });
});

describe("a request reads each paper once (written after the code: the tier is kept per paper object, because a request asks for it several times)", () => {
  it("asking for the tier of the same paper again does not read the paper again, and the list orders, counts and picks from that one reading", () => {
    const t = tiererFor("air pollution asthma children")!;
    let reads = 0;
    const counted = { get title() { reads++; return "Air pollution and asthma in children"; }, abstract: null as string | null };
    expect(t.tier(counted)).toBe("strong");
    const once = reads;
    expect(once).toBeGreaterThan(0);
    t.tier(counted);
    t.order([counted]);
    t.counts([counted]);
    expect(reads).toBe(once);
    // a different object with the same words is a different paper
    t.tier({ title: "Air pollution and asthma in children", abstract: null });
    expect(reads).toBe(once);
  });
});

describe("the state of a list, from the counts", () => {
  const counts = (strong: number, medium: number, weak: number) => ({ strong, medium, weak, total: strong + medium + weak });
  it("EMPTY: no paper at all", () => expect(listState(counts(0, 0, 0))).toBe("empty"));
  it("NONE_CLOSE: papers, and not one is strong", () => {
    expect(listState(counts(0, 5, 3))).toBe("none");
    expect(listState(counts(0, 0, 1))).toBe("none");
  });
  it("FEW: one or two strong papers and others besides (the sentence says the others are listed after)", () => {
    expect(listState(counts(1, 4, 5))).toBe("few");
    expect(listState(counts(2, 0, 8))).toBe("few");
    expect(listState(counts(1, 1, 0))).toBe("few");
  });
  it("close: three or more strong papers, or every paper strong (nothing is said)", () => {
    expect(listState(counts(3, 2, 2))).toBe("close");
    expect(listState(counts(20, 0, 0))).toBe("close");
    // two papers found and both close: the list is short, not weak, and "the others are weaker" would be untrue
    expect(listState(counts(2, 0, 0))).toBe("close");
    expect(listState(counts(1, 0, 0))).toBe("close");
  });
  it("counts a list", () => {
    const t = tiererFor("air pollution asthma children")!;
    expect(t.counts([paper("Air pollution and asthma in children"), paper("Asthma", "A review of asthma."), paper("Malaria"), paper("Introduction", "Air pollution and asthma in children.")])).toEqual({ strong: 1, medium: 1, weak: 2, total: 4 });
  });
});
