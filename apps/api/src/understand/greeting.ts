import { isSmallTalk } from "@scholar/shared";

/**
 * The greeting list, with a normaliser (design of 6 Nov 2026, pages 5 and 9): a message that is only a greeting, a thanks, a goodbye, "how are you" or "what can you do", in English, Hinglish or
 * Hindi, and typed the way people type on a phone ("HY", "hlo", "hii", "heyy", "thnx", "Aur batao sab badhiya?"). A match skips the Understand call (one model call saved) and is answered as
 * conversation; it is ALSO the safety net of the fail policy: a message on this list is never searched, whatever else fails.
 *
 * Only the whole message counts: "hi, papers on dengue" has a topic word and is not a greeting. Safe by construction like `isSmallTalk` (which it also asks): a word that can be a topic is not on any
 * list here, so one real word makes the message go on to Understand.
 */

/** Spelling a phone keyboard makes of a greeting word, to the word. Applied after letters repeated three or more times are cut to one ("hiii", "heyyy", "okkk"). */
const TYPO: Record<string, string> = {
  hy: "hi", hii: "hi", hiya: "hi", hlo: "hello", hllo: "hello", helo: "hello", hellow: "hello", hello: "hello", heloo: "hello", helloo: "hello", hey: "hey", hye: "hey", heyy: "hey", hay: "hey",
  thnx: "thanks", thx: "thanks", thnks: "thanks", thanx: "thanks", tnx: "thanks", thnku: "thanks", thanku: "thanks", thankyou: "thanks", tq: "thanks", ty: "thanks", tysm: "thanks",
  gud: "good", gd: "good", mrng: "morning", morng: "morning", mornin: "morning", nyt: "night", nite: "night", evng: "evening", eve: "evening",
  u: "you", r: "are", ur: "your", k: "ok", kk: "ok", okk: "ok", okie: "ok", oki: "ok", okay: "ok", acha: "accha", achha: "accha", thik: "theek", thk: "theek",
  badiya: "badhiya", badhia: "badhiya", bdiya: "badhiya", bdhiya: "badhiya", rha: "raha", rhe: "rahe", h: "hai", hn: "haan", han: "haan",
  dhanyawad: "dhanyavad", dhanyavaad: "dhanyavad", shukriyaa: "shukriya", namastey: "namaste", namasté: "namaste", byee: "bye", byeee: "bye", gn: "goodnight", gm: "goodmorning",
};

/** Words that make a message social on their own: one of them must be there. */
const SOCIAL = new Set(
  (
    "hi hello hey namaste namaskar salaam ram pranam goodmorning goodnight morning evening night afternoon thanks thank shukriya dhanyavad bye goodbye tata alvida " +
    "ok cool nice great awesome accha theek badhiya mast haal batao kaise kaisa kaisi kaun sup"
  ).split(" "),
);
/** The little words greetings and "how are you" are made of (English and Hinglish). None of them is a topic. */
const FILLER = new Set(
  (
    "good you are your how is it the a an there everyone all sir madam mam maam ji bhai bhaiya didi dost yaar bro buddy friend team again so much very lot " +
    "aur sab kya hai hain ho tum aap app ap tu kar sakte sakti sakta raha rahe rahi chal haal hal ka ke ki se bhi to toh na hello hi hey doing today going on " +
    "what whats up do can who are am i fine well too also and just again ji haan nahi please plz pls"
  ).split(" "),
);
/** Questions about the box itself, whole message (after normalising). */
const ABOUT_BOX = [
  /^(?:what|wht) (?:can|do) you do$/,
  /^what (?:all )?can you help (?:me )?with$/,
  /^how (?:can|do) you help(?: me)?$/,
  /^(?:who|what) are you$/,
  /^who (?:made|built|created) you$/,
  /^are you (?:chatgpt|gpt|claude|gemini|a bot|a robot|human|an ai|ai)$/,
  /^(?:tum|aap|ap) (?:kya|kya kya) kar (?:sakte|sakti|sakta) (?:ho|hain|hai)$/,
  /^(?:tum|aap|ap) (?:kaun|kon) (?:ho|hain|hai)$/,
  /^(?:tum|aap|ap) kya (?:karte|karti) (?:ho|hain|hai)$/,
  /^ye kya hai$/,
  /^(?:yeh|ye) (?:website|site|app) kya (?:karti|karta) hai$/,
];
/** Social phrases made of words that are not social alone ("kya chal raha hai"). */
const SOCIAL_PHRASES = [/^(?:aur )?(?:kya|kaisa) chal (?:raha|rahe) (?:hai|ho)(?: bhai| yaar| dost)?$/];
const DEVANAGARI_GREETING = new RegExp(
  "^(?:" +
    [
      "नमस्ते(?: जी)?", "नमस्कार(?: जी)?", "प्रणाम", "राम राम", "धन्यवाद(?: जी)?", "शुक्रिया(?: जी)?", "बहुत धन्यवाद", "अलविदा", "ठीक है", "अच्छा", "सुप्रभात", "शुभ रात्रि",
      "(?:आप|तुम) कैसे (?:हैं|हो)", "(?:आप|तुम) कौन (?:हैं|हो)", "(?:आप|तुम) क्या कर सकते (?:हैं|हो)", "क्या हाल है", "और बताओ(?: सब बढ़िया)?", "सब बढ़िया(?: है)?",
      "हाय", "हेलो", "हैलो",
    ].join("|") +
    ")$",
);

/** The message as the lists read it: lower case, Devanagari danda, punctuation and emoji out, repeated letters cut, typos mapped, space-joined. */
export function normaliseGreeting(text: string): string {
  const t = text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\u{1F000}-\u{1FAFF}☀-➿️‍]/gu, " ")
    .replace(/['’‘]/g, "")
    .replace(/[।॥.,!?;:~…"“”()\-_*#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/[ऀ-ॿ]/.test(t)) return t;
  return t
    .split(" ")
    .map((w) => w.replace(/([a-z])\1{2,}/g, "$1"))
    .map((w) => TYPO[w] ?? w)
    .join(" ")
    .replace(/\bthank you\b/g, "thanks")
    .replace(/\bgood morning\b/g, "goodmorning")
    .replace(/\bgood night\b/g, "goodnight");
}

/** At most this many characters: a greeting is short. */
const MAX_GREETING_CHARS = 60;

/** Is the whole message a greeting, thanks, goodbye, "how are you" or a question about the box? */
export function isGreeting(text: string): boolean {
  if (typeof text !== "string") return false;
  const raw = text.trim();
  if (!raw || raw.length > MAX_GREETING_CHARS || /\d/.test(raw)) return false;
  const n = normaliseGreeting(raw);
  if (!n) return false;
  if (DEVANAGARI_GREETING.test(n)) return true;
  if (ABOUT_BOX.some((re) => re.test(n)) || SOCIAL_PHRASES.some((re) => re.test(n))) return true;
  const words = n.split(" ");
  // An all-capitals word of two to five letters in a longer message is an acronym (HIV, CNN), not a shout: "HY" alone is a greeting, "hi HIV" is not.
  if (words.length > 1 && raw.split(/\s+/).some((w) => /^[A-Z]{2,5}$/.test(w) && !TYPO[w.toLowerCase()] && !SOCIAL.has(w.toLowerCase()) && !FILLER.has(w.toLowerCase()))) return false;
  if (words.every((w) => SOCIAL.has(w) || FILLER.has(w)) && words.some((w) => SOCIAL.has(w))) return true;
  return isSmallTalk(raw);
}

/** What kind of greeting, for a reply written without a model (a visitor past the cap, every model down). */
export type GreetingKind = "hello" | "thanks" | "bye" | "how_are_you" | "about";
export function greetingKind(text: string): GreetingKind {
  const n = normaliseGreeting(text);
  if (ABOUT_BOX.some((re) => re.test(n)) || /कौन|क्या कर सकते|what is this|help/.test(n)) return "about";
  if (/\b(?:thanks|shukriya|dhanyavad)\b|धन्यवाद|शुक्रिया/.test(n)) return "thanks";
  if (/\b(?:bye|goodbye|tata|alvida|goodnight|take care)\b|अलविदा|शुभ रात्रि/.test(n)) return "bye";
  if (/\b(?:how are|kaise|kaisa|kaisi|haal|batao|badhiya|whats up|sup|chal raha|chal rahe)\b|कैसे|हाल|बताओ|बढ़िया/.test(n)) return "how_are_you";
  return "hello";
}
