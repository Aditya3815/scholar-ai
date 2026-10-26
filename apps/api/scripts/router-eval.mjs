// Quality check of the router of the prompt box (W3): does Auto pick the tool a person means, in English, Hindi (Devanagari) and Hinglish (Roman letters)?
// It uses the REAL model through the development-only route POST /api/v1/chat/route (no search is run), over the labelled messages of router-cases.mjs.
//
//   npx wrangler dev --port 8788 --var GOOGLE_CLIENT_ID:dev --var GOOGLE_CLIENT_SECRET:dev-secret --var DEV_IDP_URL:http://localhost:9911 --var ENABLE_DEV_ROUTES:1
//   node scripts/router-eval.mjs [--gate] [--show] [--set=tuned|holdout|all]
//
// What it measures (the tool the person ends up with: a doubtful choice is already a search, as it is on the screen):
//   accuracy      overall, by language (English, Hinglish, Hindi), by group (plain, typo, mixed, safe), and the share of each tool that was found (recall)
//   language      the language the router reported is the language written
//   translated    for a Hindi or Hinglish search, the words sent to the indexes are English
//   safe          small talk and orders hidden in a message are a search, never another tool
// The list the router was tuned on is `tuned` (the default, and the one CI gates on); `holdout` is a list written after the tuning, run for an honest number (router-cases.mjs).
// With --gate it exits with 1 when a line is below its limit. With --show every wrong answer is listed. Each 20 messages use their own throwaway account, so the daily allowance does not stop a run.
import { startFakeIdp } from "./fake-idp.mjs";
import { createClient } from "./test-client.mjs";
import { CASES as TUNED, GROUPS, HOLDOUT } from "./router-cases.mjs";

const APP = process.env.APP ?? "http://localhost:8788";
const gate = process.argv.includes("--gate");
const set = process.argv.find((a) => a.startsWith("--set="))?.slice(6) ?? "tuned";
const CASES = set === "holdout" ? HOLDOUT : set === "all" ? [...TUNED, ...HOLDOUT] : TUNED;
const show = process.argv.includes("--show") || gate;
const LIMITS = { overall: 0.9, en: 0.9, hinglish: 0.85, hi: 0.85, language: 0.9, translated: 0.9, safe: 0.9, recall: 0.8 };

const idp = await startFakeIdp(9911);
const clients = new Map();
const run = Date.now(); // a new set of accounts for every run: the allowance is counted per account (and an account is found by its e-mail address)
async function clientFor(i) {
  const k = Math.floor(i / 20);
  if (!clients.has(k)) {
    clients.set(k, (async () => {
      idp.setUser({ sub: `router-eval-${run}-${k}`, email: `routereval${run}x${k}@example.edu`, email_verified: true, name: "Router Eval" });
      const A = createClient(APP);
      await A.follow(`${APP}/api/v1/auth/google/start`);
      await A.ack();
      return A;
    })());
  }
  return clients.get(k);
}

const asList = (m) => (Array.isArray(m) ? m : [m]);
const latinShare = (s) => {
  const letters = s.match(/\p{L}/gu) ?? [];
  return letters.length ? letters.filter((c) => /[A-Za-z]/.test(c)).length / letters.length : 1;
};

async function ask(i) {
  const [text] = CASES[i];
  const A = await clientFor(i);
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await A.send(`${APP}/api/v1/chat/route`, { method: "POST", headers: { Origin: APP, "Content-Type": "application/json" }, body: JSON.stringify({ message: text }) });
    if (res.ok) return await res.json();
    if (res.status === 429) await new Promise((r) => setTimeout(r, 5000));
    else throw new Error(`HTTP ${res.status} for: ${text.slice(0, 60)}`);
  }
  throw new Error("rate limited: " + text.slice(0, 60));
}

const out = new Array(CASES.length);
let next = 0;
const worker = async () => {
  while (next < CASES.length) {
    const i = next++;
    out[i] = await ask(i).catch((e) => ({ error: String(e.message ?? e) }));
  }
};
const started = Date.now();
await Promise.all(Array.from({ length: 4 }, worker));
idp.close();

const rows = CASES.map(([text, want, lang, group], i) => {
  const r = out[i];
  const mode = r?.mode ?? "error";
  return { text, want: asList(want), lang, group, got: mode, how: r?.how, confidence: r?.confidence, language: r?.language, searchQuery: r?.searchQuery, right: asList(want).includes(mode), error: r?.error };
});

const pct = (a, b) => (b === 0 ? 1 : a / b);
const share = (list) => pct(list.filter((r) => r.right).length, list.length);
const fmt = (x) => `${(x * 100).toFixed(1)}%`;
const lines = [];
const check = (name, value, limit, n) => lines.push({ name, value, limit, n, pass: value >= limit });

check("overall", share(rows), LIMITS.overall, rows.length);
for (const l of ["en", "hinglish", "hi"]) check(`${l}`, share(rows.filter((r) => r.lang === l)), LIMITS[l], rows.filter((r) => r.lang === l).length);
const judged = rows.filter((r) => !r.error);
check("language", pct(judged.filter((r) => r.language === r.lang).length, judged.length), LIMITS.language, judged.length);
const foreignSearch = rows.filter((r) => r.lang !== "en" && r.group !== "safe" && r.got === "search" && r.want.includes("search")); // small talk has no topic to translate
check("translated", pct(foreignSearch.filter((r) => r.searchQuery && latinShare(r.searchQuery) >= 0.9).length, foreignSearch.length), LIMITS.translated, foreignSearch.length);
check("safe", share(rows.filter((r) => r.group === "safe")), LIMITS.safe, rows.filter((r) => r.group === "safe").length);
for (const m of ["search", "verify", "idea", "paper"]) {
  const of = rows.filter((r) => r.want.length === 1 && r.want[0] === m);
  check(`found: ${m}`, share(of), LIMITS.recall, of.length);
}

console.log(`\nrouter eval: ${rows.length} messages in ${((Date.now() - started) / 1000).toFixed(0)} s (model share ${rows.filter((r) => r.how === "model").length}, rules ${rows.filter((r) => r.how === "rules").length}, fallback ${rows.filter((r) => r.how === "fallback").length}, errors ${rows.filter((r) => r.error).length})`);
for (const l of lines) console.log(`  ${l.pass ? "ok  " : "FAIL"} ${l.name.padEnd(16)} ${fmt(l.value).padStart(6)}  (limit ${fmt(l.limit)}, ${l.n} messages)`);
console.log("  by group: " + GROUPS.map((g) => `${g} ${fmt(share(rows.filter((r) => r.group === g)))}`).join(", "));
if (show) {
  const wrong = rows.filter((r) => !r.right);
  if (wrong.length) console.log(`\nwrong (${wrong.length}):`);
  for (const r of wrong) console.log(`  [${r.lang}/${r.group}] wanted ${r.want.join("|")}, got ${r.got}${r.how ? ` (${r.how}, ${r.confidence})` : ""}${r.error ? ` ERROR ${r.error}` : ""}: ${r.text.replace(/\s+/g, " ").slice(0, 90)}`);
}
if (show) {
  const untranslated = foreignSearch.filter((r) => !(r.searchQuery && latinShare(r.searchQuery) >= 0.9));
  if (untranslated.length) console.log(`
searched without English words (${untranslated.length}):`);
  for (const r of untranslated) console.log(`  [${r.lang}] ${r.searchQuery ? `got "${r.searchQuery}"` : "no query"} for: ${r.text.slice(0, 80)}`);
  const badLang = rows.filter((r) => !r.error && r.language !== r.lang);
  if (badLang.length) console.log(`
language read wrongly (${badLang.length}):`);
  for (const r of badLang) console.log(`  [${r.lang}] read as ${r.language}: ${r.text.slice(0, 80)}`);
}
const failed = lines.filter((l) => !l.pass);
if (gate && failed.length) {
  console.log(`\nbelow the limit: ${failed.map((l) => l.name).join(", ")}`);
  process.exit(1);
}
