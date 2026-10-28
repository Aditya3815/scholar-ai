// Quality check of the support judge (docs/design/claim-support.md) with the REAL model, over hand-labelled claims (scripts/fixtures/support-gold.json), through the development-only
// route POST /api/v1/chat/judge. Needs a Worker started WITHOUT QA_STUB, with a Workers AI login:
//   npx wrangler dev --port 8788 --var GOOGLE_CLIENT_ID:dev --var GOOGLE_CLIENT_SECRET:dev-secret --var DEV_IDP_URL:http://localhost:9911 --var ENABLE_DEV_ROUTES:1
//   node scripts/support-eval.mjs [--strict] [--show-shorter] [--split=dev|test|all] [--model=@cf/...] [--reasoning=low|medium|high] [--gate] [--dump=file.json] [--cases=r01,s02] [--concurrency=3]
//
// What it measures, per claim, against the label a person gave it (yes: stated; partial: main point supported but something added; no: not supported; framing: no finding of its own):
//   caught       claims labelled `no` that the judge also says `no` (the point of the judge)
//   false accept claims labelled `no` that the judge calls yes or partial: the failure that matters most
//   kept         claims labelled `yes` that the judge keeps (yes or partial)
//   false drop   claims labelled `yes` that the judge says `no` to (a good claim lost)
//   partials     what the judge does with claims labelled `partial` (informational: a person could go either way)
//   evidence     of the claims it keeps, how many it backs with a sentence the person also named
//   per-mark     for a claim that cites several papers, one of which does not support it: does the judge leave that paper out?
//   usable       claims the judge answered in a form the server could use, and the time of a call
// With --gate it exits with 1 when a line is under its limit (the limits are the ones measured and decided in the design note).
import { readFileSync, writeFileSync } from "node:fs";
import { startFakeIdp } from "./fake-idp.mjs";
import { createClient } from "./test-client.mjs";

const APP = process.env.APP ?? "http://localhost:8788";
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const gate = process.argv.includes("--gate");
const split = arg("split") ?? "all";
const model = arg("model");
const reasoning = arg("reasoning");
const only = arg("cases")?.split(",");
const concurrency = Number(arg("concurrency") ?? 3);
const dump = arg("dump");
const gold = JSON.parse(readFileSync(new URL("./fixtures/support-gold.json", import.meta.url), "utf8"));
const cases = gold.cases.filter((c) => (split === "all" || c.split === split) && (!only || only.includes(c.id)));

const idp = await startFakeIdp(9911);
let n = 0;
// accounts are matched by e-mail: a name used in an earlier run would bring that run's tokens of the day with it
const run = Date.now().toString(36);
// the fake identity provider answers as the user that was set last, so each sign-in must finish before the next user is set
let signIn = Promise.resolve();
async function newClient() {
  const turn = signIn.then(async () => {
    idp.setUser({ sub: `support-eval-${run}-${n++}`, email: `supporteval-${run}-${n}@example.edu`, email_verified: true, name: "Support Eval" });
    const A = createClient(APP);
    await A.follow(`${APP}/api/v1/auth/google/start`);
    await A.ack();
    return A;
  });
  signIn = turn.catch(() => {});
  return turn;
}
async function judge(c) {
  const A = await newClient();
  const t0 = Date.now();
  const res = await A.send(`${APP}/api/v1/chat/judge`, { method: "POST", headers: { Origin: APP, "Content-Type": "application/json" }, body: JSON.stringify({ text: c.text, papers: c.papers, model, reasoning, timeoutMs: Number(arg("timeout") ?? 0) || undefined, strict: process.argv.includes("--strict"), recheck: arg("recheck") }) });
  const body = res.ok ? await res.json() : { error: `${res.status} ${(await res.text()).slice(0, 200)}` };
  return { ...body, wall: Date.now() - t0 };
}

const out = [];
const queue = [...cases];
await Promise.all(
  Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (queue.length) {
      const c = queue.shift();
      const r = await judge(c).catch((e) => ({ error: String(e) }));
      out.push({ c, r });
      const v = new Map((r.detail?.verdicts ?? []).map(([i, j]) => [i, j]));
      console.log(`${c.id.padEnd(4)} ${String(r.wall).padStart(6)} ms  ${r.detail?.error ? `ERROR ${r.detail.error}` : r.error ? `ERROR ${r.error}` : `${v.size}/${c.claims.length} usable`}`);
    }
  }),
);
idp.close();
out.sort((a, b) => a.c.id.localeCompare(b.c.id));

// shorter claims: for claims the person labelled partial (with words that must go and words that must stay), what became of the shorter version the judge offered
const RW = { partial: 0, offered: 0, refused: 0, sent: 0, accepted: 0, forbidden: 0, lostKeep: 0, yesClaims: 0, yesAccepted: 0 };
const rwLines = [];
const T = { no: { all: 0, caught: 0, falseAccept: 0, missed: 0 }, yes: { all: 0, kept: 0, dropped: 0, other: 0 }, partial: { all: 0, yes: 0, partial: 0, no: 0, other: 0 }, framing: { all: 0, framing: 0, dropped: 0, attached: 0, other: 0 } };
const ev = { eligible: 0, hit: 0 };
const mk = { eligible: 0, left: 0 };
let claimsTotal = 0, usable = 0, errors = 0;
const ms = [];
const lines = [];
const rows = [];
for (const { c, r } of out) {
  const verdicts = new Map((r.detail?.verdicts ?? []).map(([i, j]) => [i, j]));
  if (r.error || r.detail?.error) errors++;
  if (r.detail?.ms) ms.push(r.detail.ms);
  for (const g of c.claims) {
    claimsTotal++;
    const j = verdicts.get(g.c);
    if (j) usable++;
    const V = j?.verdict ?? "unverified";
    const t = T[g.label];
    t.all++;
    if (g.label === "no") {
      if (V === "no") t.caught++;
      else if (V === "yes" || V === "partial") { t.falseAccept++; lines.push(`FALSE ACCEPT ${c.id} c${g.c} judged ${V} refs ${JSON.stringify(j?.refs)}  [${g.head}…] ${g.note ?? ""}`); }
      else t.missed++;
    } else if (g.label === "yes") {
      if (V === "yes" || V === "partial") t.kept++;
      else if (V === "no") { t.dropped++; lines.push(`FALSE DROP   ${c.id} c${g.c} [${g.head}…]`); }
      else t.other++;
    } else if (g.label === "partial") {
      if (V in t) t[V]++;
      else t.other++;
    } else if (g.label === "framing") {
      if (V === "framing") t.framing++;
      else if (V === "no") { t.dropped++; lines.push(`FRAMING DROPPED ${c.id} c${g.c} [${g.head}…]`); }
      else if (V === "yes" || V === "partial") t.attached++;
      else t.other++;
    }
    if ((g.label === "yes" || g.label === "partial") && (V === "yes" || V === "partial")) {
      ev.eligible++;
      const hit = j.refs.some((x) => (g.support[String(x.n)] ?? []).some((s) => x.s.includes(s)));
      if (hit) ev.hit++;
      else lines.push(`EVIDENCE MISS ${c.id} c${g.c} judge ${JSON.stringify(j.refs)} vs person ${JSON.stringify(g.support)}`);
    }
    for (const [mn, ml] of Object.entries(g.marks ?? {})) {
      if (ml !== "no" || !(V === "yes" || V === "partial")) continue;
      mk.eligible++;
      if (!j.refs.some((x) => x.n === Number(mn))) mk.left++;
      else lines.push(`PER-MARK ${c.id} c${g.c}: judge cites [${mn}] which the person says does not support it`);
    }
    const rw = (r.detail?.rewrites ?? []).find((x) => x.c === g.c);
    if (g.label === "partial") RW.partial++;
    if (g.label === "yes") RW.yesClaims++;
    if (rw) {
      if (g.label === "partial") {
        RW.offered++;
        if (rw.reason) RW.refused++;
        else RW.sent++;
        if (rw.accepted) {
          RW.accepted++;
          const low = rw.text.toLowerCase();
          const bad = (g.forbid ?? []).filter((w) => low.includes(w.toLowerCase()));
          const lost = (g.keep ?? []).filter((w) => !low.includes(w.toLowerCase()));
          if (bad.length) { RW.forbidden++; lines.push(`SHORTER KEEPS WHAT MUST GO ${c.id} c${g.c}: ${bad.join(", ")} in “${rw.text}”`); }
          if (lost.length) RW.lostKeep++;
          rwLines.push(`  ${c.id} c${g.c} ${bad.length ? "FORBIDDEN " : lost.length ? "LOST " : "ok "}: ${g.head}…  =>  ${rw.text}`);
        } else rwLines.push(`  ${c.id} c${g.c} ${rw.reason ? `refused (${rw.reason})` : "not confirmed"}: ${rw.text}`);
      } else if (g.label === "yes" && rw.accepted) {
        RW.yesAccepted++;
        lines.push(`A SUPPORTED CLAIM WAS SHORTENED ${c.id} c${g.c}: “${rw.text}” (was: ${g.head}…)`);
      }
    }
    rows.push({ id: c.id, c: g.c, gold: g.label, judge: V, refs: j?.refs ?? null, head: g.head, ...(rw ? { shorter: rw } : {}) });
  }
}
if (dump) writeFileSync(dump, JSON.stringify({ model: model ?? "default", reasoning: reasoning ?? "default", rows, lines }, null, 1));
const pct = (a, b) => (b === 0 ? "n/a" : `${Math.round((100 * a) / b)}%`);
const sorted = ms.sort((a, b) => a - b);
const med = sorted[Math.floor(sorted.length / 2)] ?? 0;
const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
console.log(`\n${lines.join("\n")}${lines.length ? "\n" : ""}`);
console.log(`model ${model ?? "default"}${reasoning ? ` (reasoning ${reasoning})` : ""}, split ${split}: ${cases.length} cases, ${claimsTotal} claims`);
const checks = [
  ["caught", `${T.no.caught} of ${T.no.all} claims labelled no are judged no (${pct(T.no.caught, T.no.all)}); ${T.no.missed} got no usable verdict`, T.no.all === 0 || T.no.caught / T.no.all >= 0.85],
  ["false accept", `${T.no.falseAccept} of ${T.no.all} labelled no are judged yes or partial (${pct(T.no.falseAccept, T.no.all)})`, T.no.all === 0 || T.no.falseAccept / T.no.all <= 0.1],
  ["kept", `${T.yes.kept} of ${T.yes.all} labelled yes are kept (${pct(T.yes.kept, T.yes.all)}), ${T.yes.dropped} dropped, ${T.yes.other} unjudged`, T.yes.all === 0 || T.yes.kept / T.yes.all >= 0.9],
  ["evidence", `${ev.hit} of ${ev.eligible} kept claims are backed by a sentence the person named (${pct(ev.hit, ev.eligible)})`, ev.eligible === 0 || ev.hit / ev.eligible >= 0.85],
  ["per-mark", `${mk.left} of ${mk.eligible} papers that do not support a claim are left out of its evidence`, mk.eligible < 3 || mk.left / mk.eligible >= 0.5], // too few of these in the labelled claims to gate on until there are three
  ["time", `a call takes ${(med / 1000).toFixed(1)} s (median) and ${(p90 / 1000).toFixed(1)} s (90th percentile); the limit is ${process.argv.includes("--strict") ? 60 : 15} s at the 90th`, ms.length === 0 || p90 <= (process.argv.includes("--strict") ? 60000 : 15000)],
  ["usable", `${usable} of ${claimsTotal} claims got a usable verdict (${pct(usable, claimsTotal)}); ${errors} call(s) failed`, claimsTotal === 0 || (process.argv.includes("--strict") ? usable / claimsTotal >= 0.9 && errors <= Math.ceil(cases.length * 0.1) : usable / claimsTotal >= 0.95 && errors === 0)],
];
checks.push(["shorter", `${RW.accepted} of ${RW.partial} partial claims were shortened (${RW.offered} offered, ${RW.refused} refused by the word check, ${RW.sent - RW.accepted} not confirmed by the second reading); ${RW.forbidden} still keep a word that must go, ${RW.lostKeep} lost a word that must stay; ${RW.yesAccepted} of ${RW.yesClaims} supported claims were shortened`, process.argv.includes("--strict") ? RW.forbidden <= Math.ceil(RW.accepted * 0.2) : RW.forbidden === 0 && RW.yesAccepted <= 1]);
for (const [name, text, ok] of checks) console.log(`${ok ? "  ok  " : " FAIL "} ${name.padEnd(13)} ${text}`);
if (process.argv.includes("--show-shorter")) console.log(["", "Shorter claims:", ...rwLines, ""].join(String.fromCharCode(10)));
console.log(`  info  partial claims: judged yes ${T.partial.yes}, partial ${T.partial.partial}, no ${T.partial.no}, unjudged ${T.partial.other} (of ${T.partial.all})`);
console.log(`  info  framing claims: framing ${T.framing.framing}, marks attached ${T.framing.attached}, dropped ${T.framing.dropped} (of ${T.framing.all})`);
if (gate && checks.some((c) => !c[2])) process.exit(1);
