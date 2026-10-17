// Spike R2: grounded paper Q&A quality across LLMs. Deterministic scoring (no LLM judge).
//
//   node scripts/r2/run.mjs --papers <dir with attention.txt milk.txt ...> --models wai:@cf/openai/gpt-oss-120b,gemini:gemini-3.5-flash-lite
//   node scripts/r2/run.mjs --papers <dir> --retrieval-only          (BM25 vs bge-m3 vs hybrid recall, no LLM calls)
//
// Env: CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID (Workers AI REST), GEMINI_API_KEY.
// Every model call and embedding is cached on disk (scripts/r2/.cache) so reruns do not spend free quota.
// PRIVACY: only public arXiv papers go to Gemini here. Never run user manuscripts through unpaid Gemini.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, ".cache");
const RESULTS = path.join(HERE, "results");
mkdirSync(CACHE, { recursive: true });
mkdirSync(RESULTS, { recursive: true });

const args = {};
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const next = argv[i + 1];
    args[argv[i].slice(2)] = next === undefined || next.startsWith("--") ? true : next;
  }
}
const PAPERS_DIR = args.papers;
if (!PAPERS_DIR) throw new Error("--papers <dir> required");
const K = Number(args.k ?? 6);
const ACCT = process.env.CLOUDFLARE_ACCOUNT_ID;
const CF = process.env.CLOUDFLARE_API_TOKEN;
const GEM = process.env.GEMINI_API_KEY;

const data = JSON.parse(readFileSync(path.join(HERE, "questions.json"), "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- text utils ---------- */
const norm = (s) => s.normalize("NFKC").toLowerCase().replace(/[‐-―]/g, "-").replace(/\s+/g, " ").trim();
const tokens = (s) => norm(s).match(/[a-z0-9]+/g) ?? [];

/* ---------- chunking (section-aware chunking arrives with GROBID; here fixed windows) ---------- */
function chunkPaper(name, text, size = 220, overlap = 40) {
  const words = [];
  let page = 1;
  let expectPage = false;
  for (const tok of text.split(/\s+/)) {
    if (tok === "[[page") { expectPage = true; continue; }
    if (expectPage) {
      const pm = tok.match(/^(\d+)\]\]$/);
      expectPage = false;
      if (pm) { page = Number(pm[1]); continue; }
    }
    if (tok) words.push({ w: tok, page });
  }
  const chunks = [];
  for (let i = 0; i < words.length; i += size - overlap) {
    const slice = words.slice(i, i + size);
    if (slice.length < 30) break;
    chunks.push({ id: `${name}#${chunks.length}`, paper: name, page: slice[0].page, text: slice.map((x) => x.w).join(" ") });
  }
  return chunks;
}

const chunks = [];
for (const name of Object.keys(data.papers)) {
  const file = path.join(PAPERS_DIR, `${name}.txt`);
  chunks.push(...chunkPaper(name, readFileSync(file, "utf8")));
}
console.log(`chunks: ${chunks.length} across ${Object.keys(data.papers).length} papers`);

/* ---------- BM25 ---------- */
function buildBm25(list) {
  const docs = list.map((c) => tokens(c.text));
  const df = new Map();
  docs.forEach((d) => new Set(d).forEach((t) => df.set(t, (df.get(t) ?? 0) + 1)));
  const avg = docs.reduce((a, d) => a + d.length, 0) / docs.length;
  return (query) => {
    const q = tokens(query);
    return docs.map((d, i) => {
      const tf = new Map();
      d.forEach((t) => tf.set(t, (tf.get(t) ?? 0) + 1));
      let s = 0;
      for (const t of new Set(q)) {
        const f = tf.get(t);
        if (!f) continue;
        const idf = Math.log(1 + (docs.length - df.get(t) + 0.5) / (df.get(t) + 0.5));
        s += (idf * f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (d.length / avg)));
      }
      return { i, s };
    });
  };
}

/* ---------- disk cache ---------- */
function cached(file, key, fn) {
  const p = path.join(CACHE, file);
  const store = existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {};
  return async () => {
    if (store[key] !== undefined) return { value: store[key], hit: true };
    const value = await fn();
    const fresh = existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {};
    fresh[key] = value;
    writeFileSync(p, JSON.stringify(fresh));
    return { value, hit: false };
  };
}

/* ---------- Workers AI ---------- */
async function wai(model, body) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCT}/ai/run/${model}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${CF}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    const msg = json.errors?.map((e) => `${e.code}:${e.message}`).join("; ") ?? `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return json.result;
}

async function embed(texts) {
  const out = [];
  for (let i = 0; i < texts.length; i += 50) {
    const r = await wai("@cf/baai/bge-m3", { text: texts.slice(i, i + 50) });
    out.push(...r.data);
  }
  return out;
}

const cosine = (a, b) => {
  let d = 0, x = 0, y = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; }
  return d / (Math.sqrt(x) * Math.sqrt(y));
};

/* ---------- retrieval ---------- */
const chunkVecs = await (async () => {
  const getter = cached("embeddings.json", `chunks:${chunks.length}:${chunks.map((c) => c.text.length).reduce((a, b) => a + b, 0)}`, () => embed(chunks.map((c) => c.text)));
  const { value, hit } = await getter();
  console.log(`chunk embeddings (bge-m3): ${hit ? "cache" : "computed"}`);
  return value;
})();

const bm25Cache = new Map();
function rank(paper, query, qvec, method) {
  const idxs = chunks.map((c, i) => (c.paper === paper ? i : -1)).filter((i) => i >= 0);
  if (!bm25Cache.has(paper)) bm25Cache.set(paper, buildBm25(idxs.map((i) => chunks[i])));
  const bm = bm25Cache.get(paper)(query).map((r, j) => ({ idx: idxs[j], s: r.s }));
  const dn = idxs.map((i) => ({ idx: i, s: cosine(qvec, chunkVecs[i]) }));
  const order = (arr) => [...arr].sort((a, b) => b.s - a.s).map((x) => x.idx);
  if (method === "bm25") return order(bm).slice(0, K);
  if (method === "dense") return order(dn).slice(0, K);
  const score = new Map();
  [order(bm), order(dn)].forEach((list) => list.forEach((idx, r) => score.set(idx, (score.get(idx) ?? 0) + 1 / (60 + r + 1))));
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([idx]) => idx).slice(0, K);
}

const qVecs = await (async () => {
  const getter = cached("embeddings.json", `questions:${data.questions.length}:${data.questions.map((q) => q.q.length).join(",")}`, () => embed(data.questions.map((q) => q.q)));
  const { value } = await getter();
  return value;
})();

function retrievalReport() {
  const rows = [];
  for (const method of ["bm25", "dense", "hybrid"]) {
    let hit = 0, n = 0, hiHit = 0, hiN = 0;
    data.questions.forEach((q, qi) => {
      if (!q.answerable) return;
      const top = rank(q.paper, q.q, qVecs[qi], method);
      const ok = top.some((idx) => new RegExp(q.evidence, "i").test(chunks[idx].text.replace(/\s+/g, " ")));
      n++; hit += ok;
      if (q.lang === "hi") { hiN++; hiHit += ok; }
    });
    rows.push({ method, [`recall@${K}`]: `${hit}/${n} (${((hit / n) * 100).toFixed(0)}%)`, hindi: `${hiHit}/${hiN}` });
  }
  console.table(rows);
}
retrievalReport();
if (args["retrieval-only"]) process.exit(0);

/* ---------- prompt ---------- */
const SYSTEM = `You answer questions about a scientific paper using ONLY the numbered passages provided.
Reply with one JSON object and nothing else (no markdown fences):
{"answerable": boolean, "answer": string, "citations": [{"passage": number, "quote": string}]}
Rules:
- "quote" must be copied exactly, character for character, from the cited passage (at most 40 words).
- Give at least one citation whenever answerable is true.
- If the passages do not contain the answer, set "answerable": false, "answer": "The paper does not say this.", "citations": [].
- Answer in the same language as the question. Never use knowledge from outside the passages.`;

const userMsg = (q, ctx) => `Passages:\n${ctx.map((c, i) => `[${i + 1}] ${c.text}`).join("\n\n")}\n\nQuestion: ${q}`;

/* ---------- model callers ---------- */
function extractText(r) {
  if (typeof r?.response === "string") return r.response;
  if (r?.choices?.[0]?.message?.content) return r.choices[0].message.content;
  if (Array.isArray(r?.output)) {
    const msg = r.output.find((o) => o.type === "message");
    const t = msg?.content?.map((c) => c.text).filter(Boolean).join("") ?? "";
    if (t) return t;
  }
  if (typeof r === "string") return r;
  return "";
}

const QA_SCHEMA = {
  type: "object",
  properties: {
    answerable: { type: "boolean" },
    answer: { type: "string" },
    citations: { type: "array", items: { type: "object", properties: { passage: { type: "integer" }, quote: { type: "string" } }, required: ["passage", "quote"] } },
  },
  required: ["answerable", "answer", "citations"],
};

/** model spec "name#schema" = response_format json_schema (structured output enforced by the platform). */
async function callWai(modelSpec, system, user) {
  const [model, mode] = modelSpec.split("#");
  const base = { max_tokens: 1500, temperature: 0 };
  const msgs = [{ role: "system", content: system }, { role: "user", content: user }];
  let body;
  if (mode === "schema") {
    body = { messages: msgs, ...base, response_format: { type: "json_schema", json_schema: { name: "qa", schema: QA_SCHEMA } } };
    if (model.includes("gpt-oss")) body.reasoning = { effort: "low" };
  } else if (model.includes("gpt-oss")) {
    body = { instructions: system, input: user, max_output_tokens: 1800, reasoning: { effort: "low" } };
  } else {
    body = { messages: msgs, ...base };
  }
  const r = await wai(model, body);
  const usage = r?.usage ?? {};
  return { text: extractText(r), tokensIn: usage.prompt_tokens ?? usage.input_tokens ?? null, tokensOut: usage.completion_tokens ?? usage.output_tokens ?? null, raw: r };
}

async function callGemini(model, system, user) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": GEM, "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json", maxOutputTokens: 2048 },
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(j.error?.message ?? `HTTP ${res.status}`); e.status = res.status; throw e; }
  const text = (j.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
  return { text, tokensIn: j.usageMetadata?.promptTokenCount ?? null, tokensOut: j.usageMetadata?.candidatesTokenCount ?? null };
}

/* ---------- scoring ---------- */
function parseAnswer(text) {
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try {
    const o = JSON.parse(text.slice(s, e + 1));
    if (typeof o.answerable !== "boolean") return null;
    return { answerable: o.answerable, answer: String(o.answer ?? ""), citations: Array.isArray(o.citations) ? o.citations : [] };
  } catch { return null; }
}

function score(q, parsed, ctx) {
  if (!parsed) return { parseFail: true };
  const answerText = norm(parsed.answer);
  const cites = parsed.citations.filter((c) => c && typeof c.quote === "string");
  // Quote check: "..." / "[...]" se todo, har fragment ko cited passage mein dhoondo. Spacing, hyphen aur
  // punctuation ka farq ignore (PDF text mein hota hai), par words aur unka order paper ke hi hone chahiye.
  const alnum = (s) => norm(s).replace(/[^a-z0-9ऀ-ॿ]+/g, "");
  const quotesOk = cites.length > 0 && cites.every((c) => {
    const p = ctx[Number(c.passage) - 1];
    if (!p) return false;
    const hay = alnum(p.text);
    const frags = c.quote.split(/\[\s*\.\.\.\s*\]|\.\.\.|…/).map(alnum).filter((f) => f.length >= 12);
    return frags.length > 0 && frags.every((f) => hay.includes(f));
  });
  if (q.answerable) {
    const correct = parsed.answerable && q.must.every((m) => new RegExp(m, "i").test(answerText));
    return { correct, falseRefusal: !parsed.answerable, quotesOk, grounded: correct && quotesOk };
  }
  return { correctRefusal: !parsed.answerable, hallucinated: parsed.answerable };
}

const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] : 0; };

async function evalModel(spec) {
  const [provider, ...rest] = spec.split(":");
  const model = rest.join(":");
  const call = provider === "wai" ? callWai : callGemini;
  if (provider === "wai" && (!ACCT || !CF)) throw new Error("CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN missing");
  if (provider === "gemini" && !GEM) throw new Error("GEMINI_API_KEY missing");
  const rows = [];
  let stopped = null;

  for (let qi = 0; qi < data.questions.length; qi++) {
    const q = data.questions[qi];
    const top = rank(q.paper, q.q, qVecs[qi], "hybrid");
    const ctx = top.map((idx) => chunks[idx]);
    const getter = cached(`calls-${spec.replace(/[^a-z0-9.-]/gi, "_")}.json`, q.id, async () => {
      for (let attempt = 0; ; attempt++) {
        const t0 = Date.now();
        try {
          const r = await call(model, SYSTEM, userMsg(q.q, ctx));
          return { ...r, ms: Date.now() - t0, raw: undefined };
        } catch (err) {
          const quota = /exceed|quota|limit|daily|neuron|insufficient/i.test(err.message);
          if (attempt < 3 && !quota && (err.status === 429 || err.status >= 500)) { await sleep(2500 * (attempt + 1)); continue; }
          return { error: err.message, status: err.status, quota, ms: Date.now() - t0 };
        }
      }
    });
    const { value: r, hit } = await getter();
    if (r.error) {
      rows.push({ q, error: r.error });
      if (r.quota) { stopped = r.error; console.log(`  ${spec}: quota/limit hit at ${q.id}: ${r.error}`); break; }
      continue;
    }
    const parsed = parseAnswer(r.text);
    rows.push({ q, ms: r.ms, tokensIn: r.tokensIn, tokensOut: r.tokensOut, parsed, rawText: parsed ? undefined : r.text?.slice(0, 300), s: score(q, parsed, ctx) });
    if (!hit) await sleep(provider === "gemini" ? 1500 : 300);
  }

  const done = rows.filter((x) => x.s);
  const ans = done.filter((x) => x.q.answerable), unans = done.filter((x) => !x.q.answerable);
  const hi = ans.filter((x) => x.q.lang === "hi");
  const total = { ans: data.questions.filter((q) => q.answerable).length, unans: data.questions.filter((q) => !q.answerable).length };
  const f = (n, d) => `${n}/${d} (${d ? ((n / d) * 100).toFixed(0) : 0}%)`;
  const summary = {
    model: spec,
    answered: `${done.length}/${data.questions.length}`,
    grounded_correct: f(ans.filter((x) => x.s.grounded).length, total.ans),
    answer_correct: f(ans.filter((x) => x.s.correct).length, total.ans),
    false_refusal: f(ans.filter((x) => x.s.falseRefusal).length, total.ans),
    quotes_verbatim: f(ans.filter((x) => x.s.quotesOk).length, total.ans),
    correct_refusal: f(unans.filter((x) => x.s.correctRefusal).length, total.unans),
    hallucinated: unans.filter((x) => x.s.hallucinated).length,
    hindi_correct: f(hi.filter((x) => x.s.correct).length, data.questions.filter((q) => q.answerable && q.lang === "hi").length),
    json_fail: rows.filter((x) => x.s?.parseFail).length,
    errors: rows.filter((x) => x.error).length,
    p50_ms: pct(done.map((x) => x.ms), 50),
    p95_ms: pct(done.map((x) => x.ms), 95),
    avg_tokens_in: Math.round(done.reduce((a, x) => a + (x.tokensIn ?? 0), 0) / Math.max(1, done.length)),
    avg_tokens_out: Math.round(done.reduce((a, x) => a + (x.tokensOut ?? 0), 0) / Math.max(1, done.length)),
    stopped,
  };
  writeFileSync(path.join(RESULTS, `${spec.replace(/[^a-z0-9.-]/gi, "_")}.json`), JSON.stringify({ summary, rows: rows.map((r) => ({ id: r.q.id, ...r, q: undefined })) }, null, 1));
  return { summary, rows };
}

const models = String(args.models ?? "").split(",").filter(Boolean);
const summaries = [];
for (const spec of models) {
  console.log(`\n>>> ${spec}`);
  try {
    const { summary, rows } = await evalModel(spec);
    summaries.push(summary);
    console.log(summary);
    const misses = rows.filter((x) => x.s && ((x.q.answerable && !x.s.grounded) || (!x.q.answerable && !x.s.correctRefusal)));
    for (const m of misses.slice(0, 12)) console.log(`   miss ${m.q.id}: ${m.q.answerable ? (m.s.falseRefusal ? "false refusal" : m.s.correct ? "quote not verbatim" : "wrong answer") : "hallucinated"} | ${(m.parsed?.answer ?? "").slice(0, 110).replace(/\s+/g, " ")}`);
    for (const m of rows.filter((x) => x.error).slice(0, 3)) console.log(`   error ${m.q.id}: ${m.error}`);
  } catch (e) {
    console.log(`  ${spec} failed: ${e.message}`);
  }
}
if (summaries.length > 1) console.table(summaries.map(({ model, grounded_correct, answer_correct, quotes_verbatim, correct_refusal, hallucinated, hindi_correct, json_fail, errors, p50_ms, p95_ms }) => ({ model, grounded_correct, answer_correct, quotes_verbatim, correct_refusal, hallucinated, hindi_correct, json_fail, errors, p50_ms, p95_ms })));
