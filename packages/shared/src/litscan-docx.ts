import type { Block, DocxDoc, DocRun } from "./docx";
import { LITSCAN_GAP_TEXT, LITSCAN_LANGUAGE_NAMES, type LitscanLanguage, type Report } from "./litscan";
import { apaName, apaReference, buildEvidenceTable, reviewGlance } from "./litscan-review";

/**
 * The literature review as a Word document (docs/design/docx-export.md): the same content as the Markdown review, in Word's own styles (Title, Heading 1 to 3, List Bullet, a table
 * with a repeating header row), so it can be edited, commented on, and cited from. Every mark [n] in the text jumps to reference n; every DOI is a link. Nothing is added that the
 * scan does not hold, and nothing is written by a model.
 */

const ITALIC_ON = "\u0001";
const ITALIC_OFF = "\u0002";
const URL = /https?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:]/g;

/** Text with the marks [n] as jumps to the references; the rest as it is. */
export function marked(text: string): DocRun[] {
  const out: DocRun[] = [];
  let at = 0;
  for (const m of text.matchAll(/\[(\d{1,3})\]/g)) {
    if (m.index! > at) out.push({ t: text.slice(at, m.index) });
    out.push({ t: m[0], anchor: `ref${m[1]}` });
    at = m.index! + m[0].length;
  }
  if (at < text.length) out.push({ t: text.slice(at) });
  return out;
}

/** A reference line as runs: the journal in italics (the writer wraps it in two marker characters), and a web address as a link. */
export function referenceRuns(line: string): DocRun[] {
  const out: DocRun[] = [];
  const pushText = (t: string, i: boolean) => {
    let at = 0;
    for (const m of t.matchAll(URL)) {
      if (m.index! > at) out.push({ t: t.slice(at, m.index), ...(i ? { i } : {}) });
      out.push({ t: m[0], link: m[0], ...(i ? { i } : {}) });
      at = m.index! + m[0].length;
    }
    if (at < t.length) out.push({ t: t.slice(at), ...(i ? { i } : {}) });
  };
  let italic = false;
  for (const piece of line.split(new RegExp(`([${ITALIC_ON}${ITALIC_OFF}])`))) {
    if (piece === ITALIC_ON) italic = true;
    else if (piece === ITALIC_OFF) italic = false;
    else if (piece) pushText(piece, italic);
  }
  return out;
}

const plain = (t: string): DocRun[] => (t ? [{ t }] : []);

export function buildReviewDocx(args: { appName: string; generatedAt: string; topic: string; language: LitscanLanguage; report: Report; indian?: boolean }): DocxDoc {
  const { report } = args;
  const rows = buildEvidenceTable(report);
  const g = reviewGlance(report, rows);
  const blocks: Block[] = [];
  blocks.push({ k: "title", runs: plain(`Literature review: ${args.topic}`) });
  blocks.push({
    k: "p",
    runs: plain(
      `Made with ${args.appName} on ${args.generatedAt.slice(0, 10)}${args.indian ? ", from Indian sources only (journals published in India, Shodhganga theses, Indian institutions)" : ""}. Written in ${LITSCAN_LANGUAGE_NAMES[args.language]}.`,
    ),
  });
  blocks.push({
    k: "note",
    runs: plain("Each claim is marked with its source and tied to a sentence of that paper's abstract, checked by the program. Only abstracts were read, not full papers: this is a map of what the papers found say, not a systematic review."),
  });

  blocks.push({ k: "h1", runs: plain("At a glance") });
  blocks.push({ k: "bullet", runs: plain(`${g.answered} of ${g.themes} themes answered${g.gaps ? `, ${g.gaps} without an answer` : ""}`) });
  blocks.push({ k: "bullet", runs: plain(`${g.papers} papers cited${g.yearFrom ? `, ${g.yearFrom === g.yearTo ? g.yearFrom : `${g.yearFrom} to ${g.yearTo}`}` : ""}`) });
  if (g.designs.length) blocks.push({ k: "bullet", runs: plain(`Study designs (from their own words): ${g.designs.map((d) => `${d.design} ${d.n}`).join(", ")}`) });

  const answered = report.sections.filter((s) => s.status === "answered");
  if (answered.length) {
    blocks.push({ k: "h1", runs: plain("Findings by theme") });
    for (const s of report.sections) {
      if (s.status !== "answered") continue;
      blocks.push({ k: "h2", runs: plain(s.title) });
      blocks.push({ k: "p", runs: marked(s.text) });
      if (s.evidence.length) {
        blocks.push({ k: "h3", runs: plain("The sentences behind it") });
        for (const e of s.evidence) blocks.push({ k: "bullet", runs: [{ t: `[${e.g}] `, anchor: `ref${e.g}` }, { t: `“${e.sentence}”` }] });
      }
    }
  }

  if (rows.length) {
    blocks.push({ k: "h1", runs: plain("Evidence table") });
    blocks.push({
      k: "table",
      widths: [5, 20, 15, 42, 18],
      head: ["No.", "Study", "Design", "Key finding", "Themes"],
      rows: rows.map((r) => {
        const who = r.authors.length ? `${apaName(r.authors[0]!).split(",")[0]}${r.authors.length > 1 ? " et al." : ""}` : r.title.replace(/\s+/g, " ").slice(0, 40);
        return [
          [{ t: String(r.g), anchor: `ref${r.g}` }],
          plain(`${who}${r.year ? ` (${r.year})` : ""}`),
          plain(r.design),
          plain(r.findings.map((f) => `“${f.sentence}”`).join(" ")),
          plain(r.themes.join("; ")),
        ];
      }),
    });
  }

  const gaps = report.sections.filter((s) => s.status !== "answered");
  if (gaps.length) {
    blocks.push({ k: "h1", runs: plain("Gaps") });
    for (const s of gaps) {
      blocks.push({ k: "bullet", runs: [{ t: s.title, b: true }, { t: `: ${s.status === "gap" ? LITSCAN_GAP_TEXT[s.reason] : "Not finished."} (searched for: ${s.searchQuery})` }] });
    }
  }

  if (report.sources.length) {
    blocks.push({ k: "h1", runs: plain("References") });
    for (const r of report.sources) blocks.push({ k: "ref", no: r.g, bookmark: `ref${r.g}`, runs: referenceRuns(apaReference(r, (v) => `${ITALIC_ON}${v}${ITALIC_OFF}`)) });
  }

  const lang = args.language === "hi" ? "hi-IN" : "en-IN";
  return { title: `Literature review: ${args.topic}`, author: args.appName, created: new Date(args.generatedAt), lang, blocks };
}
