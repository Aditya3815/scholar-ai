// What does the Trending job make of the real world? It runs the job's own code (apps/api/src/trending/job.ts, bundled with esbuild, no Worker) with the real fetch: OpenAlex for the weekly scan and
// the checks, arXiv for the second source, and the product's own search for the verifier (the same code the chat runs, in this process, or a deployed one with --search=<base>). The Worker's
// KV is a memory copy that is kept in a file between runs, so a scan that does not fit in one run goes on in the next, as it does in production.
//
//   OPENALEX_API_KEY=... TRENDING_MAILTO=you@example.org node scripts/trending-live.mjs [--out=<dir>] [--max-runs=4] [--no-extra] [--search=https://sodhsetu.in]
//                                                                                    [--subfields=1702,1706] [--fresh] [--force] [--stub]
//
// It writes <out>/list.json (the final file and the whole candidate pool: counts a and b, scores, subfield, where the confirmation came from, the verifier's numbers, how many calls) and
// <out>/report.txt (the same as a table to read), and prints the first lines of it.
//
// A KEY IS NEEDED, in practice. Without one OpenAlex gives a daily budget of $0.10 (1,000 calls at $0.0001) that is SHARED by everyone behind one address, and a full scan is about 1,000 calls (243
// subfields, two windows, everyone and India, then the journals and countries of the best candidates). The script reads the budget OpenAlex reports before it starts and stops, spending
// nothing more, when it cannot fit (--force goes on anyway: the scan stops where the budget does and the next run, with the file kept in <out>, goes on from there). The key is read from the environment
// only (never from a file) and never written anywhere: no address of a call is ever printed or saved (an OpenAlex address holds the key), only counts, host names and status codes.
//
// What is called, and how often: OpenAlex about 800 calls for the scan and 100 to 250 for the checks (4 at a time); arXiv 3 calls per phrase of computing, mathematics and physics, one every
// 3.1 seconds, as arXiv asks; the product's own search once per phrase asked about (up to 60 a list), plus the extra pass below. `--no-extra` leaves the extra pass out: by default, after the
// job's own run, every pool candidate the job did not ask about is checked the same way (same functions, a memo of what the job already asked, so nothing is asked twice), so that the report
// shows the confirmation and the verifier's numbers for the whole pool. That pass is this script's, marked as such in the output; it is not part of the job.
//
// --stub runs the same code over the job's offline stand-ins (made-up topics): it checks this script and writes to <out>/stub, never into <out> itself. Nothing in it is the real world.
import { build } from "esbuild";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const args = process.argv.slice(2);
const flag = (name, fallback = "") => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const has = (name) => args.includes(`--${name}`);
const die = (message, code = 1) => {
  console.error(message);
  process.exit(code);
};

const stub = has("stub");
const base = resolve(flag("out", process.env.TRENDING_LIVE_OUT ?? "trending-live-out"));
const outDir = stub ? join(base, "stub") : base;
mkdirSync(outDir, { recursive: true });
const maxRuns = Math.max(1, Math.min(8, Number(flag("max-runs", "4")) || 4));
const extra = !has("no-extra");
const searchBase = flag("search", "").replace(/[/]+$/, "");
const apiKey = process.env.OPENALEX_API_KEY || undefined;
const mailto = flag("mailto", process.env.TRENDING_MAILTO ?? process.env.CROSSREF_MAILTO ?? "");
const onlySubfields = flag("subfields", "") ? flag("subfields").split(",").map((s) => Number(s.trim())) : undefined;
if (onlySubfields && !onlySubfields.every((n) => Number.isInteger(n) && n > 0)) die("--subfields takes whole numbers, as OpenAlex numbers its subfields: 1702,1706");
if (!stub && !/^[^@\s]+@[^@\s]+[.][^@\s]+$/.test(mailto)) die("An address to put in the calls is needed (OpenAlex and arXiv ask for one): TRENDING_MAILTO=you@example.org or --mailto=. It is sent to those two services only.");
const searchKeys = { OPENALEX_API_KEY: apiKey, NCBI_API_KEY: process.env.NCBI_API_KEY, S2_API_KEY: process.env.S2_API_KEY, CORE_API_KEY: process.env.CORE_API_KEY };

/* ---------------------------------------------------------------- the job's code, bundled */

const tmp = mkdtempSync(join(tmpdir(), "trending-live-"));
await build({
  stdin: {
    resolveDir: join(root, "apps/api"),
    sourcefile: "trending-live-entry.ts",
    loader: "ts",
    contents: [
      'export { runTrending, TRENDING_LIMITS } from "./src/trending/job";',
      'export { fakeKv } from "./src/trending/fake-kv";',
      'export { arxivCounts, arxivWindows, parseArxivCount } from "./src/trending/arxiv";',
      'export { CallBudget, makePacer } from "./src/trending/sources";',
      'export { TRENDING_KEYS } from "./src/trending/store";',
      'export { makeStubTrending, STUB_SUBFIELDS } from "./src/trending/stub";',
      'export { runSearch } from "./src/search";',
      'export { memoryStore } from "./src/cache/store";',
      'export { YEAR_FILTER_SEARCH_LIMIT } from "@scholar/shared";',
      'export { QUERYABLE_SUBFIELDS } from "@scholar/shared/src/subfield-policy";',
      'export * as T from "@scholar/shared/src/trending";',
    ].join("\n"),
  },
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: join(tmp, "job.mjs"),
  logLevel: "silent",
});
const J = await import(pathToFileURL(join(tmp, "job.mjs")).href);
const { T } = J;

/* ---------------------------------------------------------------- every call is counted, and no address is written down with its key */

let underlying = globalThis.fetch.bind(globalThis);
const net = { total: 0, hosts: {}, failures: 0, failed: {}, statuses: {}, waitedMs: 0 };
const oaBudget = { reports: 0, firstRemaining: null, lastRemaining: null, limit: null, lastRemainingUsd: null, costUsd: 0 };
const arxivMemo = new Map();
const arxivSeen = [];
const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const bump = (o, k) => void (o[k] = (o[k] ?? 0) + 1);

const countedFetch = async (input, init) => {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const u = new URL(href);
  if (u.hostname === "export.arxiv.org" && arxivMemo.has(href)) {
    const m = arxivMemo.get(href);
    return new Response(m.body, { status: 200, headers: { "content-type": "application/atom+xml" } });
  }
  net.total++;
  bump(net.hosts, u.hostname);
  const t0 = Date.now();
  let res;
  try {
    res = await underlying(input, init);
  } catch (e) {
    net.failures++;
    bump(net.failed, `${u.hostname} ${e instanceof Error ? e.name : "error"}`);
    throw e;
  } finally {
    net.waitedMs += Date.now() - t0;
  }
  bump(net.statuses, `${u.hostname} ${res.status}`);
  if (u.hostname === "api.openalex.org") {
    const remaining = num(res.headers.get("x-ratelimit-remaining"));
    oaBudget.reports++;
    if (remaining !== null) {
      oaBudget.firstRemaining ??= remaining;
      oaBudget.lastRemaining = remaining;
    }
    oaBudget.limit = num(res.headers.get("x-ratelimit-limit")) ?? oaBudget.limit;
    oaBudget.lastRemainingUsd = num(res.headers.get("x-ratelimit-remaining-usd")) ?? oaBudget.lastRemainingUsd;
    oaBudget.costUsd += num(res.headers.get("x-ratelimit-cost-usd")) ?? 0;
  }
  if (u.hostname === "export.arxiv.org" && res.ok) {
    try {
      const body = await res.clone().text();
      const total = J.parseArxivCount(body); // throws for an Error entry, which is never kept
      const q = u.searchParams.get("search_query") ?? "";
      const phrase = /all:"([^"]*)"/.exec(q)?.[1];
      const from = /submittedDate:[[]([0-9]{12}) TO/.exec(q)?.[1];
      if (phrase !== undefined && from !== undefined) arxivSeen.push({ phrase: T.phraseKey(phrase), from, total });
      arxivMemo.set(href, { body });
    } catch {
      /* an Error entry or a feed that cannot be read: the job's own reading of it decides what happens, and it is asked again if it is asked again */
    }
  }
  return res;
};
if (!stub) globalThis.fetch = countedFetch; // the search code in this process calls the global one: its calls to its sources are counted too

/* ---------------------------------------------------------------- the day, the state, the budget */

const startedAt = Date.now();
const asOf = new Date(startedAt).toISOString().slice(0, 10);
const sinceYear = Number(asOf.slice(0, 4)) - 1;
const statePath = join(outDir, "kv-state.json");
// the stand-ins run on a clock of their own that only the job's pauses move (the KV's one second between two writes of a key, arXiv's three seconds): no real waiting
let stubNow = startedAt;
const kv = J.fakeKv({ now: () => (stub ? stubNow : Date.now()) });
if (!has("fresh") && existsSync(statePath)) {
  try {
    const saved = JSON.parse(readFileSync(statePath, "utf8"));
    for (const [key, value] of Object.entries(saved.kv ?? {})) kv.seed(key, String(value), 14 * 86400);
    console.log(`Continuing from ${statePath} (${Object.keys(saved.kv ?? {}).length} keys of the run saved ${saved.savedAt}). --fresh begins again.`);
  } catch {
    console.log("The saved state could not be read: beginning again.");
  }
}
const saveState = () => {
  const state = {};
  for (const key of kv.keys()) state[key] = kv.read(key);
  writeFileSync(statePath, JSON.stringify({ savedAt: new Date().toISOString(), kv: state }));
};

const subfieldCount = stub ? J.STUB_SUBFIELDS.length : (onlySubfields ?? J.QUERYABLE_SUBFIELDS).length;
/** Credits a run needs: 4 calls for a subfield at most (two windows, everyone and India), 250 for the journals, countries and exact counts, and a search costs about as much as ten of these when it is run here. */
const needed = subfieldCount * 4 + 250 + (searchBase ? 0 : 800);
if (!stub) {
  const params = new URLSearchParams({ filter: "type:article,from_publication_date:2025-01-01,to_publication_date:2025-01-02", "per-page": "1", select: "id", mailto });
  if (apiKey) params.set("api_key", apiKey);
  let status = 0;
  try {
    status = (await countedFetch(`https://api.openalex.org/works?${params}`)).status;
  } catch {
    die("OpenAlex could not be reached: nothing was run.", 3);
  }
  const left = oaBudget.lastRemaining ?? (status === 429 ? 0 : null);
  console.log(`OpenAlex budget before the run: ${left === null ? "not reported" : `${left} credits left`}${oaBudget.limit ? ` of ${oaBudget.limit} a day` : ""}${apiKey ? " (with a key)" : " (NO KEY: shared by everyone behind this address)"}; this run needs about ${needed}.`);
  if (left !== null && left < needed && !has("force")) {
    die(`Not started: ${left} credits are left and about ${needed} are needed, so a run would stop part way and leave a partial scan. Nothing more was spent (${net.total} call). Give OPENALEX_API_KEY (a free key has $1 a day, 10,000 calls), or wait for the daily reset at 00:00 UTC, or use --force.`, 2);
  }
}

/* ---------------------------------------------------------------- the product's own search, with a memo so that nothing is asked twice */

const searches = new Map();
const localEnv = { store: J.memoryStore(), ...searchKeys, CROSSREF_MAILTO: mailto };
const slept = (ms) => new Promise((r) => setTimeout(r, ms));
let lastSearchAt = 0;
async function rawSearch(q, scope) {
  if (stub) return stand.search(q, scope);
  if (searchBase) {
    // a deployed search: public, 60 a minute for one address; one every 2.5 seconds
    const wait = lastSearchAt + 2500 - Date.now();
    if (wait > 0) await slept(wait);
    lastSearchAt = Date.now();
    const url = `${searchBase}/api/v1/search?${new URLSearchParams({ q, limit: String(J.YEAR_FILTER_SEARCH_LIMIT), scope })}`;
    for (let attempt = 0; ; attempt++) {
      const res = await countedFetch(url, { headers: { "User-Agent": "sodhsetu-trending-live/1" }, signal: AbortSignal.timeout(60_000) });
      if (res.ok) return await res.json();
      if (attempt >= 2 || (res.status < 500 && res.status !== 429)) throw new Error(`search: HTTP ${res.status}`);
      await slept(res.status === 429 ? 15_000 : 3_000);
    }
  }
  return J.runSearch(localEnv, q, J.YEAR_FILTER_SEARCH_LIMIT, {}, scope);
}
const scopeOf = (group) => (group === "in" ? "india" : "all");
async function ask(q, scope) {
  const key = `${scope}|${T.phraseKey(q)}`;
  const known = searches.get(key);
  if (known) return known.response;
  const t0 = Date.now();
  const response = await rawSearch(q, scope);
  const providers = Object.entries(response.providers ?? {}).map(([name, p]) => ({ name, ok: p?.ok === true, count: p?.count ?? 0 }));
  const summary = T.summarizeSearch(response.results ?? [], sinceYear);
  searches.set(key, { q, scope, response, ms: Date.now() - t0, providers, summary, verdict: T.verifySummary(summary), answered: providers.some((p) => p.ok) });
  return response;
}

/* ---------------------------------------------------------------- the runs */

const stand = stub ? J.makeStubTrending({ asOf: () => asOf }) : null;
if (stand) underlying = stand.fetch;
const subfields = stub ? J.STUB_SUBFIELDS : onlySubfields;
const deps = stub
  ? { kv: kv.kv, mailto: "stub@example.org", fetch: countedFetch, search: ask, sleep: async (ms) => void (stubNow += ms), clock: () => stubNow, subfields, lane: false }
  : {
      kv: kv.kv,
      mailto,
      ...(apiKey ? { apiKey } : {}),
      fetch: countedFetch,
      search: ask,
      ...(subfields ? { subfields } : {}),
    };
const readJson = (key) => {
  try {
    return JSON.parse(kv.read(key) ?? "null");
  } catch {
    return null;
  }
};
const runs = [];
let failure = null;
for (let n = 1; n <= maxRuns; n++) {
  console.log(`\nRun ${n} of at most ${maxRuns} (each is what one daily job does: the file first when there is a pool, then the scan with the time that is left)...`);
  const t0 = Date.now();
  try {
    const r = await J.runTrending(deps, stub ? stubNow : Date.now());
    runs.push(r);
    console.log(`  ${(r.ms / 1000).toFixed(0)} s, ${r.calls} counted calls, ${r.kvOps} KV operations; scan: ${r.scan ? `batch ${r.scan.next} of ${r.scan.batches}${r.scan.completed ? ", whole, pool made" : ""}${r.scan.skipped ? `, ${r.scan.skipped}` : ""}` : "none"}; file: ${r.daily ? (r.daily.published ? `published, ${r.daily.global?.length} global and ${r.daily.india?.length} India phrases` : `not published (${r.daily.reason ?? "?"})`) : "not made"}`);
  } catch (e) {
    failure = { run: n, message: e instanceof Error ? `${e.name}: ${e.message}` : String(e), ms: Date.now() - t0 };
    console.error(`  the run failed: ${failure.message}`);
    break;
  } finally {
    saveState();
  }
  const scan = readJson(J.TRENDING_KEYS.scan);
  const scanning = scan && scan.done !== true && scan.next < scan.batches;
  if (!scanning && readJson(J.TRENDING_KEYS.file) && readJson(J.TRENDING_KEYS.pool)) break;
}

/* ---------------------------------------------------------------- the whole pool, with what the job knew of each phrase and what it did not ask */

const file = readJson(J.TRENDING_KEYS.file);
const pool = readJson(J.TRENDING_KEYS.pool);
const shown = { global: new Set((file?.groups?.global?.chips ?? []).map((c) => T.phraseKey(c.text))), in: new Set((file?.groups?.in?.chips ?? []).map((c) => T.phraseKey(c.text))) };
const win = J.arxivWindows(asOf);
const arxivOf = (phrase) => {
  const key = T.phraseKey(phrase);
  const get = (w) => arxivSeen.find((s) => s.phrase === key && s.from === w.from)?.total;
  const recent = get(win.recent);
  const previous = get(win.previous);
  const yearAgo = get(win.yearAgo);
  return recent !== undefined && previous !== undefined && yearAgo !== undefined ? { recent, previous, yearAgo } : null;
};
const extraBudget = new J.CallBudget(2000, "calls of the extra pass");
const extraPace = stub ? async () => {} : J.makePacer(3100, Date.now, slept);
const rows = { global: [], in: [] };
if (pool) {
  for (const group of ["global", "in"]) {
    const list = group === "global" ? pool.global : pool.india;
    let rank = 0;
    for (const c of list) {
      rank++;
      let arxiv = null;
      let byJob = true;
      if (T.usesSecondSource(c.fieldId)) {
        arxiv = arxivOf(c.text);
        if (!arxiv && extra) {
          byJob = false;
          try {
            const got = await J.arxivCounts({ http: { fetch: countedFetch, sleep: slept, timeoutMs: 30_000, retries: 1, retryWaitMs: 1500, maxRetryWaitMs: 10_000 }, mailto, budget: extraBudget, pace: extraPace }, c.text, asOf);
            arxiv = { recent: got.recent, previous: got.previous, yearAgo: got.yearAgo };
          } catch (e) {
            arxiv = null;
          }
        }
      }
      const conf = T.usesSecondSource(c.fieldId) ? T.confirmation(c, arxiv && { recent: arxiv.recent, yearAgo: arxiv.yearAgo }) : T.confirmation(c);
      const key = `${scopeOf(group)}|${T.phraseKey(c.text)}`;
      let found = searches.get(key);
      let verifiedByJob = !!found;
      if (!found && extra && conf.ok) {
        // a phrase the job did not need to ask about: asked here, and said so
        try {
          await ask(c.text, scopeOf(group));
        } catch {
          /* the search did not answer: no numbers */
        }
        found = searches.get(key);
        verifiedByJob = false;
      }
      const isShown = shown[group].has(T.phraseKey(c.text));
      let status = "shown";
      if (!isShown) {
        if (!conf.ok) status = `no: confirmation (${conf.reason})`;
        else if (found && !found.answered) status = "no: the search did not answer";
        else if (found && !found.verdict.ok) status = `no: verifier (${found.verdict.failures.join(", ")})`;
        else status = "not chosen (a cap of one a field or four a domain, hysteresis, or the list was full)";
      }
      rows[group].push({
        rank,
        text: c.text,
        subfield: c.subfield,
        subfieldName: c.subfieldName,
        field: c.field,
        domain: c.domain,
        a: c.a,
        b: c.b,
        growth: Number((c.a / Math.max(c.b, 1)).toFixed(2)),
        subfieldGrowth: Number(c.ratio.toFixed(2)),
        score: Number(c.score.toFixed(2)),
        papersInAllSubfields: c.total,
        confirmation: conf.ok ? { ok: true, by: conf.by, ...(conf.by === "arxiv" ? { growth: Number(conf.growth.toFixed(2)) } : {}) } : { ok: false, reason: conf.reason },
        confirmationAskedBy: arxiv === null && !T.usesSecondSource(c.fieldId) ? "not needed (no second source for this field)" : byJob ? "the job" : "the extra pass",
        arxiv,
        verifier: found
          ? { askedBy: verifiedByJob ? "the job" : "the extra pass", scope: found.scope, ...found.summary, ok: found.verdict.ok, failures: found.verdict.failures, sourcesAnswering: found.providers.filter((p) => p.ok).map((p) => p.name), sourcesFailing: found.providers.filter((p) => !p.ok).map((p) => p.name), ms: found.ms }
          : null,
        shown: isShown,
        status,
      });
    }
  }
}

/* ---------------------------------------------------------------- the files */

const calls = {
      network: net,
      openalexBudget: { ...oaBudget, costUsd: Number(oaBudget.costUsd.toFixed(4)), creditsUsedByThisRun: oaBudget.firstRemaining !== null && oaBudget.lastRemaining !== null ? oaBudget.firstRemaining + 1 - oaBudget.lastRemaining : null },
      openalex: net.hosts["api.openalex.org"] ?? 0,
      arxiv: net.hosts["export.arxiv.org"] ?? 0,
      searches: searches.size,
      searchCallsToSources: Object.fromEntries(Object.entries(net.hosts).filter(([h]) => h !== "api.openalex.org" && h !== "export.arxiv.org")),
      total: net.total,
    };
const list = {
  kind: stub ? "STAND-IN DATA: a check of this script over the job's offline stand-ins. Nothing here is the real world." : "live",
  partial: Boolean(onlySubfields),
  asOf,
  startedAt: new Date(startedAt).toISOString(),
  finishedAt: new Date().toISOString(),
  keyed: Boolean(apiKey),
  searchVia: searchBase || "in-process: the product's own search code, with the keys of this environment",
  extraPass: extra,
  failure,
  runs,
  calls,
  file,
  pool: pool ? { poolAsOf: pool.poolAsOf, builtAt: pool.builtAt, held: pool.held, global: rows.global, in: rows.in } : null,
};
writeFileSync(join(outDir, "list.json"), JSON.stringify(list, null, 1));

const pad = (s, n) => String(s).slice(0, n).padEnd(n);
const cell = (s, n) => String(s).slice(0, n - 1).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);
const lines = [];
lines.push(`TRENDING, ${asOf}${stub ? "  *** STAND-IN DATA (a check of the script): NOT THE REAL WORLD ***" : ""}${onlySubfields ? `  PARTIAL RUN: ${onlySubfields.length} subfields` : ""}`);
lines.push(`windows: A ${T.trendWindows(asOf).a.from} to ${T.trendWindows(asOf).a.to}, B ${T.trendWindows(asOf).b.from} to ${T.trendWindows(asOf).b.to}; the verifier counts a paper as recent from ${sinceYear}`);
lines.push(`keyed: ${Boolean(apiKey)}; search: ${list.searchVia}; extra pass: ${list.extraPass}`);
if (failure) lines.push(`FAILED in run ${failure.run}: ${failure.message}`);
lines.push("");
lines.push("CALLS");
lines.push(`  OpenAlex ${calls.openalex}, arXiv ${calls.arxiv}, the product's search ${calls.searches} times (${stub ? "stand-in" : `${JSON.stringify(calls.searchCallsToSources)} calls to its sources`}), ${calls.total} calls in all`);
if (!stub) lines.push(`  OpenAlex budget: ${JSON.stringify(calls.openalexBudget)}`);
runs.forEach((r, i) => lines.push(`  run ${i + 1}: ${(r.ms / 1000).toFixed(0)} s, ${r.calls} counted calls, ${r.kvOps} KV operations; scan ${r.scan ? `${r.scan.next}/${r.scan.batches}${r.scan.completed ? " whole" : ""}` : "-"}; file ${r.daily ? (r.daily.published ? "published" : r.daily.reason ?? "no") : "-"}${r.daily?.rejected ? `; refused: ${r.daily.rejected.confirmation} by confirmation, ${r.daily.rejected.verification} by the verifier` : ""}`));
lines.push("");
const show = (title, group) => {
  lines.push(title);
  const chips = file?.groups?.[group]?.chips ?? [];
  if (!file) lines.push("  (no file was published)");
  chips.forEach((c, i) => lines.push(`  ${rpad(i + 1, 2)}. ${pad(c.text, 36)} ${rpad(c.a, 5)} vs ${rpad(c.b, 5)}  from ${c.sinceYear}  ${c.field}`));
  lines.push("");
};
show("FINAL LIST, everyone (the Trending row)", "global");
show("FINAL LIST, India", "in");
const table = (title, list2) => {
  lines.push(title);
  lines.push(`  ${cell("#", 3)}${cell("phrase", 37)}${rpad("a", 6)}${rpad("b", 6)}${rpad("x", 6)}${rpad("score", 6)}  ${cell("subfield / field", 46)}${cell("confirmation", 28)}${cell("verifier: results/abstracts/recent/retracted/top venue", 58)}status`);
  for (const r of list2) {
    const conf = r.confirmation.ok ? (r.confirmation.by === "arxiv" ? `arXiv ${r.arxiv ? `${r.arxiv.recent} vs ${r.arxiv.yearAgo}` : ""} x${r.confirmation.growth}` : "own score") : `NO ${r.confirmation.reason}`;
    const v = r.verifier ? `${r.verifier.total}/${r.verifier.withAbstract}/${r.verifier.recent}/${r.verifier.retracted}/${Math.round(r.verifier.topVenueShare * 100)}%${r.verifier.ok ? " ok" : ` FAIL ${r.verifier.failures.join(",")}`}${r.verifier.askedBy === "the job" ? "" : " (extra)"}` : "not asked";
    lines.push(`  ${cell(r.rank, 3)}${cell(r.text, 37)}${rpad(r.a, 6)}${rpad(r.b, 6)}${rpad(r.growth, 6)}${rpad(r.score, 6)}  ${cell(`${r.subfieldName} / ${r.field}`, 46)}${cell(conf, 28)}${cell(v, 58)}${r.status}`);
  }
  lines.push("");
};
if (pool) {
  lines.push(`THE POOL (made from the scan of ${pool.poolAsOf}), best first. a, b: papers in window A and in the same dates a year earlier; x = a/b; score = the Wilson bound against the subfield's own growth`);
  lines.push("");
  table("POOL, everyone", rows.global);
  table("POOL, India", rows.in);
  lines.push(`HELD (health and other held subfields: found, logged, never shown): ${pool.held.length ? pool.held.join("; ") : "none"}`);
}
writeFileSync(join(outDir, "report.txt"), `${lines.join("\n")}\n`);

console.log(`\nWritten: ${join(outDir, "list.json")} and ${join(outDir, "report.txt")}`);
console.log(`Calls: OpenAlex ${calls.openalex}, arXiv ${calls.arxiv}, searches ${calls.searches}, ${calls.total} in all.`);
console.log("\nTop 20 of the pool, everyone:");
rows.global.slice(0, 20).forEach((r) => console.log(`  ${rpad(r.rank, 2)}. ${pad(r.text, 36)} ${rpad(r.a, 5)} vs ${rpad(r.b, 5)}  x${r.growth}  score ${r.score}  ${r.field}  [${r.status}]`));
if (!pool) console.log("  (there is no pool: the scan is not whole. Run again: it goes on from where it stopped.)");
process.exit(failure ? 1 : 0);
