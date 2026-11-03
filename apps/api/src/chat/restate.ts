import { MAX_RESTATED_QUESTION_CHARS, subjectWords } from "@scholar/shared";

/**
 * The deterministic part of letting a model restate a follow-up (docs/design/chat-actions-context.md, section 5), in the spirit of chat/rewrite.ts: words written by a model act only if they pass
 * a check that cannot know whether they are right, but makes sure they ADD NOTHING. "only after 2020" may become "What is the effect of yoga on blood pressure, in papers after 2020?"; it may
 * not become a question about a year, a place, a person or a "not" that the message and the earlier turns do not have, and it may not carry a link, an address or a DOI out to a search
 * source. A restatement that fails is not repaired: the words are searched as they were written (router.ts), and the context info says so.
 *
 * `pool` is everything the model was shown besides the message: the earlier questions, the search words and the titles of the cited papers (and the questions of earlier chats).
 */

export type RestatementReason = "empty" | "length" | "link" | "instruction" | "script" | "numbers" | "names" | "negation" | "novel";
export type Restatement = { ok: true } | { ok: false; reason: RestatementReason; detail?: string };

/**
 * `foreign`: the message is in another language than English (Hindi in Devanagari, Hinglish). The English words of its translation share no word with it, so they cannot be looked for in the message and
 * the earlier turns word by word. What can be counted is the words of the message about a subject that the restatement does not have as they are (`untranslated`: "केरल", "मधुमेह", "इलाज"): a translation
 * may bring one new name for each of them (and India for "bharat"), and at most two new words about a subject for each; with none of them ("और बच्चों में?", "aur bachon me?") it brings nothing new. Numbers, a
 * "not", a link and an order are checked as for any text.
 */
export type RestatementOptions = { foreign?: boolean };

/** "question" is the standalone question (in the person's language, at most 200 characters); "search" is the English search words (at most 300, as every search is). */
export type RestatementKind = "question" | "search";

const tokens = (s: string): string[] => s.normalize("NFKC").toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];

/** Hindi digits are numbers too ("२०२०"), and 12,000 is 12000. */
const DEVANAGARI_DIGITS = "०१२३४५६७८९";
export const asciiDigits = (s: string): string => s.replace(/[०-९]/g, (d) => String(DEVANAGARI_DIGITS.indexOf(d)));
export const numbersIn = (s: string): string[] => asciiDigits(s.normalize("NFKC")).replace(/(\d),(?=\d{3}\b)/g, "$1").match(/\d+(?:\.\d+)?/g) ?? [];

const NEGATIONS = new Set(["no", "not", "nor", "never", "none", "neither", "without", "cannot", "nothing", "nahi", "nahin", "nhi", "bina", "mat", "नहीं", "नही", "बिना", "मत", "न"]);
/** "paper no. 2" is a number, not a "no". */
const hasNegation = (s: string): boolean => {
  const t = s.replace(/\bno\.?\s*(?=\d)/gi, "number ");
  return tokens(t).some((w) => NEGATIONS.has(w)) || /n['’]t\b/i.test(t);
};

/**
 * A "not" that is only a bound on years ("nothing older than 2021", "not before 2018", "no papers before 2015") or a tag at the end of a question ("ya nahi", "or not", "या नहीं"), and "no." as an
 * abbreviation: a restatement that says the year ("from 2021 or later") or drops the tag has lost no negation.
 */
const BOUND_OR_TAG = /\b(?:nothing|no|none|not)\s+(?:(?:papers?|studies|results?|ones|anything|work|research)\s+)?(?:older|earlier|before|prior to|newer|later|after)\b|\b(?:ya|ki|or)\s+(?:nahi|nahin|nhi|not|no)\s*[?.!]*\s*$|\bno\.(?!\s*\d)|या\s+नहीं\s*[?.!]*\s*$/gi;
const hasKeptNegation = (s: string): boolean => hasNegation(s.replace(BOUND_OR_TAG, " "));

const scriptShare = (s: string): { devanagari: number; letters: number } => ({ devanagari: (s.match(/[ऀ-ॿ]/g) ?? []).length, letters: (s.match(/\p{L}/gu) ?? []).length });
/** The script a text is written in, when it is one of them throughout; null for a mixture or a text with no letters. */
const pureScript = (s: string): "devanagari" | "latin" | null => {
  const { devanagari, letters } = scriptShare(s);
  if (letters === 0) return null;
  const share = devanagari / letters;
  return share >= 0.9 ? "devanagari" : share <= 0.1 ? "latin" : null;
};

const LINKISH = /https?:\/\/|www\.|[^\s@]+@[^\s@]+\.[^\s@]+|\b10\.\d{4,9}\//i;
/** Words of an order to the model, not of a question: the restatement is only ever a question or a topic. A person who wrote one themselves is not refused for repeating it. */
const INSTRUCTION =
  /\b(?:ignore|disregard|forget|override)\b[^.?!]{0,40}\b(?:instructions?|rules?|above|previous|prompt|everything)\b|\b(?:system prompt|you are now|reply with|respond with|answer with|set (?:the )?(?:mode|confidence)|mode (?:idea|paper|verify|search))\b/i;

/** The words of a text that are names: a capital letter that does not start a sentence, or an acronym, in Latin letters. Hyphenated and possessive names are taken in their parts. */
function namesIn(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(/[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ'’-]*/g)) {
    const word = m[0];
    const letters = word.replace(/[^A-Za-zÀ-ɏ]/g, "");
    const acronym = letters.length >= 2 && letters === letters.toUpperCase();
    const capital = /^\p{Lu}/u.test(word) && !(m.index === 0 || /[.!?]\s*$/.test(s.slice(0, m.index)));
    if (!acronym && !capital) continue;
    for (const part of word.split(/['’-]/)) if (part.length >= 2) out.push(part.toLowerCase());
  }
  return out;
}

/** India, said in the words of Hindi: the one name that a message so often has in a script the check cannot read. */
const INDIA_WORD = /(?<![\p{L}\p{M}])(?:bharat|bharatiya|hindustan|भारत|भारतीय|हिंदुस्तान|हिन्दुस्तान)(?![\p{L}\p{M}])/iu;
/** A restatement may bring this many words about a subject of its own (a model is wordy: "please summarise the findings", "only include studies"); more is a subject nobody asked about. */
const MAX_NOVEL_WORDS = 2;

/** How many words of the message about a subject the candidate does not have as they are: what a translation has had to put into other words. */
function untranslatedWords(candidate: string, message: string): number {
  const inCandidate = new Set(tokens(candidate));
  return subjectWords(message).filter((w) => !tokens(w).some((t) => inCandidate.has(t))).length;
}

export function checkRestatement(candidate: string, message: string, pool: readonly string[], kind: RestatementKind, opts: RestatementOptions = {}): Restatement {
  const c = candidate.replace(/\s+/g, " ").trim();
  if (!c || !/[\p{L}\p{N}]/u.test(c)) return { ok: false, reason: "empty" };
  if (c.length > (kind === "question" ? MAX_RESTATED_QUESTION_CHARS : 300)) return { ok: false, reason: "length" };
  if (LINKISH.test(c) && !LINKISH.test(message)) return { ok: false, reason: "link" };
  if (INSTRUCTION.test(c) && !INSTRUCTION.test(message)) return { ok: false, reason: "instruction" };
  if (kind === "question") {
    const want = pureScript(message);
    const got = pureScript(c);
    if (want && got && want !== got) return { ok: false, reason: "script", detail: `${want} -> ${got}` };
  }
  const allowedText = [message, ...pool].join(" ");
  const haveNumbers = new Set(numbersIn(allowedText));
  for (const n of numbersIn(c)) if (!haveNumbers.has(n)) return { ok: false, reason: "numbers", detail: n };
  const known = new Set(tokens(allowedText));
  const prefixes = new Set([...known].filter((w) => w.length >= 4).map((w) => w.slice(0, 4)));
  const isKnown = (w: string) => known.has(w) || (w.length >= 4 && prefixes.has(w.slice(0, 4)));
  const fresh = namesIn(c).filter((name) => !isKnown(name));
  // for a translation, a new name is let through for each word of the message about a subject that the restatement does not have as it is (and India for "bharat"); otherwise none
  const untranslated = opts.foreign ? untranslatedWords(c, message) : 0;
  const allowed = opts.foreign ? untranslated + (INDIA_WORD.test(message) ? 1 : 0) : 0;
  if (fresh.length > allowed) return { ok: false, reason: "names", detail: fresh[allowed] };
  // a "not" is not added; and for the question, the message's own "not" is not lost
  if (hasNegation(c) && !hasNegation(allowedText)) return { ok: false, reason: "negation", detail: "added" };
  if (kind === "question" && hasKeptNegation(message) && !hasNegation(c)) return { ok: false, reason: "negation", detail: "lost" };
  // no subject of its own: a restatement is the message, the earlier topic and a word or two (not "smoking and lung cancer" for "only after 2020"); a translation, two for each word of the message it translated
  // (a question in another language than English cannot be compared with the English words of the earlier turns, so it is not asked for: only its numbers, names, "not", links and orders are checked)
  if (!(opts.foreign && kind === "question")) {
    const novel = subjectWords(c).filter((w) => !tokens(w).some(isKnown));
    // (one more than two for each word it translated, because a word of a kind comes out as a word about a subject: "gaon" as "settlements")
    const roomForNew = opts.foreign ? 1 + 2 * untranslated : MAX_NOVEL_WORDS;
    if (novel.length > roomForNew) return { ok: false, reason: "novel", detail: novel.slice(0, 3).join(" ") };
  }
  return { ok: true };
}

/** Words that may come along into a search on any subject: they say what kind of thing is looked for, not what it is about. */
const GENERIC = new Set(
  ("about which their there these those where while would could should between using other paper papers study studies research review reviews effect effects impact evidence results result trial trials analysis recent latest " +
    "systematic outcomes outcome literature article articles report reports survey findings finding clinical based related").split(" "),
);
const MIN_TOPIC_LETTERS = 5;

/**
 * The first word of a new topic's words that belongs to the OLD topic: a word of five letters or more that the earlier turns have and the message does not (the same first five letters
 * count as the same word, so "effects" and "effect" are one). A model that always merges the earlier turns into the search turns a new question into a mixed one ("now CRISPR
 * off-target effects" after diabetes); this is the check that the words of a NEW topic are the message's own. Generic words ("studies", "evidence") are not a topic. Null when there is none.
 */
export function bleeds(candidate: string, message: string, pool: readonly string[], opts: RestatementOptions = {}): string | null {
  const found = bleedingWords(candidate, message, pool);
  if (!opts.foreign) return found[0] ?? null;
  // a translation shares words with the old topic honestly ("India", "treatment", "children"): it may carry one for every two words of the message that it put into other words (and India for "bharat");
  // a message that is in English words itself ("ab CRISPR ke off-target effects par batao") has put nothing into other words, and carries none
  const rest = found.filter((w) => !(INDIA_WORD.test(message) && w.toLowerCase() === "india"));
  const room = Math.floor(untranslatedWords(candidate, message) / 2);
  return rest.length > room ? (rest[room] ?? null) : null;
}

/** The words of the candidate that belong to the OLD topic, in order (the first five letters of a longer word count as the word; the short words of a subject are whole words). */
function bleedingWords(candidate: string, message: string, pool: readonly string[]): string[] {
  const out: string[] = [];
  const stem = (w: string) => [...w].slice(0, MIN_TOPIC_LETTERS).join("");
  const fromMessage = new Set(tokens(message).map(stem));
  const fromPool = new Set(tokens(pool.join(" ")).filter((w) => [...w].length >= MIN_TOPIC_LETTERS).map(stem));
  for (const w of tokens(candidate)) {
    if ([...w].length < MIN_TOPIC_LETTERS || GENERIC.has(w) || /^\d/.test(w)) continue;
    const s = stem(w);
    if (fromPool.has(s) && !fromMessage.has(s)) out.push(w);
  }
  // the short words of a subject ("yoga", "HIV", "gut", "TB"): whole words, only those about a subject (not "and", "the", "side" or a number), that the earlier turns have and the message does not
  const shortFromPool = new Set(subjectWords(pool.join(" ")).map((w) => w.toLowerCase()).filter((w) => [...w].length < MIN_TOPIC_LETTERS));
  const inMessage = new Set(tokens(message));
  for (const w of subjectWords(candidate)) {
    const low = w.toLowerCase();
    if ([...low].length < MIN_TOPIC_LETTERS && !GENERIC.has(low) && shortFromPool.has(low) && !inMessage.has(low)) out.push(w);
  }
  return out;
}
