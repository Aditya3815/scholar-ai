import { GENERAL_LABEL } from "./chat";
import type { AssistantMsg } from "./chat-state";
import type { Paper } from "./index";
import { apaReference } from "./litscan-review";

/*
 * "Copy the answer" (docs/design/chat-actions-context.md, decision A2): what a finished reply becomes as plain text on the clipboard. Pure, so it is tested without a browser.
 *
 * The rule is that nothing leaves the page that the page would not have shown. A mark [n] in the text means something only with its paper beside it, so the checked answer is followed by the
 * papers it cites, built from the search's own records (never written by a model); a mark that cannot be backed is not copied; background from general knowledge is copied only with its
 * label line, which is part of the text and so cannot be separated from it outside the page; and what is copied is the checked text, never the words that were still arriving.
 */

/** A source mark in a text: the same shape the screen turns into a button (`AnswerText`). The space before it goes with it. */
const MARK = /\s*\[(\d{1,2})\]/g;
/** Controls and line separators: a record's field is one line, whatever it holds. */
const CONTROLS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g;
/**
 * Characters that change how text reads without showing: zero-width space, left-to-right and right-to-left marks and overrides and isolates, word joiner and the invisible operators, the byte-order
 * mark, and tag characters. U+200C and U+200D are NOT here: Hindi and other scripts need them to spell some words and conjuncts.
 */
const INVISIBLE = /[\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\u{E0000}-\u{E007F}]/gu;

/**
 * A field of a record made safe for one line of a list: controls and line breaks become a space, invisible characters go, white space is collapsed, and a number in square brackets
 * becomes the same number in round ones. A title or a name is data from an index, and one that carried a line break and "[2] ..." could otherwise write a source of its own into what was
 * copied. A "](" gets a space, so that a title that is written as a Markdown link does not become one where the text is pasted. Anything but a string is nothing.
 */
const plain = (s: unknown): string => (typeof s === "string" ? s.replace(CONTROLS, " ").replace(INVISIBLE, "").replace(/\s+/g, " ").trim().replace(/\[(\d{1,2})\]/g, "($1)").replace(/\]\(/g, "] (") : "");
/** A link as one http(s) address with no break in it, or nothing: a record's field is not trusted to be a link. */
const link = (s: unknown): string | null => {
  const v = plain(s).replace(/\s/g, "");
  return /^https?:\/\/\S+$/i.test(v) ? v : null;
};

/**
 * One numbered line of a list of sources, from the record's own fields (`apaReference`: no volume or pages are invented). `n` is the paper's number on the page, which the marks use. A retracted
 * paper says so (a list of papers found is not only of papers an answer could use), as its card does.
 */
function sourceLine(n: number, p: Paper): string {
  const authors = Array.isArray(p.authors) ? p.authors.map(plain).filter(Boolean) : [];
  const doi = plain(p.doi).replace(/\s/g, "");
  const ref = apaReference({ authors, year: Number.isInteger(p.year) ? p.year : null, title: plain(p.title) || "Untitled", venue: plain(p.venue) || null, doi: doi || null, url: link(p.url) ?? link(p.oaUrl) });
  return `[${n}] ${ref}${p.retracted ? " (retracted)" : ""}`;
}

/**
 * The checked answer, ready to copy: its text, and the papers it cites. Only a citation that this reply can stand behind counts: its mark is in the list, the paper is in that place, and
 * it is the paper the citation names (the same guard that decides whether a strict check is possible). A mark the answer has that is not backed (one made up, one for another paper, one that
 * no citation names) is taken out of the copied text, and its paper is not listed. When nothing is left to stand behind, the answer's words are not copied at all.
 */
function checkedPart(m: AssistantMsg): { text: string; cited: number[] } | null {
  const a = m.answer;
  if (!a || !a.grounded || typeof a.text !== "string" || a.text.trim() === "" || !Array.isArray(a.citations)) return null;
  const backed = new Set<number>();
  for (const c of a.citations) {
    const p = Number.isInteger(c.n) ? m.papers[c.n - 1] : undefined;
    if (p && p.id === c.paperId) backed.add(c.n);
  }
  const text = a.text.replace(MARK, (all, d: string) => (backed.has(Number(d)) ? all : "")).trim();
  const cited = [...new Set([...text.matchAll(MARK)].map((x) => Number(x[1])))].sort((x, y) => x - y);
  return cited.length > 0 ? { text, cited } : null;
}

/**
 * What a finished reply copies as, and what to call it: "answer" (the checked answer with the papers it cites, and/or background under its label) or "papers" (a reply that has no written answer
 * copies its list of papers, numbered as on the page). Null while the reply is being written and for one that stopped, failed or was interrupted (never the half-written words), and when there
 * is nothing to copy (an offer to open another tool, a greeting, an empty search). A reply whose papers did not answer, with background, copies the background only: the papers are not its sources.
 */
export function answerCopy(m: AssistantMsg): { text: string; what: "answer" | "papers" } | null {
  if (m.status !== "done") return null;
  const parts: string[] = [];
  const checked = checkedPart(m);
  if (checked) parts.push(`${checked.text}\n\nSources\n${checked.cited.map((n) => sourceLine(n, m.papers[n - 1]!)).join("\n")}`);
  // general background is written only when the papers did not answer, but whenever it is copied it has its label, and no source mark (it cites nothing)
  const g = m.general;
  if (g?.kind === "background" && typeof g.text === "string" && g.text.replace(MARK, "").trim() !== "") parts.push(`${GENERAL_LABEL}\n${g.text.replace(MARK, "").trim()}`);
  if (parts.length > 0) return { text: parts.join("\n\n"), what: "answer" };
  return m.papers.length > 0 ? { text: m.papers.map((p, i) => sourceLine(i + 1, p)).join("\n"), what: "papers" } : null;
}

/** The text "Copy the answer" puts on the clipboard, or null when there is none (see `answerCopy`). */
export const answerAsText = (m: AssistantMsg): string | null => answerCopy(m)?.text ?? null;

/**
 * Write to the clipboard by one way after another until one works. A way that answers false, throws, or REJECTS (a refused permission, a page without the press that asked for it) hands over
 * to the next: a failure must not end as a button that did nothing. The first way starts before anything is awaited, because Safari and Firefox take a clipboard write only inside the press that
 * asked for it. The ways themselves (the clipboard API, a selected text field) are in the browser's code, `apps/web/src/lib/copy.ts`.
 */
export async function copyThrough(ways: readonly ((text: string) => boolean | Promise<boolean>)[], text: string): Promise<boolean> {
  for (const way of ways) {
    try {
      if (await way(text)) return true;
    } catch {
      /* the next way */
    }
  }
  return false;
}
