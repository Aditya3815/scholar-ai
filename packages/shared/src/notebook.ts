/**
 * The Notebook of the new Paper Reader (docs/design/paper-reader.md, section 19): a paper's pages of notes, each a column of blocks. The blocks are a closed union, and the checks and
 * limits here are the ones both sides use: the page before it sends a page, the server before it stores one (a block is untrusted input, so every number and kind is checked again
 * there, and anything outside the union is refused, never dropped).
 *
 * This module imports nothing (the dependency rule of shared, layers.test.ts): the four highlight colours are written out here, and a test holds them equal to NOTE_COLORS.
 */

/** The limits of a notebook. A page is one row on the server, so a save sends one page and never the whole notebook. */
export const NOTEBOOK_LIMITS = {
  /** pages per paper */
  pages: 50,
  /** blocks per page */
  blocks: 200,
  /** bytes of a page's blocks as JSON (UTF-8) */
  pageBytes: 48 * 1024,
  /** bytes of every page of one paper together */
  paperBytes: 1024 * 1024,
  /** characters of a page's title */
  title: 120,
  /** characters of an id (a page's or a block's): [A-Za-z0-9_-] */
  id: 40,
  /** characters of a text block's Markdown */
  text: 8000,
  /** characters of the copy of a highlight in a quote block */
  quote: 600,
  /** characters of an agent answer's text, and its name (phase 3) */
  answer: 8000,
  agent: 40,
  /** pages an agent answer may cite (phase 3) */
  answerPages: 50,
} as const;

/** A request body can be no bigger than a full page plus its envelope (rev, title, style, position). */
export const MAX_NOTEBOOK_BODY = NOTEBOOK_LIMITS.pageBytes + 4 * 1024;

export const NOTEBOOK_STYLES = ["plain", "ruled", "dotted", "grid"] as const;
export type NotebookStyle = (typeof NOTEBOOK_STYLES)[number];

/** The four stored highlight colours (documents.ts NOTE_COLORS; equal, by test). */
export const QUOTE_COLORS = ["yellow", "green", "blue", "pink"] as const;
export type QuoteColor = (typeof QUOTE_COLORS)[number];

export type TextBlock = { id: string; kind: "text"; md: string };
/** A highlight, live-linked by `noteId` (null once the highlight is removed); `quote` is a copy, so the block outlives the highlight. */
export type QuoteBlock = { id: string; kind: "quote"; noteId: string | null; page: number; quote: string; color: QuoteColor };
/** A part of a page, as a place (fractions of the page), never a picture. Phase 3: the server refuses it until then. */
export type CaptureBlock = { id: string; kind: "capture"; page: number; x: number; y: number; w: number; h: number };
/** An agent's answer kept in the notes. Phase 3: the server refuses it until then. */
export type AnswerBlock = { id: string; kind: "answer"; agent: string; text: string; pages: number[] };
export type NotebookBlock = TextBlock | QuoteBlock | CaptureBlock | AnswerBlock;
export type NotebookBlockKind = NotebookBlock["kind"];
export const NOTEBOOK_BLOCK_KINDS = ["text", "quote", "capture", "answer"] as const satisfies readonly NotebookBlockKind[];
/** The kinds the server accepts today (phase 2). Capture and answer come with phase 3. */
export const NOTEBOOK_KINDS_NOW: readonly NotebookBlockKind[] = ["text", "quote"];

/** One page as the server sends it. */
export type NotebookPage = { id: string; title: string; style: NotebookStyle; position: number; blocks: NotebookBlock[]; rev: number; updatedAt: number };

const ID = /^[A-Za-z0-9_-]+$/;
/** An id made by the browser: 1 to 40 characters from [A-Za-z0-9_-]. */
export const isNotebookId = (v: unknown): v is string => typeof v === "string" && v.length >= 1 && v.length <= NOTEBOOK_LIMITS.id && ID.test(v);

/** A page's title: whitespace made single spaces, trimmed, cut to 120 characters. null when it is not a string. */
export function cleanNotebookTitle(v: unknown): string | null {
  if (typeof v !== "string") return null;
  return v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, NOTEBOOK_LIMITS.title).trim();
}
export const isNotebookStyle = (v: unknown): v is NotebookStyle => (NOTEBOOK_STYLES as readonly unknown[]).includes(v);
/** A page's place among the paper's pages: any finite number (a move takes the midpoint of its neighbours, so nothing is renumbered). */
export const isNotebookPosition = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1e12;

/** A text block's Markdown as it is kept: line ends made \n, control characters other than a tab and a line break taken out. Nothing else changes: it is what the person typed. */
export const cleanBlockText = (s: string): string => s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
/** A quote is a copy of the paper's text layer: one line, as highlights are kept. */
const cleanQuote = (s: string): string => s.replace(/\s+/g, " ").trim();

/** The size of a page's blocks as the server stores them (JSON, UTF-8 bytes). */
export const notebookBytes = (blocks: readonly NotebookBlock[]): number => new TextEncoder().encode(JSON.stringify(blocks)).length;

export type BlocksCheck = { ok: true; blocks: NotebookBlock[] } | { ok: false; status: 400 | 413; reason: string };

const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
const isFrac = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;

/** One block, rebuilt from its known fields only; a string saying what is wrong when it cannot be. */
function checkBlock(raw: unknown, maxPage: number, kinds: readonly NotebookBlockKind[]): NotebookBlock | string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "a block is not an object";
  const b = raw as Record<string, unknown>;
  if (!isNotebookId(b.id)) return "a block's id is missing or not valid";
  if (!(NOTEBOOK_BLOCK_KINDS as readonly unknown[]).includes(b.kind)) return `a block's kind is not one of ${NOTEBOOK_BLOCK_KINDS.join(", ")}`;
  const kind = b.kind as NotebookBlockKind;
  if (!kinds.includes(kind)) return `blocks of the kind "${kind}" are not accepted yet`;
  switch (kind) {
    case "text": {
      if (typeof b.md !== "string") return "a text block has no text";
      const md = cleanBlockText(b.md);
      if (md.length > NOTEBOOK_LIMITS.text) return `too long: a text block holds at most ${NOTEBOOK_LIMITS.text} characters`;
      return { id: b.id, kind, md };
    }
    case "quote": {
      if (b.noteId !== null && !isNotebookId(b.noteId)) return "a quote's highlight id is not valid";
      if (!isInt(b.page, 1, maxPage)) return "a quote's page is not in this paper";
      if (typeof b.quote !== "string") return "a quote has no text";
      const quote = cleanQuote(b.quote);
      if (quote.length < 1) return "a quote is empty";
      if (quote.length > NOTEBOOK_LIMITS.quote) return `too long: a quote holds at most ${NOTEBOOK_LIMITS.quote} characters`;
      if (!(QUOTE_COLORS as readonly unknown[]).includes(b.color)) return "a quote's colour is not one of the four";
      return { id: b.id, kind, noteId: b.noteId as string | null, page: b.page, quote, color: b.color as QuoteColor };
    }
    case "capture": {
      if (!isInt(b.page, 1, maxPage)) return "a capture's page is not in this paper";
      if (!isFrac(b.x) || !isFrac(b.y) || !isFrac(b.w) || !isFrac(b.h) || b.w === 0 || b.h === 0 || b.x + b.w > 1.000001 || b.y + b.h > 1.000001) return "a capture's place is not inside its page";
      return { id: b.id, kind, page: b.page, x: b.x, y: b.y, w: b.w, h: b.h };
    }
    case "answer": {
      if (typeof b.agent !== "string" || b.agent.length < 1 || b.agent.length > NOTEBOOK_LIMITS.agent) return "an answer's agent is not valid";
      if (typeof b.text !== "string") return "an answer has no text";
      const text = cleanBlockText(b.text);
      if (text.length > NOTEBOOK_LIMITS.answer) return `too long: an answer holds at most ${NOTEBOOK_LIMITS.answer} characters`;
      if (!Array.isArray(b.pages) || b.pages.length > NOTEBOOK_LIMITS.answerPages || !b.pages.every((p) => isInt(p, 1, maxPage))) return "an answer's pages are not in this paper";
      return { id: b.id, kind, agent: b.agent, text, pages: [...(b.pages as number[])] };
    }
  }
}

/**
 * A page's blocks, checked: a list of at most 200 blocks of the kinds accepted (`kinds`, phase 2: text and quote), each id unique on the page, every number in range (`maxPage` is the
 * paper's page count), at most 48 KB as JSON. Too many or too big is 413; anything else wrong is 400, with what is wrong.
 */
export function checkNotebookBlocks(raw: unknown, maxPage: number, kinds: readonly NotebookBlockKind[] = NOTEBOOK_KINDS_NOW): BlocksCheck {
  if (!Array.isArray(raw)) return { ok: false, status: 400, reason: "blocks must be a list" };
  if (raw.length > NOTEBOOK_LIMITS.blocks) return { ok: false, status: 413, reason: `too many blocks: a page holds at most ${NOTEBOOK_LIMITS.blocks}` };
  const out: NotebookBlock[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const b = checkBlock(r, maxPage, kinds);
    if (typeof b === "string") return { ok: false, status: b.startsWith("too long") ? 413 : 400, reason: b };
    if (seen.has(b.id)) return { ok: false, status: 400, reason: "two blocks have the same id" };
    seen.add(b.id);
    out.push(b);
  }
  if (notebookBytes(out) > NOTEBOOK_LIMITS.pageBytes) return { ok: false, status: 413, reason: `too big: a page holds at most ${NOTEBOOK_LIMITS.pageBytes / 1024} KB` };
  return { ok: true, blocks: out };
}

/* ---------------------------------------------------------------- Markdown export */

export type NotebookExportPage = { title: string; blocks: readonly NotebookBlock[] };

/**
 * The pages as one Markdown text: the paper's title, each page under its own heading, a text block as it was written (its headings put under the page's: # is ###), a quote as a
 * Markdown quote with its meaning and page ("Key idea, p. 4"; `names` gives each colour's name), an answer with its agent and pages, a capture as the place it is.
 */
export function notebookMarkdown(paperTitle: string, pages: readonly NotebookExportPage[], names: Record<QuoteColor, string>): string {
  const out: string[] = [`# ${paperTitle.replace(/\s+/g, " ").trim() || "Notes"}`, ""];
  for (const p of pages) {
    out.push(`## ${p.title.trim() || "Untitled page"}`, "");
    for (const b of p.blocks) {
      if (b.kind === "text") {
        const md = b.md.replace(/^(#{1,3}) /gm, "##$1 ").trim();
        if (md) out.push(md, "");
      } else if (b.kind === "quote") {
        out.push(`> ${b.quote}`, `> (${names[b.color]}, p. ${b.page})`, "");
      } else if (b.kind === "answer") {
        out.push(`**${b.agent}**${b.pages.length ? ` (p. ${b.pages.join(", ")})` : ""}`, "", b.text.trim(), "");
      } else {
        out.push(`*A part of page ${b.page} (captured)*`, "");
      }
    }
  }
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}
