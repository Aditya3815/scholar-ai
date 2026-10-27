import { splitReferences } from "./references";

/**
 * Which tool does a message on Home belong to? The rules here cost nothing and always give the same answer; they settle what is plain, and everything else goes to a small
 * model (`apps/api/src/chat/router.ts`), which can only ever answer with one of four tool names. Nothing here opens a tool or starts a search by itself.
 */
export const ROUTE_MODES = ["search", "verify", "idea", "paper"] as const;
export type RouteMode = (typeof ROUTE_MODES)[number];
export const ROUTE_NAMES: Record<RouteMode, string> = { search: "Search papers", verify: "Check references", idea: "Idea Check", paper: "Ask a paper" };

export type Lang = "en" | "hi" | "hinglish" | "other";

/** How the choice was made: the reader chose, the rules, the model, or neither could (so the cheap, safe default was taken). */
export type RouteHow = "chosen" | "rules" | "model" | "fallback";
export type Route = {
  mode: RouteMode;
  how: RouteHow;
  /** 0 to 1: 1 for a choice or a certain rule, the model's own number for the model, low for a fallback. */
  confidence: number;
  language: Lang;
  /** For a search: what the indexes are asked, in English, when it is not the words as written (a translation, or a long text shortened). */
  searchQuery?: string;
};

/** The longest message Auto reads. A longer text is cut for the choosing; nothing is sent anywhere else. */
export const MAX_AUTO_CHARS = 20_000;
/** Below this confidence the choice is not trusted: the search is run (it is harmless) and the line says "Change". */
export const MIN_ROUTE_CONFIDENCE = 0.6;

/** A message for Auto: control characters out, lines kept (a reference list is read line by line), 2 to 20,000 characters with a letter or number in it. */
export function cleanAutoMessage(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return t.length >= 2 && t.length <= MAX_AUTO_CHARS && /[\p{L}\p{N}]/u.test(t) ? t : null;
}

/* ---------------------------------------------------------------- the language of a message */

/** Words of Roman-letter Hindi that are not English words. Ambiguous ones (do, me, is, to, par, ho) are left out on purpose. */
const HINGLISH = new Set(
  ("ke ka ki ko ne se mein hai hain hota hoti hote tha thi kya kaise kyun kyon kaun kab kahan kitna kitne kitni nahi nahin aur ya lekin magar mere mera meri hum humne hamare maine tum aap " +
    "karo kar karna karke kare kiya kiye chahiye dikhao dikha batao bata bataiye dhundo dhoondo khojo samjhao likho likhna dekho padho wala wali wale jo yeh ye woh wo liye baare bhi sirf bahut " +
    "thoda kuch koi sab abhi phir fir isme usme kaisa zyada jyada accha achha acche asar upar neeche saath bina " +
    "jaanch jaanchna mujhe tumhe unhe inhe ek sunao suno chahta chahti raha rahi rahe hoga hogi kaha kaafi kaam nuksan fayda tarah jaise jab agar pehle baad wahi yahi sabhi saare saari aise aisa kisi kisne kiska apne apna apni uska uski unka naya nayi tune usne yaar bhai").split(" "),
);
/** Hinglish words that are almost never English: one of them is enough, with a short message. */
const HINGLISH_STRONG = new Set("karo kya kaise kyun chahiye dikhao batao dhundo khojo samjhao hai hain mere mera meri maine humne wala wali wale ke ka ki mujhe".split(" "));
/** Even fewer (they are not English words and not the name of anything): one of them settles a message of up to twelve words ("India me TB ki drug resistance par latest studies"). */
const HINGLISH_ONE = new Set("karo kya kaise kyun chahiye dikhao batao dhundo khojo samjhao hai hain mere mera meri maine humne ki mujhe nahi nahin jaanch".split(" "));

export function detectLanguage(text: string): Lang {
  // Devanagari vowel signs are marks, not letters; they count as Devanagari (and as part of the text) so a Hindi word is not under-counted
  const letters = text.match(/[\p{L}ऀ-ॿ]/gu) ?? [];
  if (letters.length === 0) return "en";
  const deva = letters.filter((c) => /[ऀ-ॿ]/.test(c)).length;
  const latin = letters.filter((c) => /[A-Za-zÀ-ɏ]/.test(c)).length;
  // Devanagari with English words mixed in (more than a third Latin letters) is how Hinglish is often typed, too
  if (deva / letters.length > 0.3) return latin / letters.length >= 0.3 ? "hinglish" : "hi";
  if ((letters.length - latin - deva) / letters.length > 0.3) return "other";
  const tokens = text.toLowerCase().match(/[a-z]+/g) ?? [];
  const hits = tokens.filter((t) => HINGLISH.has(t));
  const strong = hits.filter((t) => HINGLISH_STRONG.has(t)).length;
  // two short words alone (Ne and Se are elements) are not enough; with one longer Hindi word, or three words, they are
  if (hits.length >= 2 && hits.length / Math.max(tokens.length, 1) >= 0.2 && (hits.length >= 3 || hits.some((t) => t.length >= 3))) return "hinglish";
  if (strong >= 1 && tokens.length <= 6) return "hinglish";
  if (tokens.length <= 12 && hits.some((t) => HINGLISH_ONE.has(t))) return "hinglish";
  return "en";
}

/* ---------------------------------------------------------------- the rules */

const IDEA_CUE =
  /\b(?:my|our)\s+(?:idea|hypothesis|proposal|approach|research plan|manuscript)\b|\b(?:is|are)\s+(?:(?:this|my|our|the)\s+(?:idea|approach|work|research|hypothesis)|this|it)\s+(?:novel|new|original)\b|\bnovelty\b|\bprior art\b|\bi\s+(?:want|plan|propose|intend|am planning|am thinking)\s+to\b|\bwe\s+(?:propose|plan|intend)\b|\bmera\s+idea\b|\bnaya\s+(?:hai|idea)\b|\bnovel\s+hai\b|\bmera\s+(?:hypothesis|proposal)\b/i;
const REFS_CUE = /\b(?:check|verify|validate|jaanch|jaanchna)\s+(?:my|these|the|this|mere|meri|ye|yeh)?\s*(?:references?|citations?|bibliography|refs)\b|\b(?:references?|citations?)\s+(?:check|verify|karo|jaanch)\b|\breference list\b|\bbibliography\b/i;
const PAPER_CUE = /\b(?:my|the)\s+(?:uploaded|workspace)\b|\bmy\s+(?:pdf|pdfs)\b|\b(?:upload\s*kiye|upload\s*kiya|upload\s*ki\s*hui|mere\s+(?:pdf|upload))\b|\bin\s+my\s+workspace\b/i;
const DOI = /^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)?10\.\d{4,9}\/\S+$/i;
const ARXIV = /^(?:arxiv:\s*)?\d{4}\.\d{4,5}(?:v\d+)?$|^https?:\/\/arxiv\.org\/(?:abs|pdf)\/\S+$/i;

/** Does the text look like a list of references (three or more entries, each with a year and the look of authors, a title mark or a DOI)? */
export function looksLikeReferenceList(text: string): boolean {
  const entries = splitReferences(text);
  if (entries.length < 3) return false;
  const good = entries.filter(
    (e) => e.length >= 30 && /\b(?:1[89]|20)\d{2}\b/.test(e) && (/\p{Lu}[\p{L}'’-]+,?\s+\p{Lu}\./u.test(e) || /\bet al\b/i.test(e) || /doi\.org|\b10\.\d{4,9}\//i.test(e) || /[“"][^”"]{8,}[”"]/.test(e)),
  );
  return good.length >= 3 && good.length >= entries.length * 0.6;
}

/** Words that suggest another tool without being sure of it (they may be the topic: "novelty detection", "reference checking tools"); the model decides. */
const FIRST_PERSON = /\b(?:i|i'm|i've|i'd|my|mine|we|our|ours)\b/i;
const TOOL_WORD = /\b(?:references?|refrences?|citations?|citatons?|cite[sd]?|bibliograph\w*|refs|ideas?|novel\w*|originality|hypothes[ei]s|proposal|upload\w*|workspace|pdfs?|highlights?|thesis|manuscript|verify|validate|check(?:ing)?)\b/i;

export const hasIdeaCue = (t: string) => IDEA_CUE.test(t);
export const hasRefsCue = (t: string) => REFS_CUE.test(t);
export const hasPaperCue = (t: string) => PAPER_CUE.test(t);

/**
 * What the rules can settle, or null when a model must look at it. Certain: a pasted list of references; a bare DOI or arXiv number (searched as written); a short
 * English message with nothing that points to another tool (a search). Anything in another language, any word or cue of another tool, any first person, any list of
 * lines, and any long text is left to the model.
 */
export function ruleRoute(text: string): Route | null {
  const t = text.trim();
  const language = detectLanguage(t);
  if (looksLikeReferenceList(t)) return { mode: "verify", how: "rules", confidence: 1, language };
  const oneLine = !t.includes("\n");
  if (oneLine && (DOI.test(t) || ARXIV.test(t))) return { mode: "search", how: "rules", confidence: 1, language };
  const cue = hasIdeaCue(t) || hasRefsCue(t) || hasPaperCue(t);
  // a plain topic or question: one line, English, no word that belongs to another tool (a misspelt one too: any "I" or "my" is a reason to look closer) and no first person
  if (language === "en" && oneLine && !cue && !FIRST_PERSON.test(t) && !TOOL_WORD.test(t) && t.length <= 300) return { mode: "search", how: "rules", confidence: 0.9, language };
  return null;
}

/**
 * The same rules for a person who is not signed in (there is no model for them): the cues decide, with a lower confidence, and a message in another language is searched
 * as written (no translation).
 */
export function offlineRoute(text: string): Route {
  const t = text.trim();
  const language = detectLanguage(t);
  const settled = ruleRoute(t);
  if (settled) return settled;
  if (hasRefsCue(t)) return { mode: "verify", how: "rules", confidence: 0.75, language };
  if (hasPaperCue(t)) return { mode: "paper", how: "rules", confidence: 0.7, language };
  if (hasIdeaCue(t) || t.length > 300) return { mode: "idea", how: "rules", confidence: 0.7, language };
  return { mode: "search", how: "fallback", confidence: 0.5, language };
}

/* ---------------------------------------------------------------- small talk */

/** What the box answers to a greeting, thanks or a question about itself: no search, no model, the same for everyone (also for a visitor who is not signed in). */
export const SMALL_TALK_REPLY = "This box finds research papers and answers from them. Ask about a topic, paste your references, or describe an idea.";

const SMALL_TALK = new RegExp(
  "^(?:" +
    [
      "(?:hi+|hello+|hey+|hiya|yo|namaste|namaskar|salaam|sat sri akal|good (?:morning|afternoon|evening|night)|gm|gn)(?: (?:there|everyone|all|sir|madam|scholar|bhai|dost))?",
      "(?:thanks?|thank you|thx|ty|shukriya|dhanyavaad?|dhanyawad|bahut shukriya)(?: (?:a lot|so much|very much|a ton|again|bhai|ji|you))*",
      "(?:ok(?:ay)?|cool|nice|great|good|fine|alright|got it|understood|sure|yes|no|haan|nahi|theek hai|accha|achha)",
      "(?:bye|goodbye|good bye|see you|see ya|take care|tata|alvida)(?: (?:now|later|soon))?",
      "how are you(?: doing| today)?|how r u|kaise ho|kya haal hai|what'?s up|sup",
      "who are you|what are you|what is this|what can you do|what do you do|how do you work|how does this work|help(?: me)?|test(?:ing)?|kaun ho tum|aap kaun ho",
    ].join("|") +
    ")$",
  "i",
);
const SMALL_TALK_DEVANAGARI = /^(?:नमस्ते|नमस्कार|धन्यवाद|शुक्रिया|शुक्रिया जी|धन्यवाद जी|ठीक है|अलविदा|आप कौन हैं|तुम कौन हो|आप क्या कर सकते हैं)$/;

/** A greeting, thanks, a goodbye, "ok", or a question about the box itself. Only the whole message counts: "hello world dataset" is a search. */
export function isSmallTalk(text: string): boolean {
  const t = text.trim().replace(/[\s]+/g, " ").replace(/[.!?,;:~…।\u{1F300}-\u{1FAFF}\u2600-\u27BF]+$/gu, "").replace(/^[.!?,;:~…।\s\u{1F300}-\u{1FAFF}☀-➿]+/u, "").trim();
  if (t.length === 0 || t.length > 40) return false;
  return SMALL_TALK.test(t) || SMALL_TALK_DEVANAGARI.test(t);
}
