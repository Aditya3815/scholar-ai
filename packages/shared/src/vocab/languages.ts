/** The languages of the prompt box (docs/design/untangle.md, 1.2 and F4): one closed list each, with the types derived from them. Imports nothing. */

/** What the rules can tell a message is written in. */
export const LANGS = ["en", "hi", "hinglish", "other"] as const;
export type Lang = (typeof LANGS)[number];
export const isLang = (v: unknown): v is Lang => typeof v === "string" && (LANGS as readonly string[]).includes(v);

/** The languages an answer can be asked for in, and the Understand step's languages: the three the page writes in. */
export const ANSWER_LANGUAGES = ["en", "hi", "hinglish"] as const;
export type AnswerLanguage = (typeof ANSWER_LANGUAGES)[number];

/** A language as one of the three the page writes in: Hindi and Hinglish stay, anything else is English. */
export const threeWay = (l: Lang): AnswerLanguage => (l === "hi" || l === "hinglish" ? l : "en");
