/** "Open this paper at that page": a search result or a "Remember this?" card sets it, the reader takes it once when the paper is open. It goes stale after ten seconds so it can never surprise a later visit. */
type Jump = { docId: string; page: number; quote?: string; at: number };
let pending: Jump | null = null;

export function requestJump(docId: string, page: number, quote?: string) {
  pending = { docId, page, quote, at: Date.now() };
}
export function takeJump(docId: string): { page: number; quote?: string } | null {
  const j = pending;
  pending = null;
  return j && j.docId === docId && Date.now() - j.at < 10_000 ? { page: j.page, quote: j.quote } : null;
}
