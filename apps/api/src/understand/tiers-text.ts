import type { Lang } from "@scholar/shared";

/**
 * The two fixed sentences of the poor-results states of R9 (docs/design/intent-and-state.md, 5.4: S-FEW and S-NONE-CLOSE; 12b.5: the owner's wording, "no exact match, these are related"). No model writes
 * either of them: the page speaks these, and code fills only the number and the person's own words. They are the notice kind `weak`. The language is the language of the message as the rules find it; the
 * Hinglish sentences are the plan's text and have NOT been read by a native speaker (O-3), and Hindi has none of its own (the plan leaves it to the native-reader pass), so a Hindi message is given the
 * Hinglish sentence and never the English one, as the safety lane's sentences are (lane-text.ts). They live on the server only, so that no sentence is in a web file.
 */

/** The most characters of the person's words that a line quotes (a search is at most 300; a line that quotes all of them would be a paragraph). */
export const MAX_NOTICE_WORDS = 120;

const LQ = String.fromCodePoint(0x201c);
const RQ = String.fromCodePoint(0x201d);
const ELLIPSIS = String.fromCodePoint(0x2026);

/** The person's words as a line quotes them: control characters and runs of white space are one space; a long text is cut at a word boundary (or at the limit, for one word) and says so. Always text. */
function quoted(words: string): string {
  const flat = String(words).replace(/[\p{Cc}\s]+/gu, " ").trim();
  if (flat.length <= MAX_NOTICE_WORDS) return flat;
  const cut = flat.slice(0, MAX_NOTICE_WORDS);
  const at = cut.lastIndexOf(" ");
  return `${(at > 0 ? cut.slice(0, at) : cut).trimEnd()}${ELLIPSIS}`;
}

const hinglish = (language: Lang): boolean => language === "hinglish" || language === "hi";

/** S-FEW: one or two papers match closely and the rest are weaker and listed after them. One paper takes the singular verb (the plan's sentence is written for {n} papers). */
export function fewNotice(n: number, language: Lang): string {
  if (hinglish(language)) return `In papers mein se sirf ${n} aapke shabdon se achhe se milte hain. Baaki kamzor matches hain aur unke baad diye gaye hain.`;
  return `Only ${n} of these papers ${n === 1 ? "matches" : "match"} your words closely. The others are weaker matches and are listed after them.`;
}

/** S-NONE-CLOSE: papers were found and not one matches the words closely; the words are the ones that were searched, quoted. */
export function noneCloseNotice(words: string, language: Lang): string {
  if (hinglish(language)) return `Koi paper ${LQ}${quoted(words)}${RQ} se achhe se nahi milta. Ye sabse paas ke records hain aur topic se alag ho sakte hain. Spelling dekh lijiye, ya kam ya alag shabd likhiye.`;
  return `No paper matches ${LQ}${quoted(words)}${RQ} closely. These are the nearest records and may be off topic. Check the spelling, or try fewer or different words.`;
}
