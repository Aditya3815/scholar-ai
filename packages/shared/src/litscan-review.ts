import { LITSCAN_GAP_TEXT, LITSCAN_LANGUAGE_NAMES, type LitscanLanguage, type Report, type ReportSource } from "./litscan";

/**
 * A literature scan read as a review (docs/design/litscan-review.md): the checked answers by theme, an evidence table (one row a paper, with the sentences of its abstract that the
 * answers rest on), the gaps, and the references, plus the files a researcher takes away (Markdown, CSV for a spreadsheet, BibTeX and RIS for a reference manager).
 * Everything here is a program over what the scan already holds: no model writes any of it, and nothing in it is a finding that was not checked against a sentence.
 */

/* ---------------------------------------------------------------- the kind of study, from its own words */

export const STUDY_DESIGNS = [
  "Systematic review or meta-analysis",
  "Randomised or controlled trial",
  "Intervention study (not randomised)",
  "Cohort or longitudinal study",
  "Case-control study",
  "Cross-sectional study or survey",
  "Qualitative study",
  "Case report or series",
  "Review",
  "Modelling or computational study",
  "Not stated",
] as const;
export type StudyDesign = (typeof STUDY_DESIGNS)[number];

/** In this order: the first that matches wins ("a meta-analysis of randomised trials" is a meta-analysis, "a trial in a cohort" is a trial). */
const DESIGN_RULES: [RegExp, StudyDesign][] = [
  [/\bmeta[-\s]?analy|\bsystematic(?:\s+literature)?\s+review|\bumbrella\s+review|\bscoping\s+review/i, "Systematic review or meta-analysis"],
  [/\brandomi[sz]ed\b|\brandomly\s+assigned\b|\bcontrolled\s+trial|\bclinical\s+trial|\b(?:pilot|feasibility|crossover|cluster)\s+trial|\btrial\b/i, "Randomised or controlled trial"],
  // before cohort: "a prospective interventional study" is an intervention, not a cohort (a live run, 28 Oct 2026)
  [/\binterventional\s+study\b|\bintervention\s+(?:study|group|programme|program)\b|\bquasi[-\s]experimental\b|\bpre[-\s]?(?:and[-\s])?post[-\s]?test\b|\bbefore[-\s]and[-\s]after\s+study\b|\bsupplementation\s+(?:programme|program|study)\b/i, "Intervention study (not randomised)"],
  [/\bcase[-\s]control\b/i, "Case-control study"],
  [/\bcohort\b|\blongitudinal\b|\bprospective(?:ly)?\b|\bretrospective(?:ly)?\b|\bfollow(?:ed)?[-\s]up\s+(?:study|for)\b/i, "Cohort or longitudinal study"],
  [/\bcross[-\s]sectional\b|\bsurvey(?:ed)?\b|\bprevalence\s+(?:study|survey)\b|\bquestionnaire\b/i, "Cross-sectional study or survey"],
  [/\bqualitative\b|\bin-depth\s+interviews?\b|\bsemi-structured\s+interviews?\b|\bfocus\s+groups?\b|\bthematic\s+analysis\b/i, "Qualitative study"],
  [/\bcase\s+(?:report|series)\b/i, "Case report or series"],
  [/\breview\b|\boverview\b/i, "Review"],
  [/\bsimulation\b|\bmodell?ing\s+study\b|\bmachine\s+learning\b|\bdeep\s+learning\b|\bneural\s+network\b|\balgorithm\b/i, "Modelling or computational study"],
];

/**
 * The design a paper's own words name: its title first, then the sentences of its abstract that were cited. A guess from words, said as such on the screen ("from the title and the
 * finding"): a paper that does not name its design is "Not stated", never a design we made up.
 */
export function studyDesign(title: string, sentences: readonly string[] = []): StudyDesign {
  for (const text of [title, sentences.join(" ")]) {
    for (const [re, design] of DESIGN_RULES) if (re.test(text)) return design;
  }
  return "Not stated";
}

/* ---------------------------------------------------------------- the evidence table */

export type EvidenceFinding = { idx: number; theme: string; sentence: string };
export type EvidenceRow = ReportSource & { design: StudyDesign; themes: string[]; findings: EvidenceFinding[]; link: string | null };

/**
 * One row a cited paper, in the order of the report's numbers, with every sentence of its abstract that an answer rests on (each once, under the first theme that cited it) and every
 * theme it was cited in.
 */
export function buildEvidenceTable(report: Report): EvidenceRow[] {
  const findings = new Map<number, EvidenceFinding[]>();
  const themes = new Map<number, Set<string>>();
  for (const s of report.sections) {
    if (s.status !== "answered") continue;
    for (const e of s.evidence) {
      const list = findings.get(e.g) ?? [];
      if (!list.some((f) => f.sentence === e.sentence)) list.push({ idx: s.idx, theme: s.title, sentence: e.sentence });
      findings.set(e.g, list);
      themes.set(e.g, (themes.get(e.g) ?? new Set()).add(s.title));
    }
  }
  return report.sources.map((src) => {
    const f = findings.get(src.g) ?? [];
    return {
      ...src,
      design: studyDesign(src.title, f.map((x) => x.sentence)),
      themes: [...(themes.get(src.g) ?? [])],
      findings: f,
      link: src.doi ? `https://doi.org/${src.doi}` : src.url,
    };
  });
}

export type Glance = { themes: number; answered: number; gaps: number; pending: number; papers: number; yearFrom: number | null; yearTo: number | null; designs: { design: StudyDesign; n: number }[] };

/** The review at a glance: how many themes were answered, how many papers stand behind it, the years they span and the kinds of study. */
export function reviewGlance(report: Report, rows: readonly EvidenceRow[]): Glance {
  const years = rows.map((r) => r.year).filter((y): y is number => typeof y === "number");
  const counts = new Map<StudyDesign, number>();
  for (const r of rows) counts.set(r.design, (counts.get(r.design) ?? 0) + 1);
  return {
    themes: report.sections.length,
    answered: report.answered,
    gaps: report.gaps,
    pending: report.pending,
    papers: rows.length,
    yearFrom: years.length ? Math.min(...years) : null,
    yearTo: years.length ? Math.max(...years) : null,
    designs: STUDY_DESIGNS.filter((d) => counts.has(d)).map((d) => ({ design: d, n: counts.get(d)! })).sort((a, b) => b.n - a.n),
  };
}

/* ---------------------------------------------------------------- references */

/** "S N Kavitha" -> Kavitha, S. N.; "Smith, John A." -> Smith, J. A.; "Jean-Paul Sartre" -> Sartre, J.-P. A one-word name (a group, an institution) stays as it is. */
export function apaName(raw: string): string {
  const name = raw.replace(/\s+/g, " ").trim();
  if (!name) return "";
  let family: string;
  let given: string[];
  if (name.includes(",")) {
    const [f, ...rest] = name.split(",");
    family = f!.trim();
    given = rest.join(" ").trim().split(" ").filter(Boolean);
  } else {
    const parts = name.split(" ");
    if (parts.length === 1) return name;
    family = parts.pop()!;
    given = parts;
  }
  const initials = given
    .map((g) => g.replace(/\.+$/, ""))
    .filter(Boolean)
    .map((g) => g.split("-").map((h) => (h ? `${h[0]!.toUpperCase()}.` : "")).filter(Boolean).join("-"));
  return initials.length ? `${family}, ${initials.join(" ")}` : family;
}

/** APA 7 order of authors: one; "A, & B"; up to twenty with "&" before the last. */
function apaAuthors(authors: readonly string[]): string {
  const names = authors.map(apaName).filter(Boolean).slice(0, 20);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(", ")}, & ${names[names.length - 1]}`;
}

/** A reference in APA 7 style, as far as an index's record allows (no volume or pages are invented). `italic` wraps the journal for Markdown. */
export function apaReference(r: Pick<ReportSource, "authors" | "year" | "title" | "venue" | "doi" | "url">, italic: (s: string) => string = (s) => s): string {
  const who = apaAuthors(r.authors);
  const title = r.title.replace(/\s+/g, " ").trim().replace(/[.]+$/, "");
  const link = r.doi ? `https://doi.org/${r.doi}` : r.url ?? "";
  const head = who ? `${who} (${r.year ?? "n.d."}). ${title}.` : `${title}. (${r.year ?? "n.d."}).`;
  return [head, r.venue ? `${italic(r.venue.trim())}.` : "", link].filter(Boolean).join(" ");
}

/* ---------------------------------------------------------------- files */

/** One cell of a CSV: quoted, quotes doubled, and a cell that a spreadsheet would read as a formula (=, +, -, @, tab, return) made into text first. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** The evidence table for a spreadsheet: one row a paper, its findings one to a line in their cell. UTF-8 with a byte-order mark, so Excel reads Hindi and other scripts. */
export function evidenceCsv(rows: readonly EvidenceRow[]): string {
  const head = ["No.", "Authors", "Year", "Title", "Journal or source", "Study design (from its words)", "Themes", "Key findings (sentences of the abstract)", "DOI", "Link"];
  const lines = rows.map((r) =>
    [r.g, r.authors.join("; "), r.year ?? "", r.title, r.venue ?? "", r.design, r.themes.join("; "), r.findings.map((f) => `“${f.sentence}”`).join("\n"), r.doi ?? "", r.link ?? ""].map(csvCell).join(","),
  );
  return `\uFEFF${[head.map(csvCell).join(","), ...lines].join("\r\n")}\r\n`;
}

const latexEscape = (s: string) => s.replace(/\\/g, "\\textbackslash{}").replace(/([{}&%$#_])/g, "\\$1").replace(/~/g, "\\textasciitilde{}").replace(/\^/g, "\\textasciicircum{}");

/** BibTeX for a reference manager: keys like rao2021glaucoma, made unique with a, b, … */
export function toBibtex(sources: readonly ReportSource[]): string {
  const used = new Map<string, number>();
  return sources
    .map((r) => {
      const family = (r.authors[0] ? apaName(r.authors[0]).split(",")[0]! : "anon").normalize("NFKD").replace(/[^A-Za-z]/g, "").toLowerCase() || "anon";
      const word = r.title.normalize("NFKD").toLowerCase().split(/[^a-z]+/).find((w) => w.length > 3 && !["with", "from", "that", "this", "their", "among", "about", "using"].includes(w)) ?? "paper";
      const base = `${family}${r.year ?? "nd"}${word}`;
      const n = used.get(base) ?? 0;
      used.set(base, n + 1);
      const key = n === 0 ? base : `${base}${String.fromCharCode(97 + ((n - 1) % 26))}`;
      const fields: [string, string][] = [
        ["author", r.authors.map((a) => latexEscape(a.replace(/\s+/g, " ").trim())).join(" and ")],
        ["title", `{${latexEscape(r.title.replace(/\s+/g, " ").trim())}}`],
        ["journal", r.venue ? latexEscape(r.venue) : ""],
        ["year", r.year ? String(r.year) : ""],
        ["doi", r.doi ?? ""],
        ["url", r.doi ? `https://doi.org/${r.doi}` : (r.url ?? "")],
      ];
      return `@article{${key},\n${fields.filter(([, v]) => v).map(([k, v]) => `  ${k} = {${v}}`).join(",\n")}\n}`;
    })
    .join("\n\n")
    .concat("\n");
}

/** RIS (Zotero, Mendeley, EndNote): one record a paper, each line a tag, no line breaks inside a value. */
export function toRis(sources: readonly ReportSource[]): string {
  const one = (s: string) => s.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  return sources
    .map((r) =>
      [
        "TY  - JOUR",
        ...r.authors.map((a) => `AU  - ${one(apaName(a).replace(/\.$/, ""))}`),
        `TI  - ${one(r.title)}`,
        r.venue ? `JO  - ${one(r.venue)}` : "",
        r.year ? `PY  - ${r.year}` : "",
        r.doi ? `DO  - ${r.doi}` : "",
        r.doi || r.url ? `UR  - ${r.doi ? `https://doi.org/${r.doi}` : r.url}` : "",
        "ER  - ",
      ]
        .filter(Boolean)
        .join("\r\n"),
    )
    .join("\r\n\r\n")
    .concat("\r\n");
}

/** The whole review as Markdown: at a glance, the findings by theme, the evidence table, the gaps and the references. Built in the browser from what is on the page. */
export function buildReviewMarkdown(args: { appName: string; generatedAt: string; topic: string; language: LitscanLanguage; report: Report; indian?: boolean }): string {
  const { report } = args;
  const rows = buildEvidenceTable(report);
  const g = reviewGlance(report, rows);
  const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
  const out: string[] = [];
  out.push(`# Literature review: ${args.topic}`, "");
  out.push(`Made with ${args.appName} on ${args.generatedAt.slice(0, 10)}${args.indian ? ", from Indian sources only (journals published in India, Shodhganga theses, Indian institutions)" : ""}. Written in ${LITSCAN_LANGUAGE_NAMES[args.language]}.`, "");
  out.push("> Each claim is marked with its source and tied to a sentence of that paper's abstract, checked by the program. Only abstracts were read, not full papers: this is a map of what the papers found say, not a systematic review.", "");
  out.push("## At a glance", "");
  out.push(`- ${g.answered} of ${g.themes} themes answered${g.gaps ? `, ${g.gaps} without an answer` : ""}`);
  out.push(`- ${g.papers} papers cited${g.yearFrom ? `, ${g.yearFrom === g.yearTo ? g.yearFrom : `${g.yearFrom} to ${g.yearTo}`}` : ""}`);
  if (g.designs.length) out.push(`- Study designs (from their own words): ${g.designs.map((d) => `${d.design} ${d.n}`).join(", ")}`);
  out.push("");
  out.push("## Findings by theme", "");
  for (const s of report.sections) {
    if (s.status !== "answered") continue;
    out.push(`### ${s.title}`, "", s.text, "");
    if (s.evidence.length) out.push("The sentences behind it:", "", ...s.evidence.map((e) => `- [${e.g}] “${e.sentence}”`), "");
  }
  if (rows.length) {
    out.push("## Evidence table", "", "| No. | Study | Design | Key finding | Themes |", "| --- | --- | --- | --- | --- |");
    for (const r of rows) {
      const who = r.authors.length ? `${apaName(r.authors[0]!).split(",")[0]}${r.authors.length > 1 ? " et al." : ""}` : cell(r.title).slice(0, 40);
      out.push(`| ${r.g} | ${cell(who)}${r.year ? ` (${r.year})` : ""} | ${r.design} | ${cell(r.findings.map((f) => `“${f.sentence}”`).join(" "))} | ${cell(r.themes.join("; "))} |`);
    }
    out.push("");
  }
  const gaps = report.sections.filter((s) => s.status !== "answered");
  if (gaps.length) {
    out.push("## Gaps", "");
    for (const s of gaps) out.push(`- **${s.title}**: ${s.status === "gap" ? LITSCAN_GAP_TEXT[s.reason] : "Not finished."} (searched for: ${s.searchQuery})`);
    out.push("");
  }
  if (report.sources.length) {
    out.push("## References", "");
    for (const r of report.sources) out.push(`${r.g}. ${apaReference(r, (v) => `*${v}*`)}`);
    out.push("");
  }
  return out.join("\n");
}

/** "literature-review-air-pollution-and-asthma-2026-10-28.csv": letters and digits only, so every system accepts it. */
export function reviewFileName(topic: string, ext: "md" | "csv" | "bib" | "ris", now = new Date()): string {
  const slug = topic.normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 40).replace(/-+$/, "");
  return `literature-review-${slug ? `${slug}-` : ""}${now.toISOString().slice(0, 10)}.${ext}`;
}
