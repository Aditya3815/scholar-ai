import { detectLanguage } from "@scholar/shared";

/**
 * The "Try" chips: example searches the owner chose, shown on Home and under a reply that has nothing to show (a greeting, a search that found no paper). One list, the same everywhere, never called
 * trending and never made by a model (docs/design/chatview-and-trending.md, T2). A click sends one. They are held to what a message is held to by apps/api/src/trending/starters.test.ts (the chat cleaner leaves
 * them as they are, none reads as small talk, 2 to 8 of them) and, once a week, to a live search (scripts/trending-contract-live.mjs).
 *
 * Four are the owner's English ones, two more are about India, and two are in Hinglish. A Hinglish chip is sent through Auto, which writes the English words and says so ("I searched for"). On the
 * live search of 4 Nov 2026 the Hinglish words as they stand found nothing in OpenAlex and a few unrelated records in Crossref, so a chip that is not English is offered only to a person who is signed
 * in (Auto needs the AI service to translate): see `startersFor`.
 */
export const STARTERS = [
  "graph neural networks",
  "NEP 2020 higher education India",
  "CRISPR off-target effects",
  "plagiarism detection techniques",
  "UPI digital payments rural India",
  "MGNREGA impact on rural employment",
  "climate change ka farmers par asar kya hai",
  "diabetes me exercise ka kya asar hota hai",
];

/** True for a chip the indexes can be asked as it is written. */
export const inEnglish = (text: string): boolean => detectLanguage(text) === "en";

/** The chips a visitor is offered: all of them for a person who is signed in, and without the ones that need Auto's translation for anybody else. */
export const startersFor = (signedIn: boolean): readonly string[] => (signedIn ? STARTERS : STARTERS.filter(inEnglish));

/** How a chip is sent: an English one is a search chosen by hand (searched as written, as it always was); a Hinglish one goes through Auto, which translates it. */
export const starterMode = (text: string): "search" | "auto" => (inEnglish(text) ? "search" : "auto");
