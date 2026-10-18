import { words } from "@scholar/shared";

/** Embeddings are stored as little-endian float32 BLOBs; retrieval is cosine similarity plus a small keyword signal. */

/**
 * Vectors are stored as int8 (each component scaled by the vector's largest) in base64 text. Cosine similarity ignores scale,
 * and 8 bits per component is plenty for ranking six passages out of a few hundred.
 */
export function encodeVec(v: ArrayLike<number>): string {
  let max = 0;
  for (let i = 0; i < v.length; i++) max = Math.max(max, Math.abs(v[i]!));
  const bytes = new Uint8Array(v.length);
  const k = max > 0 ? 127 / max : 0;
  for (let i = 0; i < v.length; i++) bytes[i] = Math.round(v[i]! * k) & 0xff;
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x2000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x2000));
  return btoa(bin);
}
export function decodeVec(s: string): Float32Array {
  const bin = atob(s);
  const out = new Float32Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    const b = bin.charCodeAt(i);
    out[i] = b > 127 ? b - 256 : b;
  }
  return out;
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

const STOP = new Set(
  "a an the of in on at to for from by with and or but not is are was were be been being this that these those it its as into than then so such which who whom what when where why how do does did can could should would may might will shall we our us you your they their there here about over under between across per via also using used use paper study".split(" "),
);
export { words };
export const keywords = (s: string): string[] => [...new Set(words(s).filter((w) => w.length > 2 && !STOP.has(w)))];

/** Share of the question's keywords that occur in the chunk (0..1). */
export function lexical(qWords: string[], text: string): number {
  if (qWords.length === 0) return 0;
  const have = new Set(words(text));
  return qWords.filter((w) => have.has(w)).length / qWords.length;
}

export type Scored<T> = T & { score: number };

/**
 * Hybrid rank: 0.75 * semantic + 0.25 * keyword. `semantic` is cosine rescaled so typical values spread over 0..1.
 * Chunks whose embedding has a different length than the question's (a different model) are ranked on keywords alone.
 */
export function rank<T extends { text: string; embedding?: Float32Array | null }>(question: string, qVec: ArrayLike<number> | null, chunks: T[], k: number): Scored<T>[] {
  const q = keywords(question);
  return chunks
    .map((c) => {
      const sem = qVec && c.embedding && c.embedding.length === qVec.length ? Math.max(0, cosine(qVec, c.embedding)) : 0;
      return { ...c, score: 0.75 * sem + 0.25 * lexical(q, c.text) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
