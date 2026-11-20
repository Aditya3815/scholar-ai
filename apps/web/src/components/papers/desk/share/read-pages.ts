import type { NotebookInk, NotebookPage } from "@scholar/shared";

/** The pages of notes last read for each paper in this visit (a Viewer's or a Commenter's read-only notes): going to the comments and back draws them at once, and the comments name a block's page from them. */
export const readPages = new Map<string, NotebookPage[]>();
/** The ink on those pages (paper-reader.md 25), read with them. */
export const readInk = new Map<string, NotebookInk[]>();
