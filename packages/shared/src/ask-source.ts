/**
 * Which source should a question in a paper's Ask box be answered from: the paper itself, or what the reader marked in it (their highlights and notes)?
 * Decided by rules that cost nothing and always give the same answer; the person sees the choice ("From your highlights") and can change it with one click, so a
 * wrong guess costs one click and never a wrong answer passed off as right.
 *
 * A question is about the reader's own marks when it names marking (highlight, underline, note, annotation) AND speaks of the reader (my, I, mine; Hinglish
 * mere, maine; Hindi मेरे, मैंने), or names a colour of highlight ("the yellow highlights"). "The key highlights of this paper" is about the paper.
 */
export type AskSource = "paper" | "highlights";

const MARKING = String.raw`(?:highlight\w*|underlin\w*|annotat\w*|marked|marks?|notes?|sticky|हाइलाइट\S*|अंडरलाइन\S*|नोट्?स?|निशान\S*|मार्क\S*)`;
const READER = String.raw`(?:my|mine|i|i've|ive|me|mere|mera|meri|meine|maine|mainey|humne|hamare|hamari|मेरे|मेरा|मेरी|मैंने|मैने|हमने)`;
// word edges that also work next to Devanagari (a plain \b does not treat Devanagari letters as word characters)
const L = String.raw`(?<![\p{L}\p{M}\p{N}])`;
const R = String.raw`(?![\p{L}\p{M}\p{N}])`;

const reader = new RegExp(`${L}${READER}${R}`, "iu");
const marking = new RegExp(`${L}${MARKING}${R}`, "iu");
const colourMark = new RegExp(`${L}(?:yellow|green|blue|pink|peela|peele|hara|hare|neela|neele|gulabi)\\s+(?:highlight\\w*|marking\\w*|marks?)${R}`, "iu");
// "I want to highlight the importance of ..." is about writing, not about what was marked
const writing = new RegExp(`${L}(?:want|need|like|wish|trying|try)\\s+to\\s+(?:highlight|mark|note)${R}|${L}how\\s+(?:do|can|should)\\s+i\\s+(?:highlight|mark|annotate)${R}`, "iu");

export function classifyAskSource(question: string): AskSource {
  const q = question.normalize("NFC");
  if (writing.test(q)) return "paper";
  if (colourMark.test(q)) return "highlights";
  if (reader.test(q) && marking.test(q)) return "highlights";
  return "paper";
}
