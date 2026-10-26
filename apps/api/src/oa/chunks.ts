import { chunkPage } from "../docs/chunk";
import type { JatsSection } from "./jats";

/**
 * The text of a paper as the passages that questions are answered from. The same chunker as for a person's own papers (about 1,000 characters, ending at sentence
 * boundaries, a little overlap). The unit of position is `page`: a real page for a PDF, the ordinal of the section for XML (which has no pages), with the section's name in
 * `section`, so an answer can say "Methods > Participants" where a PDF would say "page 4". `idx` is `page * 1000 + n`, so a passage keeps its reading order and a repeated
 * step writes exactly the rows it wrote before.
 */
export type OaChunk = { idx: number; page: number; section: string | null; text: string };

export function chunksFromPages(pages: readonly { page: number; text: string }[]): OaChunk[] {
  return pages.flatMap((p) => chunkPage(p.page, p.text).map((c) => ({ idx: c.idx, page: c.page, section: null, text: c.text })));
}

/** The abstract first (when there is one), then the sections in reading order. A section too short to be worth a passage is dropped by the chunker. */
export function chunksFromSections(sections: readonly JatsSection[], abstract: string | null): OaChunk[] {
  const all: { title: string | null; text: string }[] = [...(abstract ? [{ title: "Abstract", text: abstract }] : []), ...sections];
  return all.flatMap((s, i) => chunkPage(i + 1, s.text).map((c) => ({ idx: c.idx, page: c.page, section: s.title, text: c.text })));
}
