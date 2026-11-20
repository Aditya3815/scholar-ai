import { MARK, replaceMarks } from "./ids";
import type { Critique, CritiqueKind } from "./protocol/agents";

/**
 * The agents of the Paper Reader's drawer (docs/design/paper-reader.md, 9 and 23): what both sides need of Explain, Critique and the Note-taker. The server asks the model and checks what comes
 * back; the page shows it and keeps it in the notes. This module imports only ids.ts (the dependency rule of shared): the shapes of an answer, a highlight and a notebook block it reads are
 * written out here as the few fields it uses, and TypeScript holds them equal to documents.ts and notebook.ts where they meet.
 */

/** The agents of the drawer, in its order. Related comes with phase 4. */
export const READER_AGENTS = ["ask", "explain", "critique", "notes"] as const;
export type ReaderAgent = (typeof READER_AGENTS)[number];
export const READER_AGENT_LABEL: Record<ReaderAgent, string> = { ask: "Ask", explain: "Explain", critique: "Critique", notes: "Note-taker" };

/** The modes of POST /documents/:id/ask besides a plain question ("ask"), and of POST /documents/:id/ask-highlights ("notes"). */
export const ASK_MODES = ["ask", "explain", "critique"] as const;
export type AskMode = (typeof ASK_MODES)[number];

/** The most of a selection Explain takes (characters, after its white space is made single spaces). */
export const MAX_SELECTION_CHARS = 600;

/* ---------------------------------------------------------------- Critique */

/** The kinds of weak point a critique names (the model must pick one of these; a point of another kind is dropped). */
export const CRITIQUE_KINDS = ["thin_evidence", "missing_baseline", "overclaim", "limitation_stated", "limitation_unstated"] as const satisfies readonly CritiqueKind[];
export const CRITIQUE_KIND_LABEL: Record<CritiqueKind, string> = {
  thin_evidence: "Thin evidence",
  missing_baseline: "Missing baseline",
  overclaim: "Claim larger than the result",
  limitation_stated: "Limitation the authors state",
  limitation_unstated: "Limitation the authors do not state",
};
/** The label every point carries, on screen and in the notes. */
export const CRITIQUE_POINT_LABEL = "A reading of the paper, not a fact";
/** The most points a critique keeps. */
export const MAX_CRITIQUE_POINTS = 8;


/* ---------------------------------------------------------------- an answer kept in the notes */

type Cite = { n: number; page: number };

/** The pages an answer cites, in order, each once. */
export const citedPages = (citations: readonly Cite[]): number[] => [...new Set(citations.map((c) => c.page))].sort((a, b) => a - b);

/**
 * An answer's text with its marks written as pages, for the notes: "… [1][2]." becomes "… (p. 3, 4)." (a run of marks is one bracket, a page said once). A mark that names no citation is left out.
 * The notes never hold a mark: a mark means a passage of an answer that is not there any more.
 */
export function answerMarkdown(text: string, citations: readonly Cite[]): string {
  const pageOf = new Map(citations.map((c) => [c.n, c.page]));
  // each mark (and the white space before it) becomes a token, then a run of tokens one bracket: two passes with no backtracking (see replaceMarks)
  return replaceMarks(text, (_, n) => `\u0000${n}\u0001`)
    .replace(/(?:\u0000\d{1,2}\u0001)+/g, (run) => {
      const pages = [...new Set([...run.matchAll(/\u0000(\d{1,2})\u0001/g)].map((m) => pageOf.get(Number(m[1]))).filter((p): p is number => p !== undefined))];
      return pages.length ? ` (p. ${pages.join(", ")})` : "";
    })
    .replace(/ ([.,;:])/g, "$1")
    .trim();
}

/** A critique as Markdown for the notes: one item per point, its kind in bold, the point, the passage with its page, and the label. */
export function critiqueMarkdown(c: Pick<Critique, "points">): string {
  return c.points
    .map((p) => `- **${CRITIQUE_KIND_LABEL[p.kind]}.** ${p.text}\n  “${p.quote}” (p. ${p.page})\n  *${CRITIQUE_POINT_LABEL}.*`)
    .join("\n");
}

/* ---------------------------------------------------------------- the Note-taker */

/** The four stored highlight colours in the order of their meanings' headings (Key idea, Method, Question, Result). */
export const NOTES_ORDER = ["yellow", "green", "blue", "pink"] as const;
export type NotesColor = (typeof NOTES_ORDER)[number];
/** The meanings' names, used when the reader's legend is still the plain colour names. */
export const MEANING_NAMES: Record<NotesColor, string> = { yellow: "Key idea", green: "Method", blue: "Question", pink: "Result" };

/** A highlight as the Note-taker reads it (documents.ts DocNote has these fields). */
export type NotesHighlight = { id: string; page: number; quote: string; note: string; color: NotesColor };
/** What the draft is made of: text blocks (Markdown) and quote blocks of the reader's highlights (notebook.ts's TextBlock and QuoteBlock). */
export type DraftBlock = { id: string; kind: "text"; md: string } | { id: string; kind: "quote"; noteId: string | null; page: number; quote: string; color: NotesColor };
export type NotesDraft = { title: string; blocks: DraftBlock[] };
export const NOTES_DRAFT_TITLE = "Notes from my highlights";

const MAX_BULLET_CHARS = 400;
const MAX_FROM = 6;
/** characters of one text block of the draft (a notebook text block holds 8,000) */
const MAX_TEXT_BLOCK = 7_500;

const pagesSuffix = (pages: readonly number[]) => ` (p. ${[...new Set(pages)].sort((a, b) => a - b).join(", ")})`;
/** A bullet's words as one line: no marks, no page the model wrote (the draft writes the pages itself), no heading or list sign at its start, no line break. */
function cleanBullet(s: string): string {
  return s
    .replace(/【[^【】]*】/g, "")
    .replace(MARK, "")
    .replace(/\(\s?(?:pp?\.|pages?)[\d\s,–-]+\)/gi, "")
    .replace(/\s+/g, " ")
    .replace(/^(?:(?:[#>*+-]+|\d{1,3}[.)]) )+/, "")
    .trim()
    .slice(0, MAX_BULLET_CHARS)
    .trim();
}

/**
 * The draft page of the Note-taker, made from the model's bullets (`raw`: `{ bullets: [{ text, from, quote }] }`, `from` the numbers of the highlights a bullet comes from, 1-based in `used`):
 *   - a heading for each meaning that has something (Key idea, Method, Question, Result, in that order; `names` are the reader's names), the bullet going under the meaning of its first highlight;
 *   - a bullet that is its own words ends with the pages of its highlights ("(p. 3, 4)"), written here, never by the model, so a page is never lost or invented;
 *   - a bullet that is a quote (`quote: true`, one highlight) is a quote block of that highlight, linked to it;
 *   - a bullet that names no highlight of the list is dropped (`dropped`); a highlight no bullet used is put in as a quote under its meaning, so every highlight, and so every page, is kept.
 * The blocks get their ids from `newId`.
 */
export function buildNotesDraft(used: readonly NotesHighlight[], raw: unknown, names: Record<NotesColor, string>, newId: () => string): NotesDraft & { kept: number; dropped: number } {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { bullets?: unknown }).bullets) ? ((raw as { bullets: unknown[] }).bullets) : [];
  type Item = { kind: "text"; md: string } | { kind: "quote"; h: NotesHighlight };
  const groups = new Map<NotesColor, Item[]>(NOTES_ORDER.map((c) => [c, []]));
  const covered = new Set<number>();
  let kept = 0;
  let dropped = 0;
  for (const b of list) {
    const o = (b && typeof b === "object" ? b : {}) as { text?: unknown; from?: unknown; quote?: unknown };
    const from = [...new Set((Array.isArray(o.from) ? o.from : []).filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= used.length))].slice(0, MAX_FROM);
    if (from.length === 0) {
      dropped++;
      continue;
    }
    const first = used[from[0]! - 1]!;
    if (o.quote === true && from.length === 1) {
      groups.get(first.color)!.push({ kind: "quote", h: first });
      covered.add(from[0]!);
      kept++;
      continue;
    }
    const text = typeof o.text === "string" ? cleanBullet(o.text) : "";
    if (text.length < 3) {
      dropped++;
      continue;
    }
    for (const n of from) covered.add(n);
    groups.get(first.color)!.push({ kind: "text", md: `- ${text}${pagesSuffix(from.map((n) => used[n - 1]!.page))}` });
    kept++;
  }
  // a highlight that no bullet used is kept as itself, under its meaning
  used.forEach((h, i) => {
    if (!covered.has(i + 1)) groups.get(h.color)!.push({ kind: "quote", h });
  });

  const blocks: DraftBlock[] = [];
  let text: string[] = [];
  const flush = () => {
    if (text.length) blocks.push({ id: newId(), kind: "text", md: text.join("\n") });
    text = [];
  };
  for (const color of NOTES_ORDER) {
    const items = groups.get(color)!;
    if (items.length === 0) continue;
    flush();
    text.push(`## ${names[color].replace(/\s+/g, " ").trim() || MEANING_NAMES[color]}`);
    for (const it of items) {
      if (it.kind === "quote") {
        flush();
        blocks.push({ id: newId(), kind: "quote", noteId: it.h.id, page: it.h.page, quote: it.h.quote.replace(/\s+/g, " ").trim().slice(0, 600), color: it.h.color });
      } else {
        if (text.join("\n").length + it.md.length + 1 > MAX_TEXT_BLOCK) flush();
        text.push(it.md);
      }
    }
  }
  flush();
  return { title: NOTES_DRAFT_TITLE, blocks, kept, dropped };
}

/** The pages a draft names: those of its quotes and of the "(p. N)" of its bullets (what the eval holds equal to the highlights' pages). */
export function draftPages(d: Pick<NotesDraft, "blocks">): number[] {
  const pages = new Set<number>();
  for (const b of d.blocks) {
    if (b.kind === "quote") pages.add(b.page);
    else for (const m of b.md.matchAll(/\(p\. ([\d, ]+)\)/g)) for (const p of m[1]!.split(",")) pages.add(Number(p.trim()));
  }
  return [...pages].sort((a, b) => a - b);
}
