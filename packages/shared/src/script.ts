/**
 * Script and marks in what the chat shows (docs/design/chatview-and-trending.md, C5 and C6). Pure, in no way specific to the page: the page puts the results on its elements.
 *
 * LANGUAGE. A page that says `lang="en"` over a Hindi answer has it read to a blind person in an English voice (WCAG 3.1.2, Language of Parts), and the browser picks a Latin-first font for it. A message is marked
 * `hi` when its Devanagari letters are MORE THAN HALF of its letters; text in Latin letters is never marked, however Hindi its words (Hinglish: "climate change ka farmers par asar kya hai"): no voice reads Latin-script
 * Hindi as Hindi, so it stays the page's own language. Devanagari is also written for Marathi, Nepali and others: they are marked `hi` too, which is better for a voice than English and wrong only in the name.
 * Only the first 600 characters are looked at (an abstract is a thousand), and only letters and the marks that go with them are counted (digits, signs and spaces are not). The marks matter: a Devanagari vowel
 * sign and the virama are marks (Mc, Mn) and not letters, so counting letters alone made a Devanagari akshara cost one and a half code points and count once, while every Latin letter counted once: a sentence
 * with most of its words in Hindi and a few English ones ("diabetes में exercise का क्या असर होता है") came out as English (reviewer, 4 Nov 2026).
 */
const LETTER = /[\p{L}\p{M}]/u;
const DEVANAGARI = /\p{Script=Devanagari}/u;
const LOOKED_AT = 600;

/** The share (0 to 1) of the letters of the start of `text` that are Devanagari letters. 0 for no letters. */
export function devanagariShare(text: string): number {
  if (typeof text !== "string" || text === "") return 0;
  let letters = 0;
  let devanagari = 0;
  for (const ch of text.length > LOOKED_AT ? text.slice(0, LOOKED_AT) : text) {
    if (!LETTER.test(ch)) continue;
    letters++;
    if (DEVANAGARI.test(ch)) devanagari++;
  }
  return letters === 0 ? 0 : devanagari / letters;
}

/** `"hi"` when Devanagari letters are most of the letters of `text`, otherwise undefined (leave the page's language alone). */
export function textLang(text: string): "hi" | undefined {
  return devanagariShare(text) > 0.5 ? "hi" : undefined;
}

const HINDI = Object.freeze({ lang: "hi", dir: "auto" } as const);
const AUTO = Object.freeze({ dir: "auto" } as const);
const NONE = Object.freeze({}) as { lang?: "hi"; dir?: "auto" };

/**
 * The attributes an element that holds `text` is given: `lang="hi"` and `dir="auto"` for Hindi, none for anything else. `typed`: the text is what a person wrote (a question): its direction is always left to the
 * browser (`dir="auto"`, as W3C advises for text written by people), since it may be in a script that runs from the right, and its language is marked only for Hindi. The objects are shared and frozen: spread them.
 */
export function textAttrs(text: string, typed = false): { lang?: "hi"; dir?: "auto" } {
  return textLang(text) ? HINDI : typed ? AUTO : NONE;
}

/**
 * One piece of an answer's text: either plain `text`, or a mark `[n]` (`n`) with the word that stands before it (`before`, with no spaces in it), the white space between them (`gap`), and the stops that follow
 * it (`after`: . , ; : ! ? ) and the Devanagari danda). The page draws `before`, `gap`, the mark and `after` as one piece that does not come apart across a line: before this a mark was left alone at the start of a
 * line with its full stop behind it ("main result / (1) .").
 * Nothing is dropped or added: the parts read back as the text. A mark is `[n]` of one or two digits and nothing else.
 */
export type CitePart = { text: string; n?: undefined } | { n: number; before: string; gap: string; after: string; text?: undefined };

const MARK = /\[(\d{1,2})\]/g;
const STOPS = /^[.,;:!?)।॥”’"']+/;
const WORD_BEFORE = /(\S+)(\s*)$/;

export function citeParts(text: string): CitePart[] {
  if (typeof text !== "string" || text === "") return [];
  const marks = [...text.matchAll(MARK)];
  if (marks.length === 0) return [{ text }];
  const out: CitePart[] = [];
  let at = 0; // where the text that has not been given to a part starts
  marks.forEach((m, i) => {
    const start = m.index ?? 0;
    const between = text.slice(at, start);
    const w = WORD_BEFORE.exec(between);
    const plain = w ? between.slice(0, w.index) : between;
    if (plain) out.push({ text: plain });
    const end = start + m[0].length;
    // the stops that follow belong to this mark, as far as the next mark
    const stops = STOPS.exec(text.slice(end, marks[i + 1]?.index ?? text.length))?.[0] ?? "";
    out.push({ n: Number(m[1]), before: w?.[1] ?? "", gap: w?.[2] ?? "", after: stops });
    at = end + stops.length;
  });
  const tail = text.slice(at);
  if (tail) out.push({ text: tail });
  return out;
}
