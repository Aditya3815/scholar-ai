import type { Paper } from "@scholar/shared";
import { contentStems, isRelevant, matchOf } from "../litscan/relevance";

/**
 * R9 (docs/design/intent-and-state.md, 4.9): how close each paper of a list is to the words that were searched, in three tiers, and when the page may say anything about it at all.
 *
 *   strong  the literature scan's own rule passes (`isRelevant`: half of the content stems, at least two; a stem is the first five letters; words that name a kind of study count neither way);
 *   medium  at least one content stem matches and the rule does not pass;
 *   weak    no content stem matches, or the record is only a stub (an Introduction, a Summary, a figure caption).
 *
 * The rule is IMPORTED from apps/api/src/litscan/relevance.ts and is not written again here: a second copy would drift from the first, and the plan's gates were set for that one. Pure and total: no
 * network, no store, no clock, and nothing that throws. The words are what the indexes were asked (the Reading's topic, or the words as written), never anything else about the person.
 *
 * THE TRUST RULE. Tiers and the states built on them apply only when the words have 1 to 6 content stems (`MAX_TIER_STEMS`) and are written in letters the tokeniser keeps whole: with none there is nothing
 * to compare (`isRelevant` lets everything through), with more the half-the-stems rule asks for so many matches that a good list of a long question is called weak (the frame prototype of the plan's studies
 * changed 15 of 45 messages), and a script whose words the tokeniser cuts in the middle (Devanagari, whose vowel signs are not letters to it) would be judged on pieces of words. Then the page abstains and the
 * list is what it was.
 *
 * Nothing here deletes anything: a tier only says where a paper is listed and what the page says about the list.
 */
export type Tier = "strong" | "medium" | "weak";

/** The most content stems a reading may have for the page to judge a list against it. */
export const MAX_TIER_STEMS = 6;
/** The longest words the page judges a list against (a search is at most 300 characters; this keeps the module total for any input). */
const MAX_QUERY_CHARS = 1000;

/**
 * Titles that are only a section of a book or a part of a record, not a paper (17 "Python Basics" chapter records in one message; 29 of 560 Crossref records of the providers study were captions): the plan's
 * eleven words, and the other spelling of two of them. Compared after the case, the white space and the punctuation at the edges are taken off. A title that merely starts with one of them ("Introduction to
 * machine learning") is a paper. Written from the plan before any list was read, and not changed after one.
 */
export const STUB_TITLE_WORDS: readonly string[] = [
  "introduction", "summary", "contents", "index", "frontmatter", "front matter", "notes", "acknowledgements", "acknowledgments", "preface", "foreword", "cover", "inactive dois",
];
const STUB_SET: ReadonlySet<string> = new Set(STUB_TITLE_WORDS);
/** "Figure 3: ..." and "Table 12: ...": a caption that a publisher registered as a record. */
const CAPTION = /^(?:figure|table)\s+\d+\s*:/;
const EDGES = /^[\s.:;,!?'"‘’“”()[\]-]+|[\s.:;,!?'"‘’“”()[\]-]+$/g;

/** Is this title only a stub? */
export function isStubRecord(title: string): boolean {
  if (typeof title !== "string") return false;
  const t = title.toLowerCase().replace(EDGES, "").replace(/\s+/g, " ");
  return STUB_SET.has(t) || CAPTION.test(title.toLowerCase().trim());
}

/** Letters the tokeniser (`words()`: letters and digits) keeps whole: Latin and Greek. Any other script is cut in the middle of its words (a Devanagari vowel sign is a mark, not a letter). */
const KEPT_WHOLE = /^[\p{Script=Latin}\p{Script=Greek}]$/u;
const wholeWords = (query: string): boolean => (query.match(/\p{L}/gu) ?? []).every((ch) => KEPT_WHOLE.test(ch));

export type TierPaper = Pick<Paper, "title" | "abstract">;
export type TierCounts = { strong: number; medium: number; weak: number; total: number };

export type Tierer = {
  /** How many content stems the words have (1 to 6). */
  stems: number;
  tier(paper: TierPaper): Tier;
  /** Strong first, then medium, then weak, each in the order it had; a new list, the same papers. */
  order<T extends TierPaper>(list: readonly T[]): T[];
  counts(list: readonly TierPaper[]): TierCounts;
};

/** The tier of one paper against words that are judged (`tiererFor` gives a function that only ever calls this for such words). */
function tierAgainst(query: string, paper: TierPaper): Tier {
  if (isStubRecord(paper.title)) return "weak";
  if (isRelevant(query, paper)) return "strong";
  return matchOf(query, paper).matched >= 1 ? "medium" : "weak";
}

/**
 * The tiers of a list against these words, or null when the page may not judge them (the trust rule above): no tier, no reorder, no line, and the writer is asked what it was always asked. Never throws.
 */
export function tiererFor(query: string): Tierer | null {
  try {
    if (typeof query !== "string" || query.length > MAX_QUERY_CHARS || !wholeWords(query)) return null;
    const stems = contentStems(query).length;
    if (stems < 1 || stems > MAX_TIER_STEMS) return null;
    // a request reads the same papers several times (each list while the sources answer, the final one, the counts, the writer's pick): each paper object is read once. Papers are never changed after they are listed.
    const seen = new WeakMap<TierPaper, Tier>();
    const tier = (paper: TierPaper): Tier => {
      let t = seen.get(paper);
      if (t === undefined) seen.set(paper, (t = tierAgainst(query, paper)));
      return t;
    };
    return {
      stems,
      tier,
      order<T extends TierPaper>(list: readonly T[]): T[] {
        const buckets: Record<Tier, T[]> = { strong: [], medium: [], weak: [] };
        for (const p of list) buckets[tier(p)].push(p);
        return [...buckets.strong, ...buckets.medium, ...buckets.weak];
      },
      counts(list: readonly TierPaper[]): TierCounts {
        const c: TierCounts = { strong: 0, medium: 0, weak: 0, total: list.length };
        for (const p of list) c[tier(p)]++;
        return c;
      },
    };
  } catch {
    return null;
  }
}

/**
 * What the page says about a judged list (plan 4.9):
 *   empty  no paper at all (the existing "Nothing was found" line, not this release's);
 *   none   papers, and not one is strong (S-NONE-CLOSE);
 *   few    one or two strong papers and others besides (S-FEW: "the others are weaker matches and are listed after them", which is untrue of a list that has no others);
 *   close  three or more strong papers, or every paper is strong: nothing is said.
 */
export type ListState = "empty" | "none" | "few" | "close";
export function listState(c: TierCounts): ListState {
  if (c.total === 0) return "empty";
  if (c.strong === 0) return "none";
  if (c.strong <= 2 && c.total > c.strong) return "few";
  return "close";
}
