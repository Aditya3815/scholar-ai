import { words, type Paper } from "@scholar/shared";

/**
 * Is a paper the search returned about the sub-question? A search index ranks loosely: a live run (27 Oct 2026) of a Hinglish topic about children's eyes and phones returned a blast injury from a phone
 * battery, a text-message HIV programme and a study of screen-protector glass among the first twenty, and the model, asked to read them, dutifully cited eight of them to say that none of them
 * was about the question. Nothing it wrote was false, but a report with those sources is noise, and every one of them cost tokens.
 *
 * So before the model reads anything, a paper has to share the search words' own terms: at least half of the distinct content words of the English search words (and at least two, when there are
 * that many) must appear in its title or abstract. Plain word matching, no model, the same answer every time. Words that name a kind of study rather than a subject (review, trial, analysis...)
 * count neither for nor against, and a word is compared by its first five letters (children, child; measurement, measure).
 */
const GENERIC = new Set(
  ("the and for with from into over under than that this these those their there about between among using use used via per vs versus study studies trial trials review reviews systematic meta analysis analyses " +
    "randomized randomised controlled clinical evidence outcome outcomes effect effects impact impacts factor factors method methods assessment assessments measurement measurements research future gap gaps " +
    "uncertainty priority priorities").split(" "),
);
const stem = (w: string) => w.slice(0, 5);

/** The terms a search is about, as stems: distinct, at least three letters, no filler and no study-design words. */
export function contentStems(query: string): string[] {
  return [...new Set(words(query).filter((w) => w.length >= 3 && !GENERIC.has(w)).map(stem))];
}

/** How many of the query's stems the paper's title and abstract use, and out of how many. */
export function matchOf(query: string, paper: Pick<Paper, "title" | "abstract">): { matched: number; total: number } {
  const wanted = contentStems(query);
  if (wanted.length === 0) return { matched: 0, total: 0 };
  const have = new Set(words(`${paper.title} ${paper.abstract ?? ""}`).map(stem));
  return { matched: wanted.filter((s) => have.has(s)).length, total: wanted.length };
}

/** A query with no content words (nothing to compare) lets every paper through: the check only removes what it can show is off the subject. */
export function isRelevant(query: string, paper: Pick<Paper, "title" | "abstract">): boolean {
  const { matched, total } = matchOf(query, paper);
  if (total === 0) return true;
  return matched >= Math.min(2, total) && matched / total >= 0.5;
}
