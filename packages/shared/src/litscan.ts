import type { ChatCitation } from "./chat";
import type { Lang } from "./route";

/**
 * Literature scan (docs/design/litscan.md): one topic is split into sub-questions; each is searched and answered from the abstracts it finds, with every claim tied to a sentence of an
 * abstract (the same check as the prompt box); the answers are put together as one report with one numbered list of sources. Nothing in the report is written by a model after the
 * checks: the report is the checked answers, in order, and a plain line for every sub-question that could not be answered.
 *
 * The scan runs on the server (a Cloudflare Workflow) and keeps its events in the database, so the page can be closed and reopened. The page's view is those events folded together
 * (`reduceView`), the same on every device. The event rule of docs/design/research-patterns.md applies: progress events carry no words, and the checked text arrives in `part` events.
 */

/** The topic the person writes: a sentence or two, not a document. */
export const LITSCAN_MIN_TOPIC = 8;
export const LITSCAN_MAX_TOPIC = 400;
/** Sub-questions in a plan, and the longest a question and its search words may be. */
export const LITSCAN_MIN_ITEMS = 2;
export const LITSCAN_MAX_ITEMS = 6;
export const LITSCAN_QUESTION_CHARS = 200;
export const LITSCAN_SEARCH_CHARS = 160;
/** How long a finished scan is kept, and how many scans one person may start in a day (UTC). */
export const LITSCAN_KEEP_HOURS = 24;
export const LITSCAN_PER_DAY = 4;
/** A running scan that has not moved for this long is called failed (the Workflow would have finished or failed long before). */
export const LITSCAN_STALE_MINUTES = 12;
/** How many scans one person may have shared by a link at a time. */
export const LITSCAN_MAX_SHARES = 5;
/**
 * What the approval screen says a scan will use, per sub-question. Measured on the deployed service: about 1,500 to 2,200 tokens an answer in English (R11, and 2,300 in a live scan), **3,200 in Hinglish**
 * (a live scan, 27 Oct 2026: its answers are longer). The larger figure is used so the screen under-promises.
 */
export const LITSCAN_TOKENS_PER_ITEM = 3_000;
export const estimateScanTokens = (items: number): number => items * LITSCAN_TOKENS_PER_ITEM;

export type LitscanLanguage = Extract<Lang, "en" | "hi" | "hinglish">;
export const LITSCAN_LANGUAGES: readonly LitscanLanguage[] = ["en", "hinglish", "hi"];
export const LITSCAN_LANGUAGE_NAMES: Record<LitscanLanguage, string> = { en: "English", hinglish: "Hinglish (Hindi in Roman letters)", hi: "Hindi (Devanagari)" };

/** One sub-question: what the report calls it, and the English words the paper indexes are asked (the person sees and can change both before anything is searched). */
export type LitscanItem = { question: string; searchQuery: string };

/** The proposed plan, and what the person's allowance allows. */
export type LitscanPlan = { topic: string; language: LitscanLanguage; items: LitscanItem[]; allowance: { limit: number; used: number; estimate: number } };

/** What the browser sends to start a scan: the plan as approved. */
export type LitscanStartRequest = { topic: string; language: LitscanLanguage; items: LitscanItem[] };

export type LitscanState = "running" | "completed" | "canceled" | "failed";
export const LITSCAN_END_STATES = ["completed", "canceled", "failed"] as const;

/** Why a sub-question has no written answer. */
export type LitscanGap = "nothing_found" | "no_relevant" | "no_abstracts" | "not_answered" | "not_grounded" | "too_slow" | "quota" | "unavailable";
export const LITSCAN_GAP_TEXT: Record<LitscanGap, string> = {
  nothing_found: "No papers were found for this sub-question.",
  no_relevant: "Papers were found, but none of them is about this sub-question.",
  no_abstracts: "Papers were found, but none has an abstract to read.",
  not_answered: "The papers found do not seem to answer this directly.",
  not_grounded: "An answer could not be checked against the papers, so none is shown.",
  too_slow: "This took too long and was stopped. Try it alone in the prompt box.",
  quota: "Your AI allowance for today ran out before this was answered. It comes back tomorrow.",
  unavailable: "The AI service or the paper sources did not answer just now. Try this sub-question alone in the prompt box in a little while.",
};

/** A paper a section cites: a real record from the search, never written by a model. `n` is its place in that sub-question's list (the mark in the section's text). */
export type LitscanSource = { n: number; paperId: string; title: string; year: number | null; doi: string | null; authors: string[]; venue: string | null; url: string | null };

/** The result for one sub-question: a checked answer, or the reason there is none. `found` is how many papers the search returned. */
export type LitscanPart =
  | { idx: number; status: "answered"; found: number; text: string; citations: ChatCitation[]; sources: LitscanSource[] }
  | { idx: number; status: "gap"; found: number; reason: LitscanGap };

export type LitscanWorkerStage = "searching" | "reading";

/**
 * What a scan's stream sends. `seq` is the place of a stored event (a reader that comes back asks for the events after the last one it saw); `progress` is worked out by the stream
 * itself from the parts it has sent, so it never goes down.
 */
export type LitscanEvent =
  /** The scan is running: how many sub-questions it has. */
  | { type: "started"; seq?: number; total: number }
  /** A sub-question moved on. No words. */
  | { type: "worker"; seq?: number; idx: number; stage: LitscanWorkerStage }
  /** How many sub-questions are finished (answered or not). No words. */
  | { type: "progress"; done: number; total: number }
  /** A finished sub-question, with its checked answer or its reason. */
  | { type: "part"; seq?: number; part: LitscanPart }
  /** The one end of a stream. */
  | { type: "done"; seq?: number; state: Exclude<LitscanState, "running">; answered: number; gaps: number }
  | { type: "error"; code: string; title: string; detail?: string };

/** A topic as it is sent: whitespace tidied, 8 to 400 characters with a letter or number in it. Null if it cannot be used. */
export function cleanLitscanTopic(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return t.length >= LITSCAN_MIN_TOPIC && t.length <= LITSCAN_MAX_TOPIC && /[\p{L}\p{N}]/u.test(t) ? t : null;
}

/* ---------------------------------------------------------------- the page's view: the events folded together */

export type LitscanView = {
  state: LitscanState;
  total: number;
  /** Sub-questions finished so far (answered or not). */
  done: number;
  /** Where each unfinished sub-question is (searching, reading). */
  stages: Record<number, LitscanWorkerStage>;
  /** Finished sub-questions by place in the plan. */
  parts: Record<number, LitscanPart>;
  /** The highest stored event seen: a reader that comes back asks for the events after it. */
  seq: number;
};

export const emptyView = (total = 0): LitscanView => ({ state: "running", total, done: 0, stages: {}, parts: {}, seq: 0 });

/** One event applied to the view. Repeated events change nothing (a stream that was cut and asked again may repeat the last one); an event that does not fit is ignored. */
export function reduceView(view: LitscanView, e: LitscanEvent): LitscanView {
  const seq = "seq" in e && typeof e.seq === "number" ? Math.max(view.seq, e.seq) : view.seq;
  switch (e.type) {
    case "started":
      return { ...view, total: e.total, seq };
    case "worker":
      return view.parts[e.idx] ? { ...view, seq } : { ...view, stages: { ...view.stages, [e.idx]: e.stage }, seq };
    case "part": {
      if (view.parts[e.part.idx]) return { ...view, seq };
      const stages = { ...view.stages };
      delete stages[e.part.idx];
      const parts = { ...view.parts, [e.part.idx]: e.part };
      return { ...view, stages, parts, done: Object.keys(parts).length, seq };
    }
    case "progress":
      return { ...view, done: Math.max(view.done, e.done) };
    case "done":
      return { ...view, state: e.state, stages: {}, seq };
    default:
      return view;
  }
}

export function viewFromEvents(events: readonly LitscanEvent[], total = 0): LitscanView {
  return events.reduce(reduceView, emptyView(total));
}

/* ---------------------------------------------------------------- the report */

export type ReportSource = { g: number; paperId: string; title: string; year: number | null; doi: string | null; authors: string[]; venue: string | null; url: string | null };
export type ReportSection =
  | { idx: number; question: string; searchQuery: string; status: "answered"; text: string; evidence: { g: number; sentence: string }[] }
  | { idx: number; question: string; searchQuery: string; status: "gap"; reason: LitscanGap }
  | { idx: number; question: string; searchQuery: string; status: "pending" };
export type Report = { sections: ReportSection[]; sources: ReportSource[]; answered: number; gaps: number; pending: number };

/**
 * The parts put together: sections in the order of the plan, and one numbered list of sources. Each section's marks [n] (its own search list) become [g], a number of the combined list, and the
 * same paper cited in two sections has one number. Nothing is added: a section's text is its checked answer as it was, with only its marks renumbered.
 */
export function assembleReport(items: readonly LitscanItem[], parts: Readonly<Record<number, LitscanPart>>): Report {
  const sources: ReportSource[] = [];
  const byPaper = new Map<string, number>();
  const sections: ReportSection[] = items.map((item, idx) => {
    const part = parts[idx];
    if (!part) return { idx, question: item.question, searchQuery: item.searchQuery, status: "pending" };
    if (part.status === "gap") return { idx, question: item.question, searchQuery: item.searchQuery, status: "gap", reason: part.reason };
    const map = new Map<number, number>();
    for (const s of part.sources) {
      let g = byPaper.get(s.paperId);
      if (g === undefined) {
        g = sources.length + 1;
        byPaper.set(s.paperId, g);
        sources.push({ g, paperId: s.paperId, title: s.title, year: s.year, doi: s.doi, authors: s.authors, venue: s.venue, url: s.url });
      }
      map.set(s.n, g);
    }
    const text = part.text
      .replace(/\[(\d{1,2})\]/g, (m, d: string) => (map.has(Number(d)) ? `[${map.get(Number(d))}]` : m))
      .replace(/(\[\d{1,3}\])(?:\s*\1)+/g, "$1");
    const evidence = part.citations.flatMap((c) => (map.has(c.n) ? [{ g: map.get(c.n)!, sentence: c.sentence }] : [])).sort((a, b) => a.g - b.g);
    return { idx, question: item.question, searchQuery: item.searchQuery, status: "answered", text, evidence };
  });
  return {
    sections,
    sources,
    answered: sections.filter((s) => s.status === "answered").length,
    gaps: sections.filter((s) => s.status === "gap").length,
    pending: sections.filter((s) => s.status === "pending").length,
  };
}

/** What the person gets from the stream and from the page: the scan as it stands. */
export type LitscanSnapshot = {
  id: string;
  topic: string;
  language: LitscanLanguage;
  items: LitscanItem[];
  state: LitscanState;
  total: number;
  done: number;
  stages: Record<number, LitscanWorkerStage>;
  parts: LitscanPart[];
  seq: number;
  createdAt: string;
  expiresAt: string;
  estimate: number;
  /** The token of this scan's read-only link, when the owner has turned sharing on. */
  share?: string | null;
};

/** What anyone with a shared link reads: the scan without the person, its id or its allowance. */
export type LitscanPublic = {
  topic: string;
  language: LitscanLanguage;
  items: LitscanItem[];
  state: LitscanState;
  total: number;
  parts: LitscanPart[];
  createdAt: string;
  expiresAt: string;
};

/** The scans of the last day, newest first, for the list on the page. */
export type LitscanListItem = { id: string; topic: string; state: LitscanState; total: number; done: number; createdAt: string; expiresAt: string };

/** The report as a Markdown file, built in the browser from what is on the page (never sent anywhere). */
export function buildLitscanMarkdown(args: { appName: string; generatedAt: string; topic: string; language: LitscanLanguage; report: Report }): string {
  const { report } = args;
  const out: string[] = [];
  out.push(`# Literature scan: ${args.topic}`, "");
  out.push(`Made with ${args.appName} on ${args.generatedAt.slice(0, 10)}. Written in ${LITSCAN_LANGUAGE_NAMES[args.language]}. ${report.answered} of ${report.sections.length} sub-questions answered${report.gaps ? `, ${report.gaps} without an answer` : ""}.`, "");
  out.push("> Each claim below is marked with its source and tied to a sentence of a paper's abstract, checked by the program; a sentence without a source number is wording, not a finding. Only abstracts were read, not full papers. This is a map of what the papers found say, not a systematic review.", "");
  for (const s of report.sections) {
    out.push(`## ${s.question}`, "");
    if (s.status === "answered") {
      out.push(s.text, "");
      if (s.evidence.length) out.push("The sentences behind it:", "", ...s.evidence.map((e) => `- [${e.g}] “${e.sentence}”`), "");
    } else if (s.status === "gap") out.push(`*Not answered.* ${LITSCAN_GAP_TEXT[s.reason]}`, "");
    else out.push("*Not finished.*", "");
  }
  if (report.sources.length) {
    out.push("## Sources", "");
    for (const r of report.sources) {
      const who = r.authors.length ? `${r.authors.slice(0, 3).join(", ")}${r.authors.length > 3 ? " et al." : ""}. ` : "";
      const link = r.doi ? ` https://doi.org/${r.doi}` : r.url ? ` ${r.url}` : "";
      out.push(`${r.g}. ${who}${r.title}${r.year ? ` (${r.year})` : ""}.${r.venue ? ` ${r.venue}.` : ""}${link}`);
    }
    out.push("");
  }
  return out.join("\n");
}

/** "literature-scan-air-pollution-and-asthma-2026-10-27.md": letters and digits only, so every system accepts it. */
export function litscanFileName(topic: string, now = new Date()): string {
  const slug = topic.normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 40).replace(/-+$/, "");
  return `literature-scan-${slug ? `${slug}-` : ""}${now.toISOString().slice(0, 10)}.md`;
}
