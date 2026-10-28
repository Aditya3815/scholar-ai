import { describe, expect, it } from "vitest";
import {
  LITSCAN_GAP_TEXT,
  apaName,
  apaReference,
  assembleReport,
  buildEvidenceTable,
  buildReviewMarkdown,
  csvCell,
  evidenceCsv,
  reviewFileName,
  reviewGlance,
  studyDesign,
  toBibtex,
  toRis,
  type LitscanItem,
  type LitscanPart,
} from "@scholar/shared";

const items: LitscanItem[] = [
  { title: "Strength of the link", question: "How strong is the link?", searchQuery: "air pollution asthma" },
  { title: "Measuring exposure", question: "How is exposure measured?", searchQuery: "traffic pollution exposure" },
  { title: "What helps", question: "What helps?", searchQuery: "intervention asthma children" },
];
const src = (n: number, paperId: string, title: string, extra: Partial<{ year: number | null; authors: string[]; venue: string | null; doi: string | null; url: string | null }> = {}) => ({
  n,
  paperId,
  title,
  year: 2020,
  doi: `10.1/${paperId}`,
  authors: ["Anjali Rao", "S N Kavitha"],
  venue: "Indian Journal of Pediatrics",
  url: `https://doi.org/10.1/${paperId}`,
  ...extra,
});
const answered = (idx: number, text: string, sources: ReturnType<typeof src>[], sentences: Record<number, string>): LitscanPart => ({
  idx,
  status: "answered",
  found: 12,
  text,
  sources,
  citations: sources.map((s) => ({ n: s.n, paperId: s.paperId, sentenceNo: 2, sentence: sentences[s.n]! })),
});
const report = assembleReport(items, {
  0: answered(0, "Pollution is linked to asthma [1][2].", [src(1, "a", "Traffic pollution and childhood asthma: a meta-analysis"), src(2, "b", "Asthma in Delhi schools", { year: 2016 })], { 1: "The pooled odds ratio was 1.08.", 2: "A cross-sectional survey of 4,000 children found more wheeze near roads." }),
  1: answered(1, "Exposure is modelled from roads [1].", [src(1, "b", "Asthma in Delhi schools", { year: 2016 })], { 1: "Exposure was estimated from distance to the nearest road." }),
  2: { idx: 2, status: "gap", found: 0, reason: "nothing_found" },
});

describe("the kind of study, from its own words", () => {
  it.each([
    ["Traffic pollution and childhood asthma: a meta-analysis", "Systematic review or meta-analysis"],
    ["A systematic review of yoga for hypertension", "Systematic review or meta-analysis"],
    ["Effect of yoga on blood pressure: a randomized controlled trial", "Randomised or controlled trial"],
    ["A meta-analysis of randomised trials of yoga", "Systematic review or meta-analysis"],
    ["A prospective cohort of 2,000 women", "Cohort or longitudinal study"],
    ["Effectiveness of a Multi-intervention Program on Haemoglobin: A Prospective Interventional Study", "Intervention study (not randomised)"],
    ["Effect of health education on anaemia: a quasi-experimental study", "Intervention study (not randomised)"],
    ["Effectiveness of weekly iron and folic acid supplementation programme to control anemia", "Intervention study (not randomised)"],
    ["Risk factors for glaucoma: a case-control study", "Case-control study"],
    ["Prevalence of anaemia: a cross-sectional study in Bihar", "Cross-sectional study or survey"],
    ["Experiences of nurses: a qualitative study", "Qualitative study"],
    ["A rare presentation of dengue: case report", "Case report or series"],
    ["Air pollution and health: a review", "Review"],
    ["Predicting crop yield with machine learning", "Modelling or computational study"],
    ["Groundwater quality of Tarikere Taluk", "Not stated"],
  ])("%s -> %s", (title, design) => expect(studyDesign(title)).toBe(design));
  it("looks at the cited sentences when the title does not say", () => {
    expect(studyDesign("Asthma in Delhi schools", ["A cross-sectional survey of 4,000 children found more wheeze."])).toBe("Cross-sectional study or survey");
    expect(studyDesign("Asthma in Delhi schools", ["Wheeze was common."])).toBe("Not stated");
  });
});

describe("the evidence table", () => {
  const rows = buildEvidenceTable(report);
  it("has one row a cited paper, in the report's numbering, with every sentence it was cited for and its themes", () => {
    expect(rows.map((r) => [r.g, r.paperId])).toEqual([[1, "a"], [2, "b"]]);
    expect(rows[1]).toMatchObject({ themes: ["Strength of the link", "Measuring exposure"], design: "Cross-sectional study or survey", link: "https://doi.org/10.1/b" });
    expect(rows[1]!.findings.map((f) => f.sentence)).toEqual(["A cross-sectional survey of 4,000 children found more wheeze near roads.", "Exposure was estimated from distance to the nearest road."]);
    expect(rows[0]!.design).toBe("Systematic review or meta-analysis");
  });
  it("shows a sentence once when two themes cite it, and still names both themes", () => {
    const same = "Children near roads had more attacks.";
    const r = assembleReport(items, {
      0: answered(0, "Claim [1].", [src(1, "x", "Roads and asthma")], { 1: same }),
      1: answered(1, "Claim again [1].", [src(1, "x", "Roads and asthma")], { 1: same }),
    });
    const [row] = buildEvidenceTable(r);
    expect(row!.findings.map((f) => f.sentence)).toEqual([same]);
    expect(row!.themes).toEqual(["Strength of the link", "Measuring exposure"]);
  });
  it("says at a glance how much was answered, by how many papers, over which years, and of which kinds", () => {
    expect(reviewGlance(report, rows)).toEqual({
      themes: 3, answered: 2, gaps: 1, pending: 0, papers: 2, yearFrom: 2016, yearTo: 2020,
      designs: [{ design: "Systematic review or meta-analysis", n: 1 }, { design: "Cross-sectional study or survey", n: 1 }],
    });
  });
});

describe("references", () => {
  it.each([
    ["S N Kavitha", "Kavitha, S. N."],
    ["Anjali Rao", "Rao, A."],
    ["A. Rao", "Rao, A."],
    ["Smith, John A.", "Smith, J. A."],
    ["Jean-Paul Sartre", "Sartre, J.-P."],
    ["WHO", "WHO"],
    ["  ", ""],
  ])("%s -> %s", (raw, apa) => expect(apaName(raw)).toBe(apa));
  it("writes APA 7 as far as the record allows: no volume or pages are made up", () => {
    expect(apaReference({ authors: ["Anjali Rao", "S N Kavitha", "P. Gupta"], year: 2020, title: "Asthma in Delhi schools.", venue: "Indian Journal of Pediatrics", doi: "10.1/b", url: null })).toBe(
      "Rao, A., Kavitha, S. N., & Gupta, P. (2020). Asthma in Delhi schools. Indian Journal of Pediatrics. https://doi.org/10.1/b",
    );
    expect(apaReference({ authors: [], year: null, title: "A thesis", venue: "Shodhganga", doi: null, url: "https://shodhganga.inflibnet.ac.in/handle/10603/1" }, (v) => `*${v}*`)).toBe(
      "A thesis. (n.d.). *Shodhganga*. https://shodhganga.inflibnet.ac.in/handle/10603/1",
    );
  });
});

describe("files", () => {
  it("a CSV cell is quoted, and one a spreadsheet would run as a formula is made text", () => {
    expect(csvCell('He said "yes"')).toBe('"He said ""yes"""');
    for (const evil of ["=HYPERLINK(\"http://x\")", "+1", "-1+1", "@SUM(A1)"]) expect(csvCell(evil).startsWith(`"'`)).toBe(true);
    expect(csvCell(null)).toBe('""');
  });
  it("the evidence CSV opens in Excel with any script: a byte-order mark, a header, one row a paper, findings one to a line", () => {
    const csv = evidenceCsv(buildEvidenceTable(report));
    expect(csv.startsWith("﻿\"No.\",\"Authors\"")).toBe(true);
    const records = csv.split("\r\n").filter(Boolean);
    expect(records).toHaveLength(3); // the header and two papers: the second paper's two findings are two lines inside one quoted cell
    expect(records[2]).toContain("near roads.”\n“Exposure was estimated");
    expect(csv).toContain('"Strength of the link; Measuring exposure"');
  });
  it("BibTeX keys are unique and the text is escaped", () => {
    const bib = toBibtex([
      { g: 1, paperId: "a", title: "Cost & effect of 50% cover_age", year: 2020, doi: "10.1/a", authors: ["Anjali Rao"], venue: "J {x}", url: null },
      { g: 2, paperId: "b", title: "Cost again", year: 2020, doi: null, authors: ["A. Rao"], venue: null, url: "https://x.org/b" },
    ]);
    expect(bib).toContain("@article{rao2020cost,");
    expect(bib).toContain("@article{rao2020costa,");
    expect(bib).toContain("title = {{Cost \\& effect of 50\\% cover\\_age}}");
    expect(bib).toContain("journal = {J \\{x\\}}");
    expect(bib).toContain("url = {https://x.org/b}");
  });
  it("RIS has one record a paper, with no line breaks inside a value", () => {
    const ris = toRis([{ g: 1, paperId: "a", title: "Two\nlines", year: 2020, doi: "10.1/a", authors: ["Anjali Rao", "S N Kavitha"], venue: "J", url: null }]);
    expect(ris).toBe("TY  - JOUR\r\nAU  - Rao, A\r\nAU  - Kavitha, S. N\r\nTI  - Two lines\r\nJO  - J\r\nPY  - 2020\r\nDO  - 10.1/a\r\nUR  - https://doi.org/10.1/a\r\nER  - \r\n");
  });
  it("the Markdown review has the glance, the findings by theme, the table, the gaps and APA references", () => {
    const md = buildReviewMarkdown({ appName: "Scholar AI", generatedAt: "2026-10-28T10:00:00Z", topic: "air pollution and asthma", language: "hinglish", report, indian: true });
    expect(md).toContain("# Literature review: air pollution and asthma");
    expect(md).toContain("from Indian sources only");
    expect(md).toContain("Hinglish (Hindi in Roman letters)");
    expect(md).toContain("- 2 of 3 themes answered, 1 without an answer");
    expect(md).toContain("- 2 papers cited, 2016 to 2020");
    expect(md).toContain("### Strength of the link");
    expect(md).toContain("- [1] “The pooled odds ratio was 1.08.”");
    expect(md).toContain("| 2 | Rao et al. (2016) | Cross-sectional study or survey |");
    expect(md).toContain(`- **What helps**: ${LITSCAN_GAP_TEXT.nothing_found} (searched for: intervention asthma children)`);
    expect(md).toContain("1. Rao, A., & Kavitha, S. N. (2020). Traffic pollution and childhood asthma: a meta-analysis. *Indian Journal of Pediatrics*. https://doi.org/10.1/a");
  });
  it("names files with letters and digits only", () => {
    expect(reviewFileName("Air pollution & asthma, in children!", "csv", new Date("2026-10-28T10:00:00Z"))).toBe("literature-review-air-pollution-asthma-in-children-2026-10-28.csv");
    expect(reviewFileName("!!!", "ris", new Date("2026-10-28T10:00:00Z"))).toBe("literature-review-2026-10-28.ris");
  });
});
