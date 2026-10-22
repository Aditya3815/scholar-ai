import type { IdeaKind } from "@scholar/shared";

/**
 * What a record is, for Idea Check. Prior art is mostly papers; a dataset or a software record (a Zenodo or GitHub deposit with a DOI) is
 * a different thing and, left in the list, pushes real papers down. The index's own type is used when it gives one; otherwise the DOI
 * prefix or the venue of a data repository decides.
 *
 *   null  = not a work at all (a front-page notice, an erratum, a peer-review report, a grant, supplementary files): left out
 */
const NOT_A_WORK = new Set(["paratext", "erratum", "peer-review", "grant", "supplementary-materials", "retraction"]);
const BY_TYPE: Record<string, IdeaKind> = {
  article: "paper",
  review: "paper",
  letter: "paper",
  editorial: "paper",
  preprint: "preprint",
  book: "book",
  "book-chapter": "book",
  "book-section": "book",
  monograph: "book",
  dissertation: "thesis",
  report: "report",
  standard: "report",
  dataset: "data",
  software: "data",
};

/** Zenodo, figshare, OSF, Dryad, Harvard Dataverse, Mendeley Data, ICPSR, GitHub (via Zenodo), Kaggle. */
const REPOSITORY_DOI = /^10\.(5281|6084|17605|5061|7910|17632|3886|34740)\//;
const REPOSITORY_VENUE = /\b(zenodo|figshare|dryad|dataverse|osf preprints?|open science framework|mendeley data|github|kaggle|hugging ?face)\b/i;

export function classifyWork(w: { workType?: string | null; doi: string | null; venue: string | null }): IdeaKind | null {
  const type = w.workType?.toLowerCase() ?? "";
  if (NOT_A_WORK.has(type)) return null;
  const known = BY_TYPE[type];
  if (known && !(known === "paper" && REPOSITORY_DOI.test(w.doi ?? "") && /software|dataset/i.test(w.venue ?? ""))) return known;
  // "other" and "unknown" (and records from sources that give no type): look at where it is deposited
  if (REPOSITORY_DOI.test(w.doi ?? "") || REPOSITORY_VENUE.test(w.venue ?? "")) return "data";
  return "paper";
}
