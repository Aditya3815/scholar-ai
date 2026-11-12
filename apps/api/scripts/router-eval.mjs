// Quality check of the router of the prompt box (W3): does Auto pick the tool a person means, in English, Hindi (Devanagari) and Hinglish (Roman letters)?
// It uses the REAL model through the development-only route POST /api/v1/chat/route (no search is run), over the labelled messages of router-cases.mjs.
//
//   npx wrangler dev --port 8788 --local-upstream localhost:8788 --var GOOGLE_CLIENT_ID:dev --var GOOGLE_CLIENT_SECRET:dev-secret --var DEV_IDP_URL:http://localhost:9911 --var ENABLE_DEV_ROUTES:1
//
// (--local-upstream, or a copy of wrangler.jsonc without its "routes": with the custom domain of the production route, the worker builds the sign-in's redirect address for the live site, the fake sign-in
// never comes back to it, every account stays a visitor, no model reads anything, and a score is printed all the same. The script stops when the sign-in did not take.)
//   node scripts/router-eval.mjs [--gate] [--show] [--set=tuned|holdout|all]
//
// What it measures (the tool the person ends up with: a doubtful choice is already a search, as it is on the screen):
//   accuracy      overall, by language (English, Hinglish, Hindi), by group (plain, typo, mixed, safe), and the share of each tool that was found (recall)
//   language      the language the router reported is the language written
//   translated    for a Hindi or Hinglish search, the words sent to the indexes are English
//   safe          small talk and orders hidden in a message are a search, never another tool
// The list the router was tuned on is `tuned` (the default, and the one CI gates on); `holdout` is a list written after the tuning, run for an honest number (router-cases.mjs).
// With --gate it exits with 1 when a line is below its limit. With --show every wrong answer is listed. Each 20 messages use their own throwaway account, so the daily allowance does not stop a run.
//
//   node scripts/router-eval.mjs --followup [--set=tuned|holdout|holdout2|all] [--gate] [--show]     (the default set here is all, not tuned)
//
// The same, for a message that comes with the turns before it (docs/design/chat-actions-context.md, section 9): the labelled follow-ups of router-followup-cases.mjs, in English, Hindi and Hinglish
// (new search, refinement, the same papers, restyle, year filter, topic switch), sent as `{ message, history }` to the same development route, which then answers
// with `followUp` (what the server made of the model's reading) and `usage`. It prints the gates below and a table per class and per language. It spends the real model: about 1,500 tokens a message
// that needs the turns, so each 20 messages use their own throwaway account here too. The 203-message list above is NOT run by it, and must stay at its present result.
import { startFakeIdp } from "./fake-idp.mjs";
import { createClient } from "./test-client.mjs";
import { CASES as TUNED, GROUPS, HOLDOUT } from "@scholar/test-support/router-cases.mjs";

const APP = process.env.APP ?? "http://localhost:8788";
const gate = process.argv.includes("--gate");
// the follow-up list is gated on all of its cases unless a set is named: the tuned list alone has 4 language cases, 9 year cases and 12 topic switches, so one answer moves a gate
const set = process.argv.find((a) => a.startsWith("--set="))?.slice(6) ?? (process.argv.includes("--followup") ? "all" : "tuned");
const CASES = set === "holdout" ? HOLDOUT : set === "all" ? [...TUNED, ...HOLDOUT] : TUNED;
const show = process.argv.includes("--show") || gate;
const LIMITS = { overall: 0.9, en: 0.9, hinglish: 0.85, hi: 0.85, language: 0.9, translated: 0.9, safe: 0.9, recall: 0.8 };
// The limits of the follow-up list (--followup). Chosen BEFORE its first run, from what the first-turn list reaches and from what a wrong answer costs: a follow-up taken for "the same papers" answers
// from the wrong papers (so that rate is held low), a new topic that carries the old topic's words is a mixed search (bleed), a question the server throws away is a follow-up the model did not read.
// The first measured run may move a limit; the move and the reason are then written in docs/design, as for the first-turn list.
// `translated` is the limit of the first-turn list's own line: for a Hindi or Hinglish message that is searched for, the search words are English.
const FOLLOWUP_LIMITS = { intent: 0.85, intentHinglish: 0.8, intentHindi: 0.8, falseSamePapers: 0.05, valid: 0.9, content: 0.8, ask: 0.8, yearWords: 0.9, bleed: 0.05, years: 0.85, falseYear: 0.1, language: 0.9, translated: 0.9, tokens: 2200 };

if (process.argv.includes("--followup")) process.exit(await followUpMain());

const idp = await startFakeIdp(9911);
const clients = new Map();
const run = Date.now(); // a new set of accounts for every run: the allowance is counted per account (and an account is found by its e-mail address)
async function clientFor(i) {
  const k = Math.floor(i / 20);
  if (!clients.has(k)) {
    clients.set(k, (async () => {
      idp.setUser({ sub: `router-eval-${run}-${k}`, email: `routereval${run}x${k}@example.edu`, email_verified: true, name: "Router Eval" });
      const A = createClient(APP);
      await signedIn(A);
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

/**
 * A fake sign-in, and the privacy acknowledgement a person gives before the first use. If it did not take, every answer would be a visitor's (the rules only: no model is asked, the score is
 * meaningless): the run stops, saying so, instead of printing a plausible failing score.
 */
async function signedIn(A) {
  await A.follow(`${APP}/api/v1/auth/google/start`);
  const ack = await A.ack();
  if (!ack.ok) {
    console.error(`router eval: the fake sign-in did not take (privacy acknowledgement answered ${ack.status}): the answers would be a visitor's. Start the worker as the header of this script says (--local-upstream localhost:8788, or a wrangler config without "routes").`);
    process.exit(2);
  }
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

/* ---------------------------------------------------------------- --followup: a message with the turns before it */

/** Runs the labelled follow-ups through the development route and prints the gates and the tables. Returns the exit code (1 with --gate when a line is past its limit). */
async function followUpMain() {
  const { TUNED: FOLLOW_TUNED, HOLDOUT: FOLLOW_HOLDOUT, HOLDOUT2: FOLLOW_HOLDOUT2, CLASSES, LANGS } = await import("@scholar/test-support/router-followup-cases.mjs");
  const { scoreCase, formatReport } = await import("./lib/followup-score.mjs");
  const cases = set === "holdout" ? FOLLOW_HOLDOUT : set === "holdout2" ? FOLLOW_HOLDOUT2 : set === "all" ? [...FOLLOW_TUNED, ...FOLLOW_HOLDOUT, ...FOLLOW_HOLDOUT2] : FOLLOW_TUNED;
  const idp = await startFakeIdp(9911);
  const clients = new Map();
  const stamp = Date.now(); // a new set of accounts for every run: the allowance is counted per account
  const clientFor = (i) => {
    const k = Math.floor(i / 20);
    if (!clients.has(k)) {
      clients.set(k, (async () => {
        idp.setUser({ sub: `followup-eval-${stamp}-${k}`, email: `followupeval${stamp}x${k}@example.edu`, email_verified: true, name: "Follow-up Eval" });
        const A = createClient(APP);
        await signedIn(A);
        return A;
      })());
    }
    return clients.get(k);
  };
  async function ask(i) {
    const c = cases[i];
    const A = await clientFor(i);
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await A.send(`${APP}/api/v1/chat/route`, { method: "POST", headers: { Origin: APP, "Content-Type": "application/json" }, body: JSON.stringify({ message: c.message, history: c.history }) });
      if (res.ok) return await res.json();
      if (res.status === 429) await new Promise((r) => setTimeout(r, 5000));
      else throw new Error(`HTTP ${res.status} for: ${c.message.slice(0, 60)}`);
    }
    throw new Error(`rate limited: ${c.message.slice(0, 60)}`);
  }
  const out = new Array(cases.length);
  let next = 0;
  const started = Date.now();
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < cases.length) {
      const i = next++;
      out[i] = await ask(i).catch((e) => ({ error: String(e.message ?? e) }));
    }
  }));
  idp.close();

  const rows = cases.map((c, i) => scoreCase(c, out[i]));
  const report = formatReport({ rows, cases, limits: FOLLOWUP_LIMITS, classes: CLASSES, langs: LANGS, set, seconds: (Date.now() - started) / 1000, show });
  console.log(report.text);
  if (gate && report.failed.length > 0) {
    console.log(`\npast the limit: ${report.failed.join(", ")}`);
    return 1;
  }
  return 0;
}
