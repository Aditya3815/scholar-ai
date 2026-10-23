// Cost research for scanned pages (docs/spikes/R5-cost.md): what does reading a page cost with other checking models and at lower resolution, and how far do the readings drift?
// Uses the same prompt, the same limits and the same comparison (packages/shared/src/ocr.ts) as the app. Needs the throwaway forwarding Worker on port 8799 (see r5-replay.mjs).
//
//   node scripts/r5-ocr.mjs <folder with page JPEGs> --models=scout,mistral,gemma4 [--scales=1,0.8,0.65,0.5]
//
// For every page and model: tokens, neurons, seconds, and the share of characters on which its reading differs from the reference reading (the first model at full size).
// Page pictures are never committed: keep the folder outside the repository.
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import sharp from "sharp";

const API = fileURLToPath(new URL("..", import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => a.slice(2).split("=")));
const dir = process.argv[2];
if (!dir || dir.startsWith("--")) throw new Error("usage: node scripts/r5-ocr.mjs <folder with page JPEGs> --models=scout,mistral,gemma4 [--scales=1,0.8,0.65,0.5]");
const PLAY = process.env.PLAYGROUND ?? "http://localhost:8799";
const MODELS = {
  scout: "@cf/meta/llama-4-scout-17b-16e-instruct",
  mistral: "@cf/mistralai/mistral-small-3.1-24b-instruct",
  gemma4: "@cf/google/gemma-4-26b-a4b-it",
};
const models = (args.models ?? "scout,mistral").split(",");
const scales = (args.scales ?? "1").split(",").map(Number);
const cache = join(process.env.R5_CACHE ?? join(tmpdir(), "r5-cache"), "ocr");
mkdirSync(cache, { recursive: true });

const tmp = mkdtempSync(join(tmpdir(), "r5ocr-"));
await build({ entryPoints: [join(API, "../../packages/shared/src/index.ts")], bundle: true, format: "esm", platform: "node", outfile: join(tmp, "shared.mjs"), logLevel: "silent" });
const shared = await import(pathToFileURL(join(tmp, "shared.mjs")).href);

async function read(model, jpeg, key) {
  const id = createHash("sha256").update(model + key + jpeg.length + (args.nothink ? "nothink" : "")).digest("hex").slice(0, 24);
  const file = join(cache, id + ".json");
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  const body = {
    messages: [{ role: "user", content: [{ type: "text", text: shared.OCR_PROMPT }, { type: "image_url", image_url: { url: "data:image/jpeg;base64," + jpeg.toString("base64") } }] }],
    max_tokens: shared.OCR_MAX_TOKENS,
    temperature: 0,
    // --nothink: ask a model that thinks by default (Gemma 4) not to
    ...(args.nothink ? { chat_template_kwargs: { enable_thinking: false } } : {}),
  };
  // R5_SPIKE=1: the forwarding Worker of the earlier spike (docs/spikes/R4-ocr/worker), which takes {model, image, maxTokens} and answers {text, usage}; it reads pages with
  // Llama 4 Scout where the generic forwarder was closed by the preview proxy (HTTP 499) in this research session.
  const res = process.env.R5_SPIKE
    ? await fetch(PLAY, { method: "POST", body: JSON.stringify({ model, image: body.messages[0].content[1].image_url.url, maxTokens: body.max_tokens }) }).then((r) => r.json()).then((j) => (j.ok ? { ok: true, ms: j.ms, out: { choices: [{ message: { content: j.text } }], usage: j.usage } } : j)).catch((e) => ({ ok: false, error: String(e) }))
    : await fetch(PLAY, { method: "POST", body: JSON.stringify({ model, body }) }).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e) }));
  const o = res.out;
  const out = res.ok
    ? { ok: true, ms: res.ms, text: o.choices?.[0]?.message?.content ?? (typeof o.response === "string" ? o.response : ""), tin: o.usage?.prompt_tokens ?? 0, tout: o.usage?.completion_tokens ?? 0, neurons: o.usage?.neurons ?? 0, cut: (o.usage?.completion_tokens ?? 0) >= shared.OCR_MAX_TOKENS }
    : { ok: false, error: String(res.error).slice(0, 160) };
  if (out.ok) writeFileSync(file, JSON.stringify(out));
  return out;
}

const files = readdirSync(dir).filter((f) => /\.jpe?g$/i.test(f)).sort();
const rows = [];
for (const f of files) {
  const original = readFileSync(join(dir, f));
  const meta = await sharp(original).metadata();
  let reference = null;
  for (const scale of scales) {
    const jpeg = scale === 1 ? original : await sharp(original).resize({ width: Math.round(meta.width * scale) }).jpeg({ quality: 80 }).toBuffer();
    for (const m of models) {
      const r = await read(MODELS[m] ?? m, jpeg, `${f}@${scale}`);
      if (!r.ok) { console.log(`${f.padEnd(18)} ${String(scale).padEnd(5)} ${m.padEnd(8)} ERROR ${r.error}`); continue; }
      const text = shared.cleanReading(r.text);
      if (!reference && scale === scales[0] && m === models[0]) reference = text;
      const differ = reference ? shared.disagreement(text, reference, 1) : 0;
      const price = { "@cf/meta/llama-4-scout-17b-16e-instruct": [0.27, 0.85], "@cf/mistralai/mistral-small-3.1-24b-instruct": [0.351, 0.555], "@cf/google/gemma-4-26b-a4b-it": [0.1, 0.3] }[MODELS[m] ?? m];
      const cents = price ? ((r.tin * price[0] + r.tout * price[1]) / 1e6) * 100 : null;
      rows.push({ page: f, scale, m, tin: r.tin, tout: r.tout, neurons: r.neurons, sec: r.ms / 1000, differ, cut: r.cut, loop: shared.looksLooping(text), chars: text.length, cents });
      console.log(`${f.padEnd(18)} x${String(scale).padEnd(5)} ${m.padEnd(8)} in ${String(r.tin).padStart(5)} out ${String(r.tout).padStart(5)}  ${r.neurons.toFixed(0).padStart(4)} neurons ${(r.ms / 1000).toFixed(0).padStart(3)}s  ${cents === null ? "" : cents.toFixed(3) + "c"}  differs ${(differ * 100).toFixed(1)}% from ${models[0]} at x${scales[0]}${r.cut ? "  CUT" : ""}${shared.looksLooping(text) ? "  LOOP" : ""}`);
    }
  }
}
console.log("\n=== mean per page ===");
for (const scale of scales) for (const m of models) {
  const g = rows.filter((r) => r.scale === scale && r.m === m && !r.cut && !r.loop);
  const all = rows.filter((r) => r.scale === scale && r.m === m);
  if (!all.length) continue;
  const mean = (k) => (g.length ? g.reduce((a, r) => a + r[k], 0) / g.length : NaN);
  console.log(`x${String(scale).padEnd(5)} ${m.padEnd(8)} pages ${all.length} (usable ${g.length})  in ${mean("tin").toFixed(0).padStart(5)} out ${mean("tout").toFixed(0).padStart(5)}  ${mean("neurons").toFixed(0).padStart(4)} neurons  ${mean("sec").toFixed(0).padStart(3)}s  ${mean("cents").toFixed(3)}c  differs ${(mean("differ") * 100).toFixed(1)}%`);
}
writeFileSync(join(cache, `summary-${Date.now()}.json`), JSON.stringify(rows, null, 1));
