import type { ChatCitation } from "./chat";
import type { SearchScope } from "./index";
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
/** A theme's short name ("Risk factors", "How it is measured"): what the review's headings and the plan's cards show. */
export const LITSCAN_TITLE_CHARS = 60;
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
// 5,500 since the support judge (about 2,500 tokens a call, from the ledger: 2.3k in, 0.2k out) reads every sub-question's answer; it was 3,000 before (28 Oct 2026)
export const LITSCAN_TOKENS_PER_ITEM = 5_500;
export const estimateScanTokens = (items: number): number => items * LITSCAN_TOKENS_PER_ITEM;

export type LitscanLanguage = Extract<Lang, "en" | "hi" | "hinglish">;
export const LITSCAN_LANGUAGES: readonly LitscanLanguage[] = ["en", "hinglish", "hi"];
export const LITSCAN_LANGUAGE_NAMES: Record<LitscanLanguage, string> = { en: "English", hinglish: "Hinglish (Hindi in Roman letters)", hi: "Hindi (Devanagari)" };

/**
 * One theme of the scan (inside, a sub-question): its short name, the question it is answered as, and the English words the paper indexes are asked (the person sees all three and can
 * change them before anything is searched). `title` is absent in scans made before themes had names: the question stands in for it.
 */
export type LitscanItem = { question: string; searchQuery: string; title?: string };

/** The name a theme is shown with. */
export const themeTitle = (item: Pick<LitscanItem, "title" | "question">): string => item.title?.trim() || item.question;

/** The proposed plan, and what the person's allowance allows. */
export type LitscanPlan = { topic: string; language: LitscanLanguage; items: LitscanItem[]; allowance: { limit: number; used: number; estimate: number } };

/** What the browser sends to start a scan: the plan as approved, and where to search ("india": only Indian sources; absent: the regular ones). */
export type LitscanStartRequest = { topic: string; language: LitscanLanguage; items: LitscanItem[]; scope?: SearchScope };

export type LitscanState = "running" | "completed" | "canceled" | "failed";
export const LITSCAN_END_STATES = ["completed", "canceled", "failed"] as const;

/** Why a sub-question has no written answer. */
export type LitscanGap = "nothing_found" | "no_relevant" | "no_abstracts" | "not_answered" | "not_grounded" | "too_slow" | "quota" | "unavailable";
export const LITSCAN_GAP_TEXT: Record<LitscanGap, string> = {
  nothing_found: "No papers were found for this theme.",
  no_relevant: "Papers were found, but none of them is about this theme.",
  no_abstracts: "Papers were found, but none has an abstract to read.",
  not_answered: "The papers found do not seem to answer this directly.",
  not_grounded: "An answer could not be checked against the papers, so none is shown.",
  too_slow: "This took too long and was stopped. Try it alone in the prompt box.",
  quota: "Your AI allowance for today ran out before this was answered. It comes back tomorrow.",
  unavailable: "The AI service or the paper sources did not answer just now. Try this theme alone in the prompt box in a little while.",
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
/** `title` is the theme's name (themeTitle), `question` what it was answered as. */
export type ReportSection =
  | { idx: number; title: string; question: string; searchQuery: string; status: "answered"; text: string; evidence: { g: number; sentence: string }[] }
  | { idx: number; title: string; question: string; searchQuery: string; status: "gap"; reason: LitscanGap }
  | { idx: number; title: string; question: string; searchQuery: string; status: "pending" };
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
    const title = themeTitle(item);
    if (!part) return { idx, title, question: item.question, searchQuery: item.searchQuery, status: "pending" };
    if (part.status === "gap") return { idx, title, question: item.question, searchQuery: item.searchQuery, status: "gap", reason: part.reason };
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
    return { idx, title, question: item.question, searchQuery: item.searchQuery, status: "answered", text, evidence };
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
  /** Present when the scan searched only Indian sources. */
  scope?: SearchScope;
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
  scope?: SearchScope;
};

/** The scans of the last day, newest first, for the list on the page. */
export type LitscanListItem = { id: string; topic: string; state: LitscanState; total: number; done: number; createdAt: string; expiresAt: string };
