import type { Embedder } from "../../platform/llm/port";
import { keywords } from "../vector";

/** Deterministic bag-of-words hashing into 128 dimensions. Tests and local end-to-end runs only (app/stand-ins.ts hands it to a test run). */
export const hashEmbedder: Embedder = async (texts) =>
  texts.map((t) => {
    const v = new Array<number>(128).fill(0);
    for (const w of keywords(t)) {
      let h = 2166136261;
      for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w.charCodeAt(i), 16777619);
      v[(h >>> 0) % 128]! += 1;
    }
    return v;
  });
