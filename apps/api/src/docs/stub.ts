import { extractJson } from "../llm/gateway";
import type { Complete, StreamComplete } from "./qa";
import { keywords, lexical } from "./vector";

/**
 * Offline stand-in for the language model, used ONLY by tests and the local end-to-end run (QA_STUB=1 together with
 * ENABLE_DEV_ROUTES=1, neither of which is ever uploaded as a production secret). It answers with the first sentence of the
 * excerpt that best matches the question, quoted exactly, so the whole upload -> index -> ask -> verify -> highlight path can
 * be tested without a model. A question containing "unanswerable" gets "the paper does not cover this"; one containing
 * "hallucinate" gets an invented quote, which verification must catch.
 */
export const stubComplete: Complete = async ({ user }) => {
  const question = /^Question: (.*)$/m.exec(user)?.[1] ?? "";
  if (/unanswerable/i.test(question)) return { model: "stub", json: { found: false, answer: "The paper does not seem to cover this.", evidence: [] } };

  const excerpts = [...user.matchAll(/\[(\d+)\] \(page \d+\) ([\s\S]*?)(?=\n---\n\[\d+\] \(page|$)/g)].map((m) => ({ n: Number(m[1]), text: m[2]!.trim() }));
  const q = keywords(question);
  const best = [...excerpts].sort((a, b) => lexical(q, b.text) - lexical(q, a.text))[0] ?? { n: 1, text: "" };
  // The sentence that shares the most words with the question (not just the first one on the page).
  const sentences = best.text.match(/[^.!?]+[.!?]?/g)?.map((s) => s.trim()).filter(Boolean) ?? [best.text];
  const sentence = ([...sentences].sort((a, b) => lexical(q, b) - lexical(q, a))[0] ?? best.text).slice(0, 190);

  if (/hallucinate/i.test(question)) {
    return { model: "stub", json: { found: true, answer: `It was invented by nobody [${best.n}].`, evidence: [{ excerpt: best.n, quote: "this sentence is not anywhere in the paper at all" }] } };
  }
  return { model: "stub", json: { found: true, answer: `According to the paper: ${sentence} [${best.n}]`, evidence: [{ excerpt: best.n, quote: sentence }] } };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The stand-in as a stream: a short "thinking" pause with reasoning ticks (like a real reasoning model), then the JSON text in small
 * pieces. The pauses are long enough for the browser tests to see each stage, short enough to keep the suite quick.
 */
export const stubStream: StreamComplete = async (req, hooks) => {
  const { json, model } = await stubComplete(req);
  const text = JSON.stringify(json, null, 2);
  for (let i = 0; i < 3; i++) {
    hooks.onThinking?.();
    await sleep(110);
  }
  for (let i = 0; i < text.length; i += 14) {
    hooks.onContent?.(text.slice(i, i + 14));
    await sleep(22);
  }
  return { json: extractJson(text), model };
};
