// The Paper Reader's agents (docs/design/paper-reader.md, 9.3, 16 and 23): Explain, Critique and the Note-taker, run through their real pipelines (docs/agents.ts: the passages chosen, the prompt,
// the checks) on a made-up paper (data/reader-agents-cases.json), with the model's replies RECORDED (data/reader-agents-recorded.json.gz) and replayed here, so `npm run eval` (and CI) checks the
// gates offline:
//   npm run eval                                       replay (CI): fails if a prompt has no recording (re-seed after any change to a prompt, the passages chosen or the cases)
//   READER_AGENTS_SEED=1 npx vitest run -c vitest.eval.config.ts eval/reader-agents.eval.ts
//                                                      write the recording again from the replies in the cases file (each quote's excerpt number found in the prompt it answers)
//   delete the recording, then EVAL_MODE=record npx vitest run -c vitest.eval.config.ts eval/reader-agents.eval.ts
//                                                      record what live Workers AI answers instead (wrangler's own login; see eval/lib/model-layer.ts)
// The recording kept in git was SEEDED from the hand-written replies of the cases file (their note says what they hold), not recorded live: the gates are about our checks, which must hold
// whatever the model writes. The gates:
//   Explain     every citation of every answer has a quote found in the passage it names; a quote that is not in the paper never becomes a citation, and its mark is gone; an answer
//               called verified cites at least one page.
//   Critique    every point shown has a quote found in the paper on the page it gives, and a kind of the list; a point whose quote is not in the paper NEVER survives.
//   Note-taker  every highlight's page is in the draft; every bullet in its own words ends with the pages of its highlights; every quote block is one of the highlights.
import { afterAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { CRITIQUE_KINDS, draftPages, type Answer, type Critique, type DocNote, type Legend, type NotesDraft } from "@scholar/shared";
import { critique, draftNotes, explain } from "../src/docs/agents";
import { quoteInText, type StoredChunk } from "../src/docs/qa";
import { hashEmbedder } from "../src/docs/testing/embed";
import type { Complete, ModelRequest } from "../src/platform/llm/port";
import { DEFAULT_CONFIG } from "../src/platform/llm/config";
import { createGateway } from "../src/platform/llm/gateway";
import { workersAiProvider } from "../src/platform/llm/providers/workersai";
import { ModelLayer, type ModelCall } from "./lib/model-layer";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const FILE = HERE + "data/reader-agents-recorded.json.gz";
/** The model the agents use (the private `qa` chain, as a question about a paper). */
const MODEL = DEFAULT_CONFIG.routes.qa!.private[0]!.model;

type Evidence = { quote: string; invented?: boolean; wrongExcerpt?: boolean };
type CritiqueReply = { points: (Evidence & { kind: string; text: string })[] };
type Cases = {
  paper: { page: number; text: string }[];
  explain: { id: string; selection: string; page: number | null; idea: string; reply: { found: boolean; answer: string; evidence: Evidence[] } }[];
  critique: { id: string; focus: string; reply: CritiqueReply }[];
  notes: { id: string; legend: Legend; highlights: { id: string; page: number; color: DocNote["color"]; quote: string; note: string }[]; reply: unknown }[];
};
const cases = JSON.parse(readFileSync(HERE + "data/reader-agents-cases.json", "utf8")) as Cases;
const chunks: StoredChunk[] = cases.paper.map((p, idx) => ({ idx, page: p.page, text: p.text, embedding: null }));
const SEED = process.env.READER_AGENTS_SEED === "1";
const meta = { id: "eval", createdAt: 0 };

/** The excerpts of a prompt (qa.ts buildPrompt), numbered. */
const excerptsOf = (user: string) => [...user.matchAll(/^\[(\d+)\] \(page \d+\) (.*)$/gm)].map((m) => ({ n: Number(m[1]), text: m[2]! }));
/** The excerpt a quote is in (as the model should name it), a wrong one when the case says so, or 1 for a quote that is in none. */
function excerptFor(e: Evidence, user: string): number {
  const ex = excerptsOf(user);
  const at = ex.find((x) => quoteInText(e.quote, x.text))?.n;
  if (at === undefined) return 1;
  return e.wrongExcerpt ? (ex.find((x) => x.n !== at)?.n ?? at) : at;
}

/** The seeded reply to a request: the case's reply with each quote's excerpt number found in the prompt. */
function seedReply(id: string, req: ModelRequest): unknown {
  const ex = cases.explain.find((c) => c.id === id);
  if (ex) {
    const nums = ex.reply.evidence.map((e) => excerptFor(e, req.user));
    // the answer's marks [i] name the i-th evidence: written as the excerpt it is in
    const answer = ex.reply.answer.replace(/\[(\d)\]/g, (_, i: string) => `[${nums[Number(i) - 1] ?? 1}]`);
    return { found: ex.reply.found, answer, evidence: ex.reply.evidence.map((e, i) => ({ excerpt: nums[i], quote: e.quote })) };
  }
  const cr = cases.critique.find((c) => c.id === id);
  if (cr) return { points: cr.reply.points.map((p) => ({ kind: p.kind, text: p.text, excerpt: excerptFor(p, req.user), quote: p.quote })) };
  return cases.notes.find((c) => c.id === id)!.reply;
}

const NOTE = "SEEDED from the hand-written replies of data/reader-agents-cases.json (READER_AGENTS_SEED=1), not recorded live; delete it and record with EVAL_MODE=record to ask Workers AI.";
// seeding writes the recording afresh: an empty one first, so the layer can open
if (SEED && !existsSync(FILE)) writeFileSync(FILE, gzipSync(JSON.stringify({ version: 1, recordedAt: "", model: MODEL, note: NOTE, calls: {} })));
const layer = new ModelLayer({
  file: FILE,
  layout: { kind: "flat", model: MODEL },
  note: NOTE,
  ask: (ai) => {
    const gateway = createGateway({ providers: { workersai: workersAiProvider(ai) }, ledger: { tokensToday: async () => 0, record: async () => {} }, config: DEFAULT_CONFIG });
    return async (_model, req, hooks) => {
      const r = await gateway.stream({ task: "qa", sensitivity: "private", subject: "eval", system: req.system, user: req.user, schema: req.schema, maxTokens: req.maxTokens, timeoutMs: 120_000, label: req.label }, hooks ?? {});
      return { json: r.json };
    };
  },
});
const seeded: Record<string, ModelCall> = {};
const replay = layer.session(MODEL);
/** The model of one case: the recording, or while seeding the case's own reply (kept for the recording). */
const modelFor = (id: string): Complete => async (req) => {
  if (!SEED) return replay(req);
  const json = seedReply(id, req);
  seeded[layer.keyOf(MODEL, req.system, req.user)] = { ok: true, json, ms: 0 };
  return { json, model: MODEL };
};

/** Is this quote in the paper, on this page? Checked here again, apart from the agents' own check. */
const onPage = (quote: string, page: number) => quoteInText(quote, chunks.filter((c) => c.page === page).map((c) => c.text).join(" "));
const inPaper = (quote: string) => chunks.some((c) => quoteInText(quote, c.text));

const rows: string[] = [];
afterAll(async () => {
  if (SEED) writeFileSync(FILE, gzipSync(JSON.stringify({ version: 1, recordedAt: new Date().toISOString(), model: MODEL, note: NOTE, calls: seeded })));
  await layer.close();
  console.log(["", "Paper Reader agents (recorded replies):", ...rows].join("\n"));
  if (layer.missing.size) console.log(`missing recordings: ${layer.missing.size}`);
});

describe("Explain: every citation has a checked quote, and an invented one never survives", () => {
  for (const c of cases.explain) {
    it(c.id, async () => {
      const a: Answer = await explain({ ask: { selection: c.selection, page: c.page, idea: c.idea }, chunks, embed: hashEmbedder, complete: modelFor(c.id), meta });
      for (const cite of a.citations) {
        expect(onPage(cite.quote, cite.page), `${c.id}: "${cite.quote}" on p. ${cite.page}`).toBe(true);
      }
      const invented = c.reply.evidence.filter((e) => e.invented).map((e) => e.quote);
      for (const q of invented) expect(a.citations.some((x) => x.quote === q), `${c.id}: an invented quote survived`).toBe(false);
      // a mark left in the answer names a citation that checked out
      for (const m of a.answer.matchAll(/\[(\d{1,2})\]/g)) expect(a.citations.some((x) => x.n === Number(m[1])), `${c.id}: mark [${m[1]}] without a citation`).toBe(true);
      if (a.verified && a.found) expect(a.citations.length, `${c.id}: verified, yet cites no page`).toBeGreaterThan(0);
      if (c.reply.found && invented.length === c.reply.evidence.length) expect(a.verified, `${c.id}: nothing checked, yet verified`).toBe(false);
      rows.push(`  explain   ${c.id.padEnd(36)} found=${a.found} verified=${a.verified} citations=${a.citations.length} (model gave ${c.reply.evidence.length}, ${invented.length} invented)`);
    });
  }
});

describe("Critique: every point shown has a checked quote; a point without one never survives", () => {
  for (const c of cases.critique) {
    it(c.id, async () => {
      const r: Critique = await critique({ focus: c.focus, chunks, embed: hashEmbedder, complete: modelFor(c.id), meta });
      for (const p of r.points) {
        expect(onPage(p.quote, p.page), `${c.id}: "${p.quote}" on p. ${p.page}`).toBe(true);
        expect(CRITIQUE_KINDS).toContain(p.kind);
        expect(p.text.length).toBeGreaterThan(2);
      }
      for (const w of c.reply.points.filter((x) => x.invented || !inPaper(x.quote))) expect(r.points.some((p) => p.quote === w.quote), `${c.id}: "${w.quote}" is not in the paper, yet it survived`).toBe(false);
      for (const w of c.reply.points.filter((x) => !(CRITIQUE_KINDS as readonly string[]).includes(x.kind))) expect(r.points.some((p) => p.quote === w.quote), `${c.id}: a kind outside the list survived`).toBe(false);
      expect(r.points.length + r.dropped).toBe(c.reply.points.length);
      rows.push(`  critique  ${c.id.padEnd(36)} shown=${r.points.length} dropped=${r.dropped} (model gave ${c.reply.points.length}, ${c.reply.points.filter((x) => x.invented).length} invented)`);
    });
  }
});

describe("Note-taker: the draft keeps every page of the highlights", () => {
  for (const c of cases.notes) {
    it(c.id, async () => {
      const notes: DocNote[] = c.highlights.map((h) => ({ ...h, createdAt: 0, updatedAt: 0 }));
      let n = 0;
      const r: { draft: NotesDraft; dropped: number } = await draftNotes({ notes, legend: c.legend, complete: modelFor(c.id), newId: () => `b${++n}` });
      expect(draftPages(r.draft)).toEqual([...new Set(c.highlights.map((h) => h.page))].sort((a, b) => a - b));
      const pages = new Set(c.highlights.map((h) => h.page));
      for (const b of r.draft.blocks) {
        if (b.kind === "quote") {
          expect(c.highlights.some((h) => h.id === b.noteId && h.page === b.page), `${c.id}: a quote that is not a highlight`).toBe(true);
          continue;
        }
        for (const line of b.md.split("\n")) {
          if (line.startsWith("## ")) continue;
          const m = /^- .+ \(p\. ([\d, ]+)\)$/.exec(line);
          expect(m, `${c.id}: a bullet without its pages: ${line}`).not.toBeNull();
          for (const p of m![1]!.split(",")) expect(pages.has(Number(p.trim())), `${c.id}: p. ${p} is not a page of the highlights`).toBe(true);
        }
      }
      rows.push(`  notes     ${c.id.padEnd(36)} blocks=${r.draft.blocks.length} pages=${draftPages(r.draft).join(",")} dropped=${r.dropped}`);
    });
  }
});
