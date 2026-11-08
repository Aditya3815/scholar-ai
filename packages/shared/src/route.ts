import { MAX_CHAT_CHARS } from "./chat";
import { splitReferences } from "./references";

/**
 * Which tool does a message on Home belong to? The rules here cost nothing and always give the same answer; they settle what is plain, and everything else goes to a small
 * model (`apps/api/src/chat/router.ts`), which can only ever answer with one of four tool names. Nothing here opens a tool or starts a search by itself.
 *
 * Several functions take an optional `RouteContext`: "there are earlier turns in this conversation" (docs/design/chat-actions-context.md, section 5). Without it (or with `turns: 0`) every
 * one of them gives exactly the answer it always gave, so nothing measured on the first message of a conversation moves; with it they only ever hold back what they used to settle.
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

/** The conversation a message is part of: how many earlier turns (a question and its reply) the browser sent with it. Absent or 0 is the first message. */
export type RouteContext = { turns: number };
const hasContext = (context?: RouteContext): boolean => (context?.turns ?? 0) > 0;

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
  const good = entries.filter(looksLikeReference);
  return good.length >= 3 && good.length >= entries.length * 0.6;
}

/** One entry that has the look of a reference: 30 characters or more, a year, and the look of authors, "et al", a DOI or a title in quotes. */
export function looksLikeReference(e: string): boolean {
  return e.length >= 30 && /\b(?:1[89]|20)\d{2}\b/.test(e) && (/\p{Lu}[\p{L}'’-]+,?\s+\p{Lu}\./u.test(e) || /\bet al\b/i.test(e) || /doi\.org|\b10\.\d{4,9}\//i.test(e) || /[“"][^”"]{8,}[”"]/.test(e));
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
 *
 * With an earlier conversation (`context`) a message is settled as a plain search only if it also stands alone (`needsContext`: five words or more and no cue that it leans on an earlier
 * turn): "only after 2020", "explain that simpler" and "why?" used to be searched as written and are now left to the model, which can read the earlier turns. A pasted list of references
 * and a bare DOI do not depend on them and are settled as before.
 */
export function ruleRoute(text: string, context?: RouteContext): Route | null {
  const t = text.trim();
  const language = detectLanguage(t);
  if (looksLikeReferenceList(t)) return { mode: "verify", how: "rules", confidence: 1, language };
  const oneLine = !t.includes("\n");
  if (oneLine && (DOI.test(t) || ARXIV.test(t))) return { mode: "search", how: "rules", confidence: 1, language };
  const cue = hasIdeaCue(t) || hasRefsCue(t) || hasPaperCue(t);
  // a plain topic or question: one line, English, no word that belongs to another tool (a misspelt one too: any "I" or "my" is a reason to look closer) and no first person
  if (language === "en" && oneLine && !cue && !FIRST_PERSON.test(t) && !TOOL_WORD.test(t) && t.length <= 300 && !(hasContext(context) && needsContext(t))) return { mode: "search", how: "rules", confidence: 0.9, language };
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

/**
 * A greeting, thanks, a goodbye, "ok", or a question about the box itself. Only the whole message counts: "hello world dataset" is a search.
 *
 * In a conversation that already has turns (`context`) only the social words stay small talk. "what is that?", "really?", "are you sure", "do that again", "so what" and "how so" are made of the
 * same little words, but after an answer they are questions about it, so they go on as follow-ups; a message made only of filler is small talk there only if it has a social word in it
 * (a hello, a thanks, a goodbye, a "cool") or asks about the box. A thanks taken for a follow-up would cost a model call and be searched as words, a follow-up taken for a thanks would
 * be answered with a greeting, so when it is not clear the message goes on.
 */
export function isSmallTalk(text: string, context?: RouteContext): boolean {
  const t = text.trim().replace(/[\s]+/g, " ").replace(/[.!?,;:~…।\u{1F300}-\u{1FAFF}\u2600-\u27BF]+$/gu, "").replace(/^[.!?,;:~…।\s\u{1F300}-\u{1FAFF}☀-➿]+/u, "").trim();
  if (t.length === 0) return false;
  if (!hasContext(context)) {
    if (t.length <= 40 && (SMALL_TALK.test(t) || SMALL_TALK_DEVANAGARI.test(t))) return true;
    return onlyFiller(text);
  }
  if (t.length <= 40 && ((SMALL_TALK.test(t) && !/^what is this$/i.test(t)) || SMALL_TALK_DEVANAGARI.test(t))) return true;
  // after an answer a person also says how it went ("thanks, that helps", "great, that is clear", "shukriya, samajh aa gaya"): words that are no request, and only with a social word beside them
  return onlyFiller(text, ACK_WORDS) && (SOCIAL_WORD.test(text) || ABOUT_THE_BOX.test(text));
}

/**
 * The words of saying how an answer went, which are filler only AFTER an answer ("helps", "clear", "got it", "samajh aa gaya"): with no earlier turn they are not (`isSmallTalk` does not pass them), so that
 * what a first message is taken for does not move. A message made of filler and these is small talk only if it also has a social word ("thanks, now explain that simpler" has a word that is not filler).
 */
const ACK_WORDS = /* @__PURE__ */ new Set(
  (
    "helps helped helpful useful clear clearer interesting informative makes make sense got get it its noted see understood understand understood appreciate appreciated " +
    "samajh samjha samjhi aa gaya gayi bilkul sahi theek " +
    "समझ आ गया गई गयी बिल्कुल सही"
  ).split(" "),
);

/**
 * Greetings are not a list of phrases ("hey how are you" is two of them joined): a message is small talk when **every** word in it is a greeting, a politeness, a chit-chat word or one of
 * the little words they are made of (English, Hinglish, Devanagari). Safe by construction: a word that can be a topic ("BERT", "transformers", "world") is not on the list, so a single real
 * word makes the message a search; an all-capitals word in a mixed-case message is an acronym ("WHO guidelines") and counts as a real word; digits make it a search. Anything long is a search.
 */
const FILLER = new Set(
  (
    // English
    "hi hii hello hey heya hiya hullo yo there everyone all sir madam folks friends good morning afternoon evening night gm gn thanks thank thx ty please pls plz welcome " +
    "ok okay k cool nice great fine alright sure yes yeah yep no nope nah awesome perfect amazing wonderful excellent helpful bye goodbye later soon " +
    "how what whats who are is am was do does did you your yours u r me i im we can could will would doing going today now so well then again really very much lot a name made that this " +
    "help test testing lol haha hehe hmm hm umm um uh oh ah wow oops sorry bot " +
    // Hinglish (Hindi in Roman letters)
    "namaste namaskar salaam kaise kaisi kaisa ho hain hai hu hoon hun kya haal aap aapka tum tu tumhara tera kaun mera naam bhai yaar dost ji shukriya dhanyavaad dhanyawad bahut haan han nahi nahin " +
    "accha achha theek thik chalo alvida tata sunao bolo mujhe madad karo main sakte sakti " +
    // Devanagari
    "नमस्ते नमस्कार धन्यवाद शुक्रिया जी ठीक अच्छा हाँ हां नहीं भाई दोस्त कैसे कैसी हो हैं हूँ हूं है क्या कौन आप तुम मैं मेरा नाम अलविदा सकते कर हाल हेलो"
  ).split(" "),
);
/** "hellooo", "heyyy", "okkk": the stretched forms of the shortest chat words. */
const STRETCHED = /^(?:h+i+|h+e+l+o+|h+e+y+|y+o+|o+k+(?:a+y+)?|t+h+a+n+k+s+|b+y+e+|l+o+l+|h+m+|w+o+w+|s+o+r+y+|p+l+[sz]+)$/;
/** Chat words that are still chat when written in capitals. */
const SHOUT_OK = new Set("hi hey hello ok okay lol yo bye thanks thx ty omg gm gn hmm wow pls plz".split(" "));

function onlyFiller(text: string, extra?: ReadonlySet<string>): boolean {
  const t = text.trim();
  if (t.length === 0 || t.length > 60 || /\p{N}/u.test(t)) return false;
  const words = t.match(/[\p{L}\p{M}][\p{L}\p{M}'’]*/gu) ?? [];
  if (words.length === 0 || words.length > 8) return false;
  const shouting = words.length > 1 && !/\p{Ll}/u.test(t);
  return words.every((w) => {
    const low = w.toLowerCase().replace(/['’]/g, "");
    if (!FILLER.has(low) && !STRETCHED.test(low) && !extra?.has(low)) return false;
    const caps = w.length >= 2 && w === w.toUpperCase() && w !== w.toLowerCase();
    return !(caps && !shouting && !SHOUT_OK.has(low));
  });
}

/* what kind of small talk it was, so that the reply can answer it (a thanks is not met with "hello") */
const GREET_WORD = /\b(?:hi+|hello+|hey+|hiya|heya|yo|namaste|namaskar|salaam|good (?:morning|afternoon|evening)|gm)\b|नमस्ते|नमस्कार|हेलो/i;
const THANKS_WORD = /\b(?:thanks?|thank you|thx|ty|shukriya|dhanyavaa?d|dhanyawad)\b|धन्यवाद|शुक्रिया/i;
const BYE_WORD = /\b(?:bye|goodbye|good bye|see you|see ya|take care|tata|alvida)\b|अलविदा/i;
const HOW_WORD = /\b(?:how are you|how r u|how are u|kaise ho|kaise hain|kaisi ho|kya haal|what'?s up|whats up|sup)\b|कैसे हो|कैसे हैं|क्या हाल/i;

/** `more` is what is said after an answer to a "cool" or an "ok" that has nothing else to answer: not an introduction of the box, an invitation to go on. */
const TALK_TEXT: Record<"en" | "hinglish" | "hi", { greet: string; how: string; thanks: string; bye: string; what: string; more: string }> = {
  en: { greet: "Hello!", how: "I'm doing well, thank you.", thanks: "You are welcome.", bye: "Goodbye.", what: SMALL_TALK_REPLY, more: "Ask a follow-up, or a new question, whenever you like." },
  hinglish: {
    greet: "Namaste!",
    how: "Main theek hu, shukriya.",
    thanks: "Koi baat nahi.",
    bye: "Alvida.",
    what: "Ye box research papers dhundta hai aur unhi se jawab deta hai. Kisi topic ke baare mein poochiye, apne references paste kijiye, ya apna idea batayiye.",
    more: "Koi aur sawaal ho to poochiye.",
  },
  hi: {
    greet: "नमस्ते!",
    how: "मैं ठीक हूँ, धन्यवाद।",
    thanks: "कोई बात नहीं।",
    bye: "अलविदा।",
    what: "यह बॉक्स शोध पत्र खोजता है और उन्हीं से उत्तर देता है। किसी विषय के बारे में पूछिए, अपने संदर्भ चिपकाइए, या अपना विचार बताइए।",
    more: "कोई और सवाल हो तो पूछिए।",
  },
};

/**
 * What the page answers to small talk: a line that suits the message (a hello, a "how are you", a thanks, a goodbye), in its language, then what the box is for. Written here, not by a
 * model, so it costs nothing, is the same for everyone and sends nothing anywhere. It makes no claim about the world.
 *
 * After an answer (`context`) the box does not introduce itself again: a thanks, a hello, a goodbye and a "how are you" get only their own line, an "ok" gets an invitation to go on, and only
 * a question about the box itself ("what can you do", "who are you") is still answered with what the box is for.
 */
export function smallTalkReply(text: string, language: Lang, context?: RouteContext): string {
  const w = TALK_TEXT[language === "hinglish" || language === "hi" ? language : "en"];
  const greeted = GREET_WORD.test(text);
  const open = THANKS_WORD.test(text) ? w.thanks : BYE_WORD.test(text) ? w.bye : HOW_WORD.test(text) ? (greeted ? `${w.greet} ${w.how}` : w.how) : greeted ? w.greet : "";
  if (hasContext(context) && !ABOUT_THE_BOX.test(text)) return open || w.more;
  return open ? `${open} ${w.what}` : w.what;
}

/* ---------------------------------------------------------------- with an earlier conversation */

/**
 * The words that make a message of filler words social once there is an earlier conversation: a hello, a thanks, a goodbye, "how are you", a reaction, a "cool". "ok", "yes", "no" and "sure"
 * are left out on purpose ("are you sure" and "ok so what" are questions); they are small talk there only as a whole message (`isSmallTalk`).
 */
const SOCIAL_WORD = new RegExp(
  [
    GREET_WORD.source,
    THANKS_WORD.source,
    BYE_WORD.source,
    HOW_WORD.source,
    String.raw`\b(?:lol|haha+|hehe+|hm+|wow|oops|sorry|omg|cool|nice|great|awesome|perfect|amazing|wonderful|excellent|helpful|understood|got it|alright|theek hai|accha|achha)\b`,
    "ठीक है|अच्छा",
  ].join("|"),
  "i",
);
/** A question about the box itself: still answered with what the box is for, also after an answer. */
const ABOUT_THE_BOX =
  /\b(?:who are you|what are you|what can you do|what do you do|how do you work|how does this work|help|what'?s your name|who made you|are you (?:there|a bot|a robot|real|human)|kaun ho tum|aap kaun ho)\b|आप कौन|तुम कौन|आप क्या कर सकते/i;

/** Whole words, in Latin letters and in Devanagari alike (`\b` does not know that a vowel sign is part of a word). */
const WORD_START = String.raw`(?<![\p{L}\p{M}\p{N}_])`;
const WORD_END = String.raw`(?![\p{L}\p{M}\p{N}_])`;
const wholeWord = (alternatives: string, leading = ""): RegExp => new RegExp(`${WORD_START}(?:${alternatives})${WORD_END}${leading ? `|^(?:${leading})${WORD_END}` : ""}`, "iu");

/**
 * What a message looks like when it leans on an earlier turn (the lists of docs/design/chat-actions-context.md, section 5). Words that are only a conjunction in the middle of a sentence
 * (and, but, aur, phir, और, फिर) count only at its start. A cue that is also in a plain question ("more", "it") sends that question to the model once for nothing, which costs about a thousand
 * tokens; a cue that is missing lets a message that leans on the earlier turns be searched as words, which is a wasted search and a wrong answer, so the list errs on the side of the model.
 */
const DEPENDS_EN = wholeWord(
  String.raw`it|its|that|this|these|those|they|them|their|theirs|same|also|more|again|instead|only|another|else|further|previous|above|earlier|former|latter|continue|elaborate|expand|simpler|shorter|longer|rephrase|reword|translate|translation|what about|how about|papers? (?:no\.? ?|number )?\d{1,2}|(?:the )?(?:first|second|third|fourth|fifth|last) (?:one|paper|study|result|article)|one of (?:them|these)|the other`,
  "and|but|also|so|then|now",
);
const DEPENDS_HINGLISH = wholeWord(
  "uska|uske|uski|iska|iske|iski|unka|unke|unki|inka|inke|inki|usko|isko|unko|inko|usme|isme|unme|inme|usse|isse|unse|inse|wahi|yahi|aage|pehla|pehli|pehle|dusra|dusri|dusre|pichla|pichli|pichle|yeh|ye|woh|wo|sirf|dobara|wapas",
  "aur|phir|fir",
);
const DEPENDS_DEVANAGARI = wholeWord(
  "उसका|उसके|उसकी|उसमें|उसे|उसको|इसका|इसके|इसकी|इसमें|इसे|इसको|उनका|उनके|उनकी|उनमें|उनको|इनका|इनके|इनकी|इनमें|इनको|वही|यही|आगे|पहला|पहली|पहले|दूसरा|दूसरी|दूसरे|पिछला|पिछली|पिछले|यह|वह|ये|वो|सिर्फ़|सिर्फ|केवल|दोबारा",
  "और|फिर",
);
const MARK_POINTER = /\[\d{1,2}\]/;

export const hasDependencyCue = (text: string): boolean => DEPENDS_EN.test(text) || DEPENDS_HINGLISH.test(text) || DEPENDS_DEVANAGARI.test(text) || MARK_POINTER.test(text);

const wordCount = (text: string): number => (text.match(/[\p{L}\p{M}\p{N}]+/gu) ?? []).length;

/** A message of fewer words than this is too short to say what it is about without the earlier turns, and may be in the language of the conversation without showing it (`languageWithContext`). */
export const SHORT_FOLLOW_UP_WORDS = 5;

/* ---- does a message of five words or more, with no cue, have a subject of its own? */

/**
 * Little words that are about no subject (English, Hinglish, Hindi), and the words a question is made of ("give", "put", "describe", numbers written out). The Roman-letter Hindi words of `HINGLISH` are
 * counted with them (`topicWordCount`).
 */
const FUNCTION_WORDS = /* @__PURE__ */ new Set(
  (
    "a an the of in on for to with from by at as and or but nor so if than that this these those it its is are was were be been being am do does did done has have had having can could will would shall should may might must " +
    "i me my mine we our you your he she they them their his her which what who whom whose when where why how whether there here any some all each every both either neither no not very much many more most less least other another such " +
    "own same just also too only then now again ever never about above below over under between among into onto upon through during before after since until up down out off per via vs versus please pls give show tell find list get got " +
    "let make put take use used using want need like see say said look looking known describe explain mention discuss include included including exclude limit restrict focus found made took given conducted carried tested measured " +
    "reported studied shown one two three four five six seven eight nine ten first second third last next " +
    "me par pe tak hi toh ab baat hua hui hue " +
    "में हैं हूँ हूं होता होती होते हुआ हुई हुए क्या कैसे कैसा कैसी क्यों कौन कहाँ कहां कितना कितने कितनी लेकिन मगर अभी फिर लिए बारे बात बताओ बताइए बताएं बता " +
    "दिखाओ दिखाइए रहा रही रहे जिस जिन वाले वाली वाला करो करके किया किए करें जाता जाती जाते सकता सकती सकते चाहिए गया कुछ कोई बाद पहले पूर्व"
  ).split(" "),
);
/**
 * Words that say what KIND of thing is asked, not what it is about: the kind of document ("papers", "trials"), what is asked of it ("side effects", "benefit", "cost"), a measure ("sample size", "dose",
 * "years"), a group of people or a place ("children", "women", "rural", "India"), a way of putting the answer ("version", "bullet", "summary"). A follow-up is made of them ("what were the side effects
 * in children"); a subject has words besides them. Roman-letter Hindi and Devanagari have their own.
 */
const FACET_WORDS = /* @__PURE__ */ new Set(
  (
    "paper papers study studies research review reviews trial trials analysis analyses evidence result results outcome outcomes finding findings report reports article articles literature source sources abstract abstracts journal journals " +
    "author authors publication publications published survey surveys data effect effects impact impacts side cost costs benefit benefits risk risks harm harms sample samples size sizes group groups control controls placebo dose doses " +
    "length duration version versions summary short long large big small bigger larger smaller new newer newest recent recently latest old older oldest current different difference differences similar compare compared comparison " +
    "better worse best worst good bad important main key overall general specific high higher low lower few number numbers amount level levels rate rates time period year years month months week weeks day days age percent percentage " +
    "country countries region regions place places population populations people person patient patients participants subjects men women woman man children child kids kid adults adult elderly young younger teenagers teenager adolescents " +
    "adolescent infants infant babies baby boys girls girl male female human humans urban rural city cities village villages india indian indians world global national local method methods approach approaches design " +
    "area areas community communities setting settings town towns district districts state states hospital hospitals clinic clinics school schools household households " +
    "answer answers question questions point points bullet bullets line lines sentence sentences paragraph paragraphs words detail details example examples reason reasons work works step steps " +
    "bachon bachche bachchon mahilaon mahila ladkiyon ladkon buzurgon buzurg gaon gaanv shehar shahar sheheron nateeje natije natija nateeja parinam hal haal shodh adhyayan labh logon log marizon mareez bharat samay saal sal varsh " +
    "बच्चों बच्चे बच्चा महिलाओं महिला महिलाएं लड़कियों लड़कों बुजुर्गों बुज़ुर्गों गांव गाँव गांवों गाँवों शहर शहरों शहरी असर प्रभाव नतीजे नतीजा परिणाम पेपर पेपरों अध्ययन अध्ययनों शोध हाल इलाकों इलाके क्षेत्र क्षेत्रों " +
    "भारत भारतीय ग्रामीण लाभ फायदा नुकसान लोगों लोग मरीजों मरीज़ साल वर्ष सालों संख्या नमूना आकार तरीके तरीकों कारण कारणों"
  ).split(" "),
);
const TOPIC_TOKEN = /[\p{L}\p{M}\p{N}]+(?:['’-][\p{L}\p{M}\p{N}]+)*/gu;

/**
 * How many words of a message are about a subject: not a function word, not a word of a kind (`FACET_WORDS`), not a number, and long enough to be a word of its own (three letters, or three
 * characters in a script other than Latin) unless it is an acronym ("TB") or has a digit in it ("COVID-19"). "effect of yoga on blood pressure" has three (yoga, blood, pressure); "what were the side
 * effects in children" and "papers from 2018 to 2021" have none. Pure, the same for everyone, and a count of words, not a judgement of the message.
 */
export function topicWordCount(text: string): number {
  return subjectWords(text).length;
}

/** The words of a text that are about a subject (see `topicWordCount`), as they are written. */
export function subjectWords(text: string): string[] {
  const t = text.normalize("NFKC").replace(/n['’]t\b/gi, "").replace(/['’](?:s|re|ve|ll|d|m)\b/gi, "");
  const out: string[] = [];
  for (const m of t.matchAll(TOPIC_TOKEN)) {
    const w = m[0];
    const low = w.toLowerCase();
    if (/^\p{N}+$/u.test(w) || FUNCTION_WORDS.has(low) || HINGLISH.has(low) || FACET_WORDS.has(low)) continue;
    const letters = (w.match(/\p{L}/gu) ?? []).length;
    const acronym = letters >= 2 && w === w.toUpperCase() && w !== w.toLowerCase();
    const latin = /^[\p{Script=Latin}\p{N}'’-]+$/u.test(w);
    if ((latin ? letters >= 3 : [...w].length >= 3) || acronym || /\p{N}/u.test(w)) out.push(w);
  }
  return out;
}

/** A way of putting the answer ("in two lines", "as bullet points", "in simple words", "chhota karke"): what a person asks of an answer that is already on the screen. */
const RESTYLE = wholeWord(
  String.raw`bullets?|bulleted|bullet points?|summari[sz]e|summary|tl;?dr|eli5|short version|(?:in|as|into) (?:one|two|three|four|five|a few|\d+) (?:lines?|sentences?|points?|words?|paragraphs?|bullets?)|(?:simple|plain|easy|easier) (?:words|terms|language|english)|chhota|chhoti|chhote|chota|aasan|asaan|saral|sankshep|संक्षेप|सरल|आसान|छोटा|छोटी|छोटे`,
);
/** "mine" in Roman-letter Hindi and in Devanagari: a message about the person's own text or papers is for the first-turn router, whatever its other words. */
const HI_FIRST_PERSON = wholeWord("mera|mere|meri|main|maine|mujhe|hamara|hamare|मेरा|मेरे|मेरी|मैं|मैंने|मुझे|हमारा|हमारे");

/** The longest message that is read with the turns for having no subject of its own; a longer one says enough. */
export const MAX_BARE_FOLLOW_UP_WORDS = 9;
/** A message with fewer words about a subject than this (and at most `MAX_BARE_FOLLOW_UP_WORDS` words) is read with the turns, or four if it names a way of putting the answer. */
export const MIN_TOPIC_WORDS = 2;

/** A cue-free message of five to nine words that says (almost) nothing about a subject: "give me the short version", "what were the side effects in children", "papers from 2018 to 2021". */
function lacksSubject(t: string): boolean {
  // a tool word, a first person, or a bare DOI: for the first-turn router (or settled before this is asked), not a leaning on the turns
  if (DOI.test(t) || ARXIV.test(t) || hasIdeaCue(t) || hasRefsCue(t) || hasPaperCue(t) || FIRST_PERSON.test(t) || TOOL_WORD.test(t) || HI_FIRST_PERSON.test(t)) return false;
  const topics = topicWordCount(t);
  return topics < MIN_TOPIC_WORDS || (topics < MIN_TOPIC_WORDS + 2 && RESTYLE.test(t));
}

/**
 * Can this message NOT be understood alone? True for fewer than five words, for any dependency cue, and for a message of five to nine words that has hardly a subject of its own (`lacksSubject`):
 * "what were the side effects in children" has no cue and five words, and alone it is a junk search. A text over 300 characters or of several lines is not a follow-up (a follow-up is a short
 * question): it is an idea, a list or a paper's text, and it stands alone whatever words it has. Used by the rules (`ruleRoute`) and by the server, which gives the model the earlier turns to read
 * only for a message that needs them. The cost of a question taken for a follow-up is about a thousand tokens (the model reads it with the turns and says it is new); the cost of a follow-up taken
 * for a question is a search of words that mean nothing alone.
 */
export function needsContext(text: string): boolean {
  const t = text.trim();
  if (t.length > MAX_CHAT_CHARS || t.includes("\n")) return false;
  const words = wordCount(t);
  if (words < SHORT_FOLLOW_UP_WORDS || hasDependencyCue(t)) return true;
  return words <= MAX_BARE_FOLLOW_UP_WORDS && lacksSubject(t);
}

/**
 * Does a short message carry a sign that it is Hinglish, though too little of it for `detectLanguage` ("aur bachon me?")? A Hinglish cue ("uska", "aur" at the start, "wahi"...). Not any word of the
 * Roman-letter Hindi list: "jab" (a jab), "Se" and "Ne" (elements), "Kar", "tune" and "agar" are English words and names too, and one of them in a short message is no sign.
 */
const hasHinglishSign = (text: string): boolean => DEPENDS_HINGLISH.test(text);
/** Words that are English and nothing else (not "me", "the" (tha), "to", "par", "do", "are"): one of them in a short message means the person has just written English. */
const ENGLISH_ONLY = /* @__PURE__ */ new Set("what about which who how why where does did with from for any there their would could should will can have has and than please now".split(" "));
const hasEnglishWord = (text: string): boolean => (text.toLowerCase().match(/[a-z]+/g) ?? []).some((w) => ENGLISH_ONLY.has(w));

/**
 * The language an answer is written in: the language of the message, found by rules as ever, with one addition for a short follow-up. "aur bachon me?" and "kids?" can be Hinglish but read as English
 * (two Hindi words are needed, and they have one), so the answer would come in English; a message of fewer than five words that reads as English takes the language of the conversation when one of the last
 * two questions was Hindi or Hinglish (in Roman letters, as the message was typed), and is Hinglish when it has a Hinglish sign of its own. A short message with an English word of its own ("what about older
 * adults") stays English: the person has just written English, in whatever language the chat was. `earlierQuestions` are the person's own questions in THIS conversation, oldest first (never those of other
 * chats: a question from another chat says nothing of the language of this one). A deliberate rule, not a guess of the model's: "in English" (the router's `answer_language`) changes it.
 */
export function languageWithContext(text: string, earlierQuestions: readonly string[]): Lang {
  const own = detectLanguage(text);
  if (own !== "en") return own;
  const words = wordCount(text);
  // a Hinglish cue is a sign also in a message of five to eight words ("iska matlab simple bhasha me" has one Hindi word the detector counts, and was answered in English)
  if (words <= 8 && hasHinglishSign(text)) return "hinglish";
  if (words >= SHORT_FOLLOW_UP_WORDS) return own;
  if (hasEnglishWord(text)) return own;
  return earlierQuestions.slice(-2).some((q) => {
    const l = detectLanguage(q);
    return l === "hi" || l === "hinglish";
  })
    ? "hinglish"
    : own;
}
