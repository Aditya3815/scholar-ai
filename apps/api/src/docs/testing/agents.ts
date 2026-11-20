import type { Complete } from "../../platform/llm/port";

/**
 * Stand-ins for the Paper Reader's Critique and Note-taker (docs/agents.ts), used ONLY by tests and the local end-to-end run (QA_STUB=1 with ENABLE_DEV_ROUTES=1): the docs stand-in
 * (stub.ts) hands them the calls labelled `doc_critique` and `doc_notes`. Explain is a question to the stand-in (it quotes the sentence that best matches the selection).
 *
 *   Critique   a point on each of the first three passages, quoting the passage's first sentence exactly, and one point whose quote is invented (the check must drop it). A focus with
 *              "unanswerable" in it gets no point at all.
 *   Note-taker a bullet in its own words for every other highlight and the highlight itself (a quote) for the rest, and one bullet that names no highlight (the draft must drop it).
 */

const KINDS = ["thin_evidence", "missing_baseline", "overclaim", "limitation_stated", "limitation_unstated"] as const;

/** The excerpts of a prompt written by qa.ts buildPrompt: "[n] (page p) text", separated by "---". */
const excerptsOf = (user: string) =>
  [...user.matchAll(/\[(\d+)\] \((?:page \d+(?:, \w+)?|section: [^)]*)\) ([\s\S]*?)(?=\n---\n\[\d+\] \((?:page|section)|$)/g)].map((m) => ({ n: Number(m[1]), text: m[2]!.replace(/\n\s+Reader's note:[^\n]*/g, "").trim() }));

/** The first sentence of a passage with at least four words, cut to 190 characters at a word's end. */
function firstSentence(text: string): string {
  const sentences = text.match(/[^.!?]+[.!?]?/g)?.map((s) => s.trim()).filter((s) => s.split(/\s+/).length >= 4) ?? [];
  const s = sentences[0] ?? text;
  return s.length <= 190 ? s : s.slice(0, 190).replace(/\s+\S*$/, "");
}

export const stubCritique: Complete = async ({ user }) => {
  const focus = /^Question: (.*)$/m.exec(user)?.[1] ?? "";
  if (/unanswerable/i.test(focus)) return { model: "stub", json: { points: [] } };
  const ex = excerptsOf(user).slice(0, 3);
  const points = ex.map((e, i) => ({ kind: KINDS[i % KINDS.length], text: `The paper leans on this passage more than its evidence allows (point ${i + 1}).`, excerpt: e.n, quote: firstSentence(e.text) }));
  points.push({ kind: "overclaim", text: "An invented point whose quote is in no passage.", excerpt: 1, quote: "this sentence is not anywhere in the paper at all" });
  return { model: "stub", json: { points } };
};

export const stubNotes: Complete = async ({ user }) => {
  const hl = [...user.matchAll(/^\[(\d+)\] \(page \d+, \w+\) (.*)$/gm)].map((m) => ({ n: Number(m[1]), quote: m[2]! }));
  const bullets = hl.map((h) => (h.n % 2 === 1 ? { text: `In short: ${h.quote.split(/\s+/).slice(0, 8).join(" ")}`, from: [h.n], quote: false } : { text: "", from: [h.n], quote: true }));
  bullets.push({ text: "A bullet that names no highlight.", from: [], quote: false });
  return { model: "stub", json: { bullets } };
};
