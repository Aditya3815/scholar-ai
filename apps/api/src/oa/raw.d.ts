/** Test fixtures are read as text with Vite's `?raw` import (the API has no Node types). */
declare module "*.xml?raw" {
  const text: string;
  export default text;
}

/** The tiny PDF writer of the integration tests, used here to make real PDFs for the extractor. */
declare module "*/make-pdf.mjs" {
  export const SAMPLE_PAPER: string[];
  export function makePdf(pages: string[], opts?: { width?: number; title?: string }): Uint8Array;
}
