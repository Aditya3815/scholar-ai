import { normalizeTitle } from "./normalize";
import type { ProviderPaper } from "./types";

/**
 * A name written as one word ("SwinYolo", "SwinYOLO", "swin_yolo") is written as several in most papers ("Swin-YOLO", "Swin YOLO"), and the services match whole words:
 * "SwinYolo" finds the one paper that wrote it that way and misses the hundreds that did not. When a search finds few papers, the same search is run again with the name
 * split into its words. The services treat "Swin-YOLO" and "Swin YOLO" alike, so one spelling is enough.
 */
export const FEW_RESULTS = 12;
export const MAX_VARIANTS = 2;

/** Pieces of one token, split where a lowercase letter meets a capital, where a long capitalised word follows capitals ("XMLHttpRequest") and at "_". Never between letters and digits: "YOLOv8", "GPT4", "3D" are single names. */
export function splitToken(token: string): string[] {
  if (!/^[\p{L}\p{N}_]+$/u.test(token)) return [token]; // hyphens, dots and other punctuation: already a deliberate spelling
  const spaced = token
    .replace(/_+/g, " ")
    .replace(/(?<=\p{Ll})(?=\p{Lu})/gu, " ") // swinYolo, SwinYOLO
    .replace(/(?<=\p{Lu})(?=\p{Lu}\p{Ll}{2,})/gu, " "); // XMLHttp -> XML Http (but YOLOv8 stays)
  return spaced.split(" ").filter(Boolean);
}

const hasWord = (parts: string[]) => parts.filter((p) => /\p{L}{3}/u.test(p)).length >= 2;

/**
 * Other ways to write the same search: each token that is really several words is split. Empty when no token is (most searches), or when the pieces would be
 * too small to mean anything. The original is never in the list.
 */
export function queryVariants(q: string): string[] {
  const tokens = q.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || q.length < 4) return [];
  let changed = false;
  const out = tokens.flatMap((t) => {
    const parts = splitToken(t);
    if (parts.length > 1 && hasWord(parts)) {
      changed = true;
      return parts;
    }
    return [t];
  });
  const spaced = out.join(" ");
  if (!changed || spaced.toLowerCase() === tokens.join(" ").toLowerCase()) return [];
  return [spaced].slice(0, MAX_VARIANTS);
}

const keyOf = (p: ProviderPaper) => p.doi ?? (p.pmid ? `pmid:${p.pmid}` : `t:${normalizeTitle(p.title)}|${p.year ?? ""}`);

/**
 * The answers of one provider to the original search and to its variants as one list: rank by rank, the original first, each paper once. So a paper that both
 * spellings found keeps its high place, and the variants fill in what the original did not find.
 */
export function interleave(lists: readonly ProviderPaper[][]): ProviderPaper[] {
  const seen = new Set<string>();
  const out: ProviderPaper[] = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++) {
    for (const l of lists) {
      const p = l[i];
      if (!p) continue;
      const k = keyOf(p);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(p);
    }
  }
  return out;
}
