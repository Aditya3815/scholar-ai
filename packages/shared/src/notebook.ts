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
  /** bytes of a page's blocks as JSON (UTF-8); 128 KB since phase 2.5, as one sketch can be tens of KB */
  pageBytes: 128 * 1024,
  /** bytes of every page of one paper together (2 MB since phase 2.5) */
  paperBytes: 2 * 1024 * 1024,
  /** characters of a page's title */
  title: 120,
  /** characters of an id (a page's or a block's): [A-Za-z0-9_-] */
  id: 40,
  /** characters of a text block's Markdown */
  text: 8000,
  /** characters of the copy of a highlight in a quote block */
  quote: 600,
  /** characters of an agent's answer kept in the notes (Markdown, with its "p. N"), and of what it was asked (the question, or the selection explained) (phase 3) */
  answer: 8000,
  ask: 600,
  /** pages an agent answer may cite (phase 3) */
  answerPages: 50,
  /** characters of a capture's caption */
  caption: 500,
  /** a sketch's height in CSS pixels */
  sketchMin: 120,
  sketchMax: 800,
  /** strokes of one sketch, and points (x, y, pressure) of all its strokes together */
  sketchStrokes: 400,
  sketchPoints: 20_000,
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
export const CAPTURE_SIZES = ["s", "m", "full"] as const;
export type CaptureSize = (typeof CAPTURE_SIZES)[number];
/** A part of a page, as a place (fractions of the page as it is shown, rotation included), never a picture: it is drawn from the open paper. A caption under it, and its size in the notes. */
export type CaptureBlock = { id: string; kind: "capture"; page: number; x: number; y: number; w: number; h: number; caption: string; size: CaptureSize };
/** The pen and highlighter colours of a sketch (equal to ink.ts's, by test: this module imports nothing). */
export const SKETCH_PEN_COLORS = ["ink", "blue", "red", "green", "orange", "violet"] as const;
export const SKETCH_HIGHLIGHTER_COLORS = ["yellow", "green", "pink", "blue", "orange"] as const;
/** A stroke of a sketch: the ink shape of the reader's pen and highlighter, its points as fractions of the sketch's width on both axes (x, y, pressure, ...). */
export type SketchStroke = { id: string; tool: "pen" | "highlighter"; color: string; w: number; pts: number[] };
/** A drawing area in the notes (phase 2.5): its height in CSS pixels and its strokes. */
export type SketchBlock = { id: string; kind: "sketch"; height: number; strokes: SketchStroke[] };
/** The kinds of picture a note may hold (equal to note-image.ts's, by test: this module imports nothing). */
export const NOTEBOOK_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
/**
 * A picture added to the notes (phase 2.5, the owner's yes of 18 Nov): its file is kept apart (R2, under the paper and this block's id) and served only to its owner; the block holds
 * its size in pixels, its kind and the words that say what it shows.
 */
export type ImageBlock = { id: string; kind: "image"; w: number; h: number; type: (typeof NOTEBOOK_IMAGE_TYPES)[number]; alt: string; width?: number };
/**
 * How wide a picture is shown in the notes (and in their exports): a fraction of the page's width, from 0.2 to 1, kept to three places; a picture with none is shown as wide as the page lets it
 * (as before 20 Nov 2026). S, M and Full are quick choices of it, the same as a capture's.
 */
export const IMAGE_WIDTH = { min: 0.2, max: 1 } as const;
export const IMAGE_SIZE_WIDTH = { s: 0.33, m: 0.6, full: 1 } as const;
export const clampImageWidth = (v: number): number => Math.round(Math.min(IMAGE_WIDTH.max, Math.max(IMAGE_WIDTH.min, v)) * 1000) / 1000;
/** The agents whose answers can be kept in the notes ("+ Add to notes", phase 3); the Note-taker makes a page of its own, not a block. */
export const NOTEBOOK_AGENTS = ["ask", "explain", "critique"] as const;
export type NotebookAgent = (typeof NOTEBOOK_AGENTS)[number];
export const NOTEBOOK_AGENT_LABEL: Record<NotebookAgent, string> = { ask: "Ask", explain: "Explain", critique: "Critique" };
/**
 * An agent's answer kept in the notes (phase 3, docs/design/paper-reader.md, 24): which agent, what it was asked (the question, or the selection it explained), the answer as Markdown in which every
 * citation is written as its page ("p. 4"), the pages it cites, and when it was made (ms since 1970).
 */
export type AgentBlock = { id: string; kind: "agent"; agent: NotebookAgent; ask: string; md: string; pages: number[]; at: number };
export type NotebookBlock = TextBlock | QuoteBlock | CaptureBlock | SketchBlock | ImageBlock | AgentBlock;
export type NotebookBlockKind = NotebookBlock["kind"];
export const NOTEBOOK_BLOCK_KINDS = ["text", "quote", "capture", "sketch", "image", "agent"] as const satisfies readonly NotebookBlockKind[];
/** The kinds the server accepts (phase 3): every kind. */
export const NOTEBOOK_KINDS_NOW: readonly NotebookBlockKind[] = NOTEBOOK_BLOCK_KINDS;

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
      if (typeof b.caption !== "string") return "a capture has no caption field";
      const caption = cleanQuote(b.caption);
      if (caption.length > NOTEBOOK_LIMITS.caption) return `too long: a caption holds at most ${NOTEBOOK_LIMITS.caption} characters`;
      if (!(CAPTURE_SIZES as readonly unknown[]).includes(b.size)) return "a capture's size is not s, m or full";
      return { id: b.id, kind, page: b.page, x: b.x, y: b.y, w: b.w, h: b.h, caption, size: b.size as CaptureSize };
    }
    case "sketch": {
      if (!isInt(b.height, NOTEBOOK_LIMITS.sketchMin, NOTEBOOK_LIMITS.sketchMax)) return `a sketch's height is not from ${NOTEBOOK_LIMITS.sketchMin} to ${NOTEBOOK_LIMITS.sketchMax}`;
      if (!Array.isArray(b.strokes)) return "a sketch has no strokes list";
      if (b.strokes.length > NOTEBOOK_LIMITS.sketchStrokes) return `too long: a sketch holds at most ${NOTEBOOK_LIMITS.sketchStrokes} strokes`;
      const strokes: SketchStroke[] = [];
      let points = 0;
      // the y of a point is a fraction of the width too, so it may pass 1 on a sketch taller than wide: at most its height over its narrowest width (120 px)
      const maxY = NOTEBOOK_LIMITS.sketchMax / 120;
      for (const r of b.strokes as unknown[]) {
        if (!r || typeof r !== "object" || Array.isArray(r)) return "a stroke is not an object";
        const t = r as Record<string, unknown>;
        if (!isNotebookId(t.id)) return "a stroke's id is not valid";
        if (t.tool !== "pen" && t.tool !== "highlighter") return "a stroke's tool is not pen or highlighter";
        const palette: readonly string[] = t.tool === "pen" ? SKETCH_PEN_COLORS : SKETCH_HIGHLIGHTER_COLORS;
        if (typeof t.color !== "string" || !palette.includes(t.color)) return "a stroke's colour is not one of its tool's";
        if (typeof t.w !== "number" || !Number.isFinite(t.w) || t.w <= 0 || t.w > 0.1) return "a stroke's width is not valid";
        const pts = t.pts;
        if (!Array.isArray(pts) || pts.length < 3 || pts.length % 3 !== 0) return "a stroke's points are not x, y, pressure triples";
        for (let k = 0; k < pts.length; k += 3) {
          const x = pts[k], y = pts[k + 1], p = pts[k + 2];
          if (!isFrac(x) || typeof y !== "number" || !Number.isFinite(y) || y < 0 || y > maxY || !isFrac(p)) return "a stroke's point is outside its sketch";
        }
        points += pts.length / 3;
        if (points > NOTEBOOK_LIMITS.sketchPoints) return `too long: a sketch holds at most ${NOTEBOOK_LIMITS.sketchPoints} points`;
        strokes.push({ id: t.id, tool: t.tool, color: t.color, w: t.w, pts: [...(pts as number[])] });
      }
      return { id: b.id, kind, height: b.height, strokes };
    }
    case "image": {
      if (!isInt(b.w, 1, 2000) || !isInt(b.h, 1, 2000)) return "a picture's size is not from 1 to 2000 pixels a side";
      if (!(NOTEBOOK_IMAGE_TYPES as readonly unknown[]).includes(b.type)) return "a picture is not a JPEG, PNG or WebP";
      if (typeof b.alt !== "string") return "a picture has no words for what it shows";
      const alt = cleanQuote(b.alt);
      if (alt.length > 300) return "too long: the words for a picture are at most 300 characters";
      if (b.width !== undefined && (typeof b.width !== "number" || !Number.isFinite(b.width) || b.width < IMAGE_WIDTH.min || b.width > IMAGE_WIDTH.max)) return `a picture's width is not from ${IMAGE_WIDTH.min} to ${IMAGE_WIDTH.max} of the page`;
      return { id: b.id, kind, w: b.w, h: b.h, type: b.type as ImageBlock["type"], alt, ...(b.width !== undefined ? { width: clampImageWidth(b.width as number) } : {}) };
    }
    case "agent": {
      if (!(NOTEBOOK_AGENTS as readonly unknown[]).includes(b.agent)) return `an answer's agent is not one of ${NOTEBOOK_AGENTS.join(", ")}`;
      if (typeof b.ask !== "string") return "an answer has no question";
      const ask = cleanQuote(b.ask);
      if (ask.length > NOTEBOOK_LIMITS.ask) return `too long: what an agent was asked holds at most ${NOTEBOOK_LIMITS.ask} characters`;
      if (typeof b.md !== "string") return "an answer has no text";
      const md = cleanBlockText(b.md);
      if (md.trim().length < 1) return "an answer is empty";
      if (md.length > NOTEBOOK_LIMITS.answer) return `too long: an answer holds at most ${NOTEBOOK_LIMITS.answer} characters`;
      if (!Array.isArray(b.pages) || b.pages.length > NOTEBOOK_LIMITS.answerPages || !b.pages.every((p) => isInt(p, 1, maxPage))) return "an answer's pages are not in this paper";
      if (new Set(b.pages).size !== b.pages.length) return "an answer names a page twice";
      if (!isInt(b.at, 0, 8_640_000_000_000_000)) return "an answer's time is not valid";
      return { id: b.id, kind, agent: b.agent as NotebookAgent, ask, md, pages: [...(b.pages as number[])], at: b.at };
    }
  }
}

/**
 * A page's blocks, checked: a list of at most 200 blocks of the kinds accepted (`kinds`, phase 2: text and quote), each id unique on the page, every number in range (`maxPage` is the
 * paper's page count), at most 128 KB as JSON. Too many or too big is 413; anything else wrong is 400, with what is wrong.
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

/** The small header of an agent's answer: "Explain · p. 3, 4" (the name alone when it cites no page). */
export const agentHeading = (b: Pick<AgentBlock, "agent" | "pages">): string => `${NOTEBOOK_AGENT_LABEL[b.agent]}${b.pages.length ? ` · p. ${[...b.pages].sort((x, y) => x - y).join(", ")}` : ""}`;

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
      } else if (b.kind === "agent") {
        out.push(agentHeading(b), ...(b.ask ? [`*${b.agent === "explain" ? "Explained" : "Asked"}: ${b.ask}*`] : []), "", b.md.replace(/^(#{1,3}) /gm, "##$1 ").trim(), "");
      } else if (b.kind === "capture") {
        out.push(`*A part of page ${b.page} (captured)*${b.caption ? `: ${b.caption}` : ""}`, "");
      } else if (b.kind === "sketch") {
        out.push(`*A sketch (${b.strokes.length} ${b.strokes.length === 1 ? "stroke" : "strokes"})*`, "");
      } else {
        out.push(`*A picture*${b.alt ? `: ${b.alt}` : ""}${b.width !== undefined && b.width < 1 ? ` (shown at ${Math.round(b.width * 100)}% of the page's width)` : ""}`, "");
      }
    }
  }
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}
