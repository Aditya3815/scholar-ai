import type { AnswerLanguage } from "./chat-context";

/**
 * The Reading (docs/design/intent-and-state.md, 3.2, 4.8 and 5.3): what the page understood of a message in Auto, shown under the line "I searched for". R8 (the request-frame cleaner) is the only release that
 * makes one so far. It carries the words searched, the phrases that were left out and the notes about what the box could not do with them, and nothing else: no model writes any of it, and every line the page
 * builds from it (`readingLines`) is a fixed sentence of 5.3 with the person's own words put into its braces.
 *
 * What this file holds is the part the page needs: the type, the fixed sentences and the little pure functions that read a Reading. The words the cleaner takes out are on the server only (apps/api/src/understand/frame.ts).
 *
 * R8 sets `source`, `topic`, `left`, `notes` and, for an answer language asked for in words, `answerLanguage`. `assumed`, `suggested`, `years` and `count` are the fields of the later releases (R12, R14, R16); they are
 * typed here so that "nothing to show" can be said for all of them at once (`readingIsQuiet`), and R8 never sets them.
 */

/** The notes of R8, closed. Each has one fixed sentence (`noteText`). `scrub` (R11) and the other releases' notes are not here yet. */
export const NOTE_KINDS = ["all", "recent", "count", "negation", "form", "order", "author", "venue", "threshold", "prove", "person"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

/** A note and, for those whose sentence names it, the words it is about: an exact piece of the person's message. */
export type ReadingNote = { kind: NoteKind; phrase?: string };

export type Reading = {
  v: 1;
  source: "rules" | "model" | "resolver";
  /** The words the search sources were asked: the message less what was left out (never longer than the message, which is at most 300 characters here, and every word of it one the person wrote). */
  topic: string;
  /** The pieces of the message that were taken out, in the order they stand in it. Each is an exact piece of it. */
  left: string[];
  notes: ReadingNote[];
  /** R8: an answer language the person asked for in words ("answer in Hindi"); the writer uses it. */
  answerLanguage?: AnswerLanguage;
  /** R12 and R14 (never set by R8). */
  assumed?: { from: string; to: string; why: "spelling" | "acronym" }[];
  suggested?: { from: string; to: string }[];
  /** R16 (never set by R8). */
  years?: { from?: number; to?: number };
  count?: number;
};

/** How many pieces a Reading may say were left out, and how long one may be. A message that needs more is searched as written. */
export const MAX_LEFT = 5;
export const MAX_LEFT_CHARS = 40;
/** The personal-details strip takes out a word here and there (I, my, an age): its pieces are many and short, so it has a larger count. */
export const MAX_LEFT_PERSON = 12;
/** The longest a note's phrase is: an exact piece of the message, cut at a word. */
export const MAX_NOTE_PHRASE = 60;
/** The longest a whole Reading is, in characters of its text (the topic, the pieces and the phrases). */
export const MAX_READING_CHARS = 600;

/* ---------------------------------------------------------------- reading the words */

const LETTER = /[\p{L}\p{M}\p{N}]/u;
const isWordChar = (ch: string | undefined): boolean => ch !== undefined && LETTER.test(ch);

/**
 * The words once pieces have been taken out: white space is one space, and the marks that were only holding the taken piece in place (a comma, a colon, a question mark) are cut from both ends, together
 * with a full stop at the end of a word that is not an abbreviation ("U.S." and "et al." keep theirs). The ONE function that makes a topic: the server makes it and the page makes it again to put a piece back.
 */
export function tidyWords(s: string): string {
  let t = s.replace(/\s+/g, " ").replace(/^[\s,;:!?]+/u, "").replace(/[\s,;:!?]+$/u, "");
  if (t.endsWith(".")) {
    const last = /(\S+)\.$/u.exec(t)?.[1] ?? "";
    const letters = (last.match(/\p{L}/gu) ?? []).length;
    const abbreviation = letters <= 2 || last.includes(".") || (letters >= 2 && last === last.toUpperCase() && last !== last.toLowerCase());
    if (!abbreviation) t = t.slice(0, -1).replace(/[\s,;:!?]+$/u, "");
  }
  return t;
}

/** The words after which a capital I is a Roman numeral and not a person ("type I diabetes", "phase I trial"). */
const ROMAN_HEADS = /(?<![\p{L}\p{M}\p{N}_'’-])(?:type|phase|stage|grade|class|tier|group|level|factor|war|chapter|part|table|figure|fig|vitamin|hepatitis|cohort|schedule|annex|appendix|category)\s+$/iu;
/** Is the "I" at `at` in `text` a Roman numeral (the word before it numbers a thing)? The server's personal-details strip and the page's "put it back" both skip such an I, so that they find the same ones. */
export const isRomanNumeralI = (text: string, at: number): boolean => ROMAN_HEADS.test(text.slice(Math.max(0, at - 14), at));

/** Where `phrase` stands in `text` at or after `from`, as a whole word run: the character before and after it, if it is a letter or a digit, is not a neighbour of the phrase's own edge (so "my" is not found in "myocardial"). -1 if none. */
export function findPhrase(text: string, phrase: string, from: number): number {
  if (phrase === "") return -1;
  const first = [...phrase][0];
  const last = [...phrase].at(-1);
  let at = text.indexOf(phrase, from);
  while (at >= 0) {
    const before = at > 0 ? text[at - 1] : undefined;
    const after = text[at + phrase.length];
    const leftOk = !(isWordChar(first) && isWordChar(before));
    const rightOk = !(isWordChar(last) && isWordChar(after));
    if (leftOk && rightOk && !(phrase.toLowerCase() === "i" && isRomanNumeralI(text, at))) return at;
    at = text.indexOf(phrase, at + 1);
  }
  return -1;
}

/**
 * The message with the pieces of `left` taken out, as the topic is made, and without those in `keep` (their places, in `left`). The pieces are found in order, each at or after the end of the one before it, so
 * the same piece twice is two places; null when one is not found, which means the Reading is not about this message. The server uses it to check the topic it made, and the page uses it to search again with
 * one piece put back.
 */
export function withoutLeft(message: string, left: readonly string[], keep: ReadonlySet<number> = new Set()): string | null {
  const text = message.replace(/\s+/g, " ").trim();
  let out = "";
  let at = 0;
  for (let i = 0; i < left.length; i++) {
    const piece = left[i]!;
    const found = findPhrase(text, piece, at);
    if (found < 0) return null;
    out += text.slice(at, found) + (keep.has(i) ? piece : " ");
    at = found + piece.length;
  }
  return tidyWords(out + text.slice(at));
}

/** The words to search when only the piece `i` of `left` is put back (the others stay out); null if the message does not hold them. */
export const restoreWords = (message: string, left: readonly string[], i: number): string | null => withoutLeft(message, left, new Set([i]));

/* ---------------------------------------------------------------- the fixed sentences (5.3) */

const code = (n: number): string => String.fromCharCode(n);
/** The curly quotes round a piece of the person's own words in a sentence. */
export const quoted = (phrase: string): string => `${code(0x201c)}${phrase}${code(0x201d)}`;

/** "Left out:", the label of the line whose pieces are the chips. */
export const LEFT_OUT_LABEL = "Left out:";
/** What is asked when nothing is left to search once a personal clause is taken out (5.2, S-NO-TOPIC), in English: the personal-details strip is the only way to it, and it applies to English messages only. */
export const NO_TOPIC_TEXT = `What would you like to look up? Write a topic, for example ${code(0x201c)}screen time and sleep in children${code(0x201d)}.`;

/** The fixed sentence of a note (5.3), with the person's words in its braces. A sentence that names a piece of the message and has none is not given (null): nothing is guessed. */
export function noteText(note: ReadingNote): string | null {
  const p = note.phrase === undefined || note.phrase === "" ? null : quoted(note.phrase);
  switch (note.kind) {
    case "all":
      return "This box shows the 20 best matches, not every paper.";
    case "recent":
      return p && `This search cannot sort by date yet, so ${p} was left out.`;
    case "count":
      return p && `${p} was left out of the words searched.`;
    case "negation":
      return p && `This search cannot leave a topic out yet, so ${p} was left out of the words. Some papers may still mention it.`;
    case "form":
      return p && `This box does not make tables or bullet lists yet, so ${p} was left out.`;
    case "order":
      return "An instruction to this box was left out. It only searches for papers.";
    case "author":
      return p && `This box cannot filter by author yet, so ${p} was searched as words.`;
    case "venue":
      return p && `This box cannot filter by journal or institution yet, so ${p} was searched as words.`;
    case "threshold":
      return p && `This box cannot apply a number such as a sample size yet, so ${p} was left out of the words.`;
    case "prove":
      return p && `This box lists papers on the topic. It does not look for papers that prove one side, so ${p} was left out.`;
    case "person":
      return `Your personal details (such as ${quoted("I")}, ${quoted("my")} and your age) were left out of the words searched; a condition or medicine you named is still searched.`;
  }
}

/**
 * Everything the page says about a Reading beyond the line "I searched for", as plain data: the pieces left out (one chip each) and the sentences of the notes. Built from the Reading's fields and nothing
 * else (the reading-line-true property: a word, number or year in a line is a field of the Reading, or one of the fixed words above). Nothing at all (empty lists) for a Reading that has nothing to show.
 */
export function readingLines(reading: Reading): { left: string[]; notes: string[] } {
  return { left: [...reading.left], notes: reading.notes.flatMap((n) => noteText(n) ?? []) };
}

/**
 * True when the Reading has nothing to say: no piece left out, no assumption, no suggestion, no note, no years, no count, and the topic is the message itself. The page draws no new line for it (12b.4): the
 * server does not even send one, and a page that is given one anyway draws the same nothing.
 */
export function readingIsQuiet(reading: Reading, message: string): boolean {
  const same = tidyWords(message) === reading.topic || message.replace(/\s+/g, " ").trim() === reading.topic;
  return reading.left.length === 0 && reading.notes.length === 0 && !reading.assumed?.length && !reading.suggested?.length && reading.years === undefined && reading.count === undefined && same;
}
