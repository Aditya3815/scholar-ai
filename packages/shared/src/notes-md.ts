import { NOTE_COLORS, type DocNote, type NoteColor } from "./documents";

/** What each highlight colour means to this reader: their own words, kept on their device and sent with a question about their highlights. */
export type Legend = Record<NoteColor, string>;
export const MAX_LEGEND_CHARS = 24;
export const DEFAULT_LEGEND: Legend = { yellow: "Important", green: "Method", blue: "Question", pink: "Disagree" };

const cleanName = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_LEGEND_CHARS).trim();
  return t || null;
};

/** A legend from anything (stored text, a request body): a colour with no usable name keeps its default one. Never throws. */
export function cleanLegend(raw: unknown): Legend {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(NOTE_COLORS.map((c) => [c, cleanName(o[c]) ?? DEFAULT_LEGEND[c]])) as Legend;
}

/** One line of text for a Markdown quote: line breaks and a leading marker cannot end the quote or start a list. */
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
/** Markdown that is safe to put in a heading: no line breaks, no leading `#`. */
const heading = (s: string) => oneLine(s).replace(/^#+\s*/, "");

export type MarkdownOptions = {
  legend?: Legend;
  /** "page" (default): one list in page order. "colour": a section for each colour, named from the legend. */
  groupBy?: "page" | "colour";
  /** Only these colours (default: all). */
  colours?: NoteColor[];
};

/**
 * The highlights and notes of a paper as Markdown: the quote with its page, then the reader's own words. Grouped by colour, each
 * section is named with what the colour means to the reader ("Important", "Method"...).
 */
export function notesMarkdown(title: string, notes: DocNote[], opts: MarkdownOptions = {}): string {
  const legend = opts.legend ?? DEFAULT_LEGEND;
  const keep = new Set<NoteColor>(opts.colours ?? NOTE_COLORS);
  const list = notes.filter((n) => keep.has(n.color));
  const item = (n: DocNote) => `> ${oneLine(n.quote)} (p. ${n.page})${n.note.trim() ? `\n\n${n.note.trim()}` : ""}`;
  const head = `# Notes on ${heading(title) || "this paper"}\n\n`;
  if (list.length === 0) return `${head}No highlights.\n`;
  if (opts.groupBy === "colour") {
    const sections = NOTE_COLORS.filter((c) => keep.has(c))
      .map((c) => ({ c, items: list.filter((n) => n.color === c) }))
      .filter((s) => s.items.length > 0)
      .map((s) => `## ${heading(legend[s.c])} (${s.c}, ${s.items.length})\n\n${s.items.map(item).join("\n\n")}`);
    return `${head}${sections.join("\n\n")}\n`;
  }
  return `${head}${list.map(item).join("\n\n")}\n`;
}
