import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CASES_PATH, DEFAULT_CONTROLS_PATH, FEW_RESULTS, MAX_QUERY_LENGTH, MAX_VARIANTS, OPENALEX_DAY_CALLS, OPENALEX_DAY_USD, OPENALEX_USD_PER_CALL, REQUESTS_PER_SEARCH, REQUESTS_PER_SPLIT, S2_GAP_MS, VARIANTS,
  buildReplayPlan, casesOf, estimateFor, formatPlan, productQuery, queryVariants, splitToken,
} from "./intent-replay-plan.mjs";

const here = (rel) => new URL(rel, import.meta.url);
const LIB = readFileSync(here("./intent-replay-plan.mjs"), "utf8");
const CLI_FILE = fileURLToPath(here("../intent-replay-plan.mjs"));
const CLI = readFileSync(CLI_FILE, "utf8");
const src = (p) => readFileSync(here(`../../src/${p}`), "utf8");

// A tiny set of our own: the real intent-cases.json and intent-controls.json are written by someone else and may or may not be there. Every topic is made up.
const LONG = "paste ".repeat(70); // 420 characters
const CASES = [
  { id: "c-01", text: "  how do glaciers   on an invented planet melt  ", retrieval: { cleanOracle: "glaciers invented planet melting" } },
  { id: "c-02", text: "zorbitol effect on mice" },
  { id: "c-03", text: "SwinYolo detector for glaciers", retrieval: { cleanOracle: "Swin Yolo detector" } },
  { id: "c-04", text: LONG },
];
const CONTROLS = { cases: [
  { id: "k-01", text: "glaciers on an invented planet", retrieval: { cleanOracle: "glaciers on an invented planet" } },
  { id: "k-02", text: "Zorbitol effect on   mice" },
] };
const SETS = { cases: CASES, controls: CONTROLS.cases };

/* ---------- no network, and kept in step with the code it counts ---------- */

test("neither the library nor the command line can make a network call (a test of their own source)", () => {
  const NETWORK = /fetch|https?|undici|XMLHttpRequest|WebSocket|node:(net|tls|dns|dgram|http2)/i;
  for (const [name, text] of [["library", LIB], ["command line", CLI]]) {
    const hit = NETWORK.exec(text);
    assert.equal(hit, null, `the ${name} mentions "${hit?.[0]}"`);
  }
});

test("the numbers the plan counts with are the ones in the product's code", () => {
  const index = src("search/index.ts");
  const query = src("search/query.ts");
  // which sources a regular search asks, in which order
  assert.ok(index.includes("all: [openalex, s2, crossref, pubmed, doajAll],"), "the sources of the regular search changed: recount REQUESTS_PER_SEARCH");
  assert.ok(index.includes("const PER_PROVIDER = 20;"));
  assert.ok(index.includes("export const MAX_QUERY_LENGTH = 300;"));
  assert.equal(MAX_QUERY_LENGTH, 300);
  assert.match(index, /mergeAndRank\(ordered\(lists\), 100[^)]*\)\.length < FEW_RESULTS/,"the repeat with the split words no longer depends on FEW_RESULTS");
  assert.ok(query.includes(`export const FEW_RESULTS = ${FEW_RESULTS};`));
  assert.ok(query.includes(`export const MAX_VARIANTS = ${MAX_VARIANTS};`));
  // the request sites of each source
  const sites = (file, re) => (src(`search/${file}`).match(re) ?? []).length;
  assert.equal(sites("openalex.ts", /await fetch\(`https:\/\/api\.openalex\.org\/works/g), 4, "openalex.ts: the regular search is one of four sites (two are Idea Check's; one looks papers up by DOI for the Understand step's questions about earlier papers, M5, outside the regular search)");
  assert.equal(sites("s2.ts", /return fetch\(url/g), 1);
  assert.equal(sites("crossref.ts", /crossrefFetch\(fetch/g), 1);
  assert.equal(sites("pubmed.ts", /await fetch\(/g), 2, "PubMed: esearch, then esummary");
  assert.equal(sites("india.ts", /await fetch\(`\$\{DOAJ_API\}/g), 1);
  assert.equal(sites("doi-check.ts", /crossrefFetch\(fetch/g), 1, "the DOI check: one Crossref batch");
  assert.equal(sites("retraction.ts", /crossrefFetch\(env\.fetch \?\? fetch/g), 1, "the retraction check: one Crossref call");
  assert.deepEqual(REQUESTS_PER_SEARCH, { openalex: 1, s2: 1, crossref: 3, pubmed: 2, doaj: 1 });
  assert.deepEqual(REQUESTS_PER_SPLIT, { openalex: 1, s2: 1, crossref: 1, pubmed: 2, doaj: 1 });
});

test("the price, the Semantic Scholar pace and the message limit are read from where the project states them", () => {
  assert.ok(src("search/openalex.ts").includes("har call ~$0.001 (OpenAlex Feb 2026 pricing"));
  assert.equal(OPENALEX_USD_PER_CALL, 0.001);
  assert.ok(readFileSync(here("../../eval/lib/fetch-layer.ts"), "utf8").includes(`"api.semanticscholar.org": ${S2_GAP_MS},`));
  assert.equal(OPENALEX_DAY_CALLS, 10_000);
  const routes = src("chat/routes.ts");
  assert.ok(routes.includes(String.raw`text.replace(/\s+/g, " ")`), "the chat route no longer sends the message with its spaces collapsed");
  assert.ok(routes.includes("if (query.length > 300 && !preset) return void (await done(false, \"too_long\"));"), "the chat route's limit changed");
});

test("the budget page names every scheduled workflow that holds the OpenAlex key, and counts the Trending daily file for both of its lists", () => {
  const dir = new URL("../../../../.github/workflows/", import.meta.url);
  const budget = readFileSync(here("../../../../docs/eval/openalex-budget.md"), "utf8");
  const spenders = readdirSync(dir).filter((f) => /[.]ya?ml$/.test(f) && /^\s*(?:-\s*)?cron:/m.test(readFileSync(new URL(f, dir), "utf8")) && readFileSync(new URL(f, dir), "utf8").includes("OPENALEX_API_KEY"));
  assert.ok(spenders.length >= 2, "the workflows folder no longer has the scheduled jobs that hold the key");
  for (const file of spenders) assert.ok(budget.includes(file), `${file} has a schedule and the OpenAlex key, and the budget page does not name it`);
  // the daily file asks for the global list and again for the India list, and an India-scope search is two OpenAlex requests
  assert.match(budget, /up to 180/);
  assert.match(budget, /openalex-india/);
  assert.match(budget, /shodhganga/);
  assert.ok(src("search/index.ts").includes("india: [openalexIndia, doajIndia, shodhganga],"), "the India scope changed: recount row 3 of the budget page");
  // the URLs the file writes in quotes or between back ticks (up to a "?" or a "${"), read as URLs: the host and the path are compared whole, not found as a piece of text
  const indiaUrls = [...src("search/india.ts").matchAll(/["'`](https:\/\/[^"'`$?]+)/g)].map((m) => new URL(m[1]));
  assert.ok(indiaUrls.some((u) => u.hostname === "api.openalex.org" && u.pathname === "/works"), "search/india.ts no longer asks api.openalex.org/works");
  assert.ok(/name: "openalex-india"/.test(src("search/india.ts")));
});

test("the paths of the two case files are in apps/api/eval/data", () => {
  assert.ok(DEFAULT_CASES_PATH.split(sep).join("/").endsWith("apps/api/eval/data/intent-cases.json"));
  assert.ok(DEFAULT_CONTROLS_PATH.split(sep).join("/").endsWith("apps/api/eval/data/intent-controls.json"));
});

test("the same word-splitting as query.ts, so that the plan knows which searches the product may repeat", () => {
  const query = src("search/query.ts");
  for (const line of [
    String.raw`if (!/^[\p{L}\p{N}_]+$/u.test(token)) return [token];`,
    String.raw`.replace(/_+/g, " ")`,
    String.raw`.replace(/(?<=\p{Ll})(?=\p{Lu})/gu, " ")`,
    String.raw`.replace(/(?<=\p{Lu})(?=\p{Lu}\p{Ll}{2,})/gu, " ")`,
    String.raw`const hasWord = (parts: string[]) => parts.filter((p) => /\p{L}{3}/u.test(p)).length >= 2;`,
    "if (!changed || spaced.toLowerCase() === tokens.join(\" \").toLowerCase()) return [];",
  ]) assert.ok(query.includes(line), `query.ts no longer has: ${line}`);
  assert.deepEqual(splitToken("SwinYolo"), ["Swin", "Yolo"]);
  assert.deepEqual(splitToken("swinYOLO"), ["swin", "YOLO"]);
  assert.deepEqual(splitToken("XMLHttpRequest"), ["XML", "Http", "Request"]);
  assert.deepEqual(splitToken("swin_yolo"), ["swin", "yolo"]);
  assert.deepEqual(splitToken("YOLOv8"), ["YOLOv8"]);
  assert.deepEqual(splitToken("Swin-YOLO"), ["Swin-YOLO"]);
  assert.deepEqual(queryVariants("SwinYolo detector for glaciers"), ["Swin Yolo detector for glaciers"]);
  assert.deepEqual(queryVariants("glaciers on an invented planet"), []);
  assert.deepEqual(queryVariants("YOLOv8 GPT4 3D"), []);
  assert.deepEqual(queryVariants("ab"), []);
  assert.deepEqual(queryVariants(""), []);
});

test("the recording keys on the request address as it is written: the same words in another case are another search for it, though the product's cache keeps them together", () => {
  const fetchLayer = readFileSync(here("../../eval/lib/fetch-layer.ts"), "utf8");
  const requestKey = fetchLayer.slice(fetchLayer.indexOf("export function requestKey"), fetchLayer.indexOf("const HOST_INTERVAL_MS"));
  assert.ok(requestKey.includes("searchParams.sort()"));
  assert.ok(!/toLowerCase|toLocaleLowerCase/.test(requestKey), "requestKey now changes the case: distinctSearches may count case-insensitively again");
});

test("the same words in another case are two searches (the recording keeps the case); the same words with other spaces are one", () => {
  const plan = buildReplayPlan({
    cases: [
      { id: "a", text: "attention is all you need" },
      { id: "b", text: "Attention is all you need" },
      { id: "c", text: "  attention   is all\nyou need " },
    ],
  });
  assert.equal(plan.summary.distinctSearches, 2);
  assert.equal(plan.summary.sharedRows, 1);
  assert.equal(plan.summary.estimate.openalex.calls, 2);
});

test("the key's day is read two ways, 10,000 calls (the plan's inferred figure) and $1 (the code's own note): a search costs a tenth of a cent, so the two differ by ten", () => {
  assert.equal(OPENALEX_DAY_USD, 1);
  assert.ok(src("search/openalex.ts").includes("$1/day free"));
  assert.equal(OPENALEX_DAY_CALLS * OPENALEX_USD_PER_CALL, 10 * OPENALEX_DAY_USD);
  const e = estimateFor(600, 0);
  assert.equal(e.keyDayShare.typical, 0.06);
  assert.equal(e.keyDayShareUsd.typical, 0.6);
  assert.equal(estimateFor(1142, 0).keyDayShareUsd.typical, 1.142);
  assert.equal(estimateFor(600, 5).keyDayShareUsd.upper, 0.605);
});

test("the product sends the message with its spaces collapsed; the plan also trims it", () => {
  assert.equal(productQuery("  how do   glaciers\n melt  "), "how do glaciers melt");
  assert.deepEqual(VARIANTS, ["raw", "read", "oracle"]);
});

/* ---------- reading the files ---------- */

test("casesOf takes a list, or an object with a cases list, and nothing else", () => {
  assert.deepEqual(casesOf([1, 2]), [1, 2]);
  assert.deepEqual(casesOf({ cases: [1] }), [1]);
  assert.equal(casesOf({ cases: "x" }), null);
  assert.equal(casesOf("text"), null);
  assert.equal(casesOf(null), null);
});

/* ---------- the plan ---------- */

test("without a reader: raw and oracle rows are planned, the read rows wait, a message over 300 characters is refused as the product refuses it", () => {
  const plan = buildReplayPlan(SETS);
  assert.deepEqual(plan.problems, []);
  assert.deepEqual(plan.rows, [
    { caseId: "c-01", source: "cases", variant: "raw", query: "how do glaciers on an invented planet melt" },
    { caseId: "c-01", source: "cases", variant: "oracle", query: "glaciers invented planet melting" },
    { caseId: "c-02", source: "cases", variant: "raw", query: "zorbitol effect on mice" },
    { caseId: "c-03", source: "cases", variant: "raw", query: "SwinYolo detector for glaciers" },
    { caseId: "c-03", source: "cases", variant: "oracle", query: "Swin Yolo detector" },
    { caseId: "k-01", source: "controls", variant: "raw", query: "glaciers on an invented planet" },
    { caseId: "k-01", source: "controls", variant: "oracle", query: "glaciers on an invented planet" },
    { caseId: "k-02", source: "controls", variant: "raw", query: "Zorbitol effect on mice" },
  ]);
  assert.deepEqual(plan.refused, [{ caseId: "c-04", source: "cases", variant: "raw", length: 419, reason: "longer than 300 characters: the product does not search it" }]);
  assert.equal(plan.pending.length, 6);
  assert.deepEqual(plan.pending[0], { caseId: "c-01", source: "cases", variant: "read", reason: "no reader was given (the reader is built in R8)" });
});

test("the summary counts cases, rows, distinct searches and what could be repeated", () => {
  const { summary } = buildReplayPlan(SETS);
  assert.deepEqual(summary.cases, { total: 6, bySource: { cases: 4, controls: 2 } });
  assert.deepEqual(summary.rows, { planned: 8, pending: 6, refused: 1, byVariant: { raw: 5, read: 0, oracle: 3 } });
  // raw: 5 different searches (c-02 and k-02 differ in case, which the recording keeps); oracle: 2 new ones (k-01's oracle is its raw)
  assert.equal(summary.distinctSearches, 7);
  assert.equal(summary.sharedRows, 1);
  assert.equal(summary.couldSplit, 1);
  assert.equal(summary.estimate.searches, 7);
  assert.equal(summary.estimate.openalex.calls, 7);
  assert.equal(summary.estimate.openalex.upper, 8);
  assert.equal(summary.estimate.requests.typical, 56);
  assert.equal(summary.estimate.requests.extraIfSplit, 6);
  assert.equal(summary.estimateWithRead.searches, 13, "every waiting read row may add one more search, at most");
});

test("with a reader the read rows are planned: one that equals the raw message shares its search, one with no topic waits", () => {
  const readTopic = (text, c) => ({ "c-01": "glaciers invented planet", "c-02": "zorbitol effect on mice", "c-03": "", "c-04": "invented paste topic", "k-01": "glaciers on an invented planet", "k-02": "zorbitol effect on mice" })[c.id];
  const plan = buildReplayPlan(SETS, { readTopic });
  assert.deepEqual(plan.rows.filter((r) => r.variant === "read").map((r) => [r.caseId, r.query]), [
    ["c-01", "glaciers invented planet"], ["c-02", "zorbitol effect on mice"], ["c-04", "invented paste topic"], ["k-01", "glaciers on an invented planet"], ["k-02", "zorbitol effect on mice"],
  ]);
  assert.deepEqual(plan.pending, [{ caseId: "c-03", source: "cases", variant: "read", reason: "the reader gave no topic" }]);
  assert.deepEqual(plan.summary.rows, { planned: 13, pending: 1, refused: 1, byVariant: { raw: 5, read: 5, oracle: 3 } });
  assert.equal(plan.summary.distinctSearches, 9);
  assert.equal(plan.summary.estimateWithRead.searches, 10);
});

test("a reader that throws is a problem and a waiting row, not a crash, and its message is not repeated", () => {
  const plan = buildReplayPlan({ cases: [CASES[0]] }, { readTopic: () => { throw new Error("SECRET-DETAIL"); } });
  assert.equal(plan.pending.length, 1);
  assert.equal(plan.pending[0].reason, "the reader failed");
  assert.equal(plan.problems.length, 1);
  assert.match(plan.problems[0], /c-01/);
  assert.ok(!JSON.stringify(plan).includes("SECRET-DETAIL"));
});

test("a message of exactly 300 characters is searched, one of 301 is refused", () => {
  const plan = buildReplayPlan({ cases: [{ id: "a", text: "x".repeat(300) }, { id: "b", text: "x".repeat(301) }] });
  assert.deepEqual(plan.rows.map((r) => r.caseId), ["a"]);
  assert.deepEqual(plan.refused.map((r) => r.caseId), ["b"]);
});

test("an oracle that is not a text is a problem, and a missing one is no row", () => {
  const plan = buildReplayPlan({ cases: [{ id: "a", text: "alpha topic", retrieval: { cleanOracle: 5 } }, { id: "b", text: "beta topic", retrieval: {} }, { id: "c", text: "gamma topic", retrieval: { cleanOracle: "   " } }] });
  assert.deepEqual(plan.rows.map((r) => `${r.caseId}:${r.variant}`), ["a:raw", "b:raw", "c:raw"]);
  assert.equal(plan.problems.length, 1);
  assert.match(plan.problems[0], /a: .*cleanOracle/);
});

test("items without an id or a text, and an id used twice, are reported and left out, not guessed", () => {
  const plan = buildReplayPlan({
    cases: [{ id: "a", text: "alpha topic" }, { id: "a", text: "alpha again" }, { text: "no id" }, { id: "n", text: "   " }, null, "text", { id: 5, text: "x" }],
    controls: [{ id: "a", text: "in the other file" }, { id: "z", text: "zeta topic" }],
  });
  assert.deepEqual(plan.rows.map((r) => `${r.source}:${r.caseId}`), ["cases:a", "controls:z"]);
  assert.equal(plan.problems.length, 7);
  assert.ok(plan.problems.some((p) => /cases #2/.test(p) && /already used/.test(p)));
  assert.ok(plan.problems.some((p) => /controls #1/.test(p) && /already used/.test(p)));
  assert.equal(plan.summary.cases.total, 2);
});

test("safety messages and chains are left out by default (the product answers a safety message before any search, and a chain is not one message), and counted", () => {
  const sets = { cases: [{ id: "a", set: "dev", text: "alpha topic" }, { id: "s", set: "safety_dev", text: "a placeholder safety row" }, { id: "h", set: "chains", text: "and after 2020?" }, { id: "n", text: "no set given" }] };
  const plan = buildReplayPlan(sets);
  assert.deepEqual(plan.rows.map((r) => r.caseId), ["a", "n"]);
  assert.deepEqual(plan.summary.excluded, { safety_dev: 1, chains: 1 });
  assert.equal(plan.summary.cases.total, 2);
  assert.deepEqual(plan.problems, []);
  const all = buildReplayPlan(sets, { excludeSets: [] });
  assert.deepEqual(all.rows.map((r) => r.caseId), ["a", "s", "h", "n"]);
  assert.deepEqual(all.summary.excluded, {});
});

test("a case of the sealed hold-out is never planned, even when exclusions are switched off: its text must not leave the sealed file", () => {
  const plan = buildReplayPlan({ cases: [{ id: "a", set: "dev", text: "alpha topic" }, { id: "h", set: "holdout", text: "a placeholder hold-out row" }] }, { excludeSets: [] });
  assert.deepEqual(plan.rows.map((r) => r.caseId), ["a"]);
  assert.equal(plan.problems.length, 1);
  assert.match(plan.problems[0], /h: .*hold-out/);
  assert.ok(!JSON.stringify(plan).includes("placeholder hold-out row"));
});

test("the same input always gives the same plan", () => {
  assert.deepEqual(buildReplayPlan(SETS), buildReplayPlan(JSON.parse(JSON.stringify(SETS))));
});

/* ---------- the estimate ---------- */

test("750 searches are 750 OpenAlex calls and 0.75 USD: the plan's figure, from the count and the price", () => {
  const e = estimateFor(750, 0);
  assert.equal(e.openalex.calls, 750);
  assert.equal(e.openalex.upper, 750);
  assert.equal(e.usd.typical, 0.75);
  assert.equal(e.requests.typical, 6000);
  assert.deepEqual(e.requests.byProvider, { openalex: 750, s2: 750, crossref: 2250, pubmed: 1500, doaj: 750 });
  assert.equal(e.keyDayShare.typical, 0.075);
  assert.equal(e.minutesAtS2Pace, 14.4);
});

test("a search the product may repeat adds one OpenAlex call and six requests at most", () => {
  const e = estimateFor(100, 10);
  assert.equal(e.openalex.calls, 100);
  assert.equal(e.openalex.upper, 110);
  assert.equal(e.requests.extraIfSplit, 60);
  assert.equal(e.usd.upper, 0.11);
  assert.deepEqual(estimateFor(0, 0).openalex, { calls: 0, upper: 0 });
});

/* ---------- what is printed ---------- */

test("the printed plan says it is a dry run with no network call, and gives the counts, the price and how it was made", () => {
  const text = formatPlan(buildReplayPlan(SETS)).join("\n");
  assert.match(text, /dry run/i);
  assert.match(text, /no network call/i);
  assert.match(text, /7 distinct searches/);
  assert.match(text, /OpenAlex calls/);
  assert.match(text, /0\.001/);
  assert.match(text, /OpenAlex calls: 7, at most 8: \$0\.0070 to \$0\.0080 at 0\.001 a call/);
  assert.match(text, /provider requests, one pass: 56 \(openalex 7, s2 7, crossref 21, pubmed 14, doaj 7\)/);
  assert.match(text, /read variant: 6 rows wait for the reader/);
  assert.match(text, /1 row refused/);
  // the 1,150 ms gap is the eval request layer's (npm run eval:record); patch-fixtures.mjs, which adds only missing recordings, has no pace for Semantic Scholar
  assert.match(text, /time: at least [0-9.]+ minutes at the eval request layer's pace.*patch-fixtures\.mjs/);
  assert.ok(!text.includes("glaciers"), "the printed summary does not list the messages (that is the JSON)");
});

test("the printed plan gives both readings of the key's day on one line, and says which one the code's own note supports", () => {
  const line = formatPlan(buildReplayPlan(SETS)).find((l) => l.startsWith("share of the key's day"));
  assert.ok(line, "no share line");
  assert.match(line, /^share of the key's day: [0-9.]+% if the day is 10,000 calls[^;]*; [0-9.]+% if the day is \$1 /);
  assert.match(line, /code's own note/);
  assert.match(line, /openalex\.ts/);
  // a dry run of 600 searches: 6% of 10,000 calls and 60% of $1, the two numbers the owner needs side by side
  const big = formatPlan(buildReplayPlan({ cases: Array.from({ length: 600 }, (_, i) => ({ id: `n-${i}`, text: `invented topic number ${i}` })) })).find((l) => l.startsWith("share of the key's day"));
  assert.match(big, /: 6% if the day is 10,000 calls[^;]*; 60% if the day is \$1 /);
});

/* ---------- the command line ---------- */

function tmp(t) {
  const dir = mkdtempSync(join(tmpdir(), "replay-plan-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function run(args, cwd) {
  const r = spawnSync(process.execPath, [CLI_FILE, ...args], { cwd, encoding: "utf8" });
  return { status: r.status, out: r.stdout, err: r.stderr };
}
function files(t) {
  const dir = tmp(t);
  writeFileSync(join(dir, "cases.json"), JSON.stringify(CASES));
  writeFileSync(join(dir, "controls.json"), JSON.stringify(CONTROLS));
  return dir;
}

test("the command prints the plan for the files it is given", (t) => {
  const dir = files(t);
  const r = run([`--cases=${join(dir, "cases.json")}`, `--controls=${join(dir, "controls.json")}`], dir);
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /dry run/i);
  assert.match(r.out, /7 distinct searches/);
  assert.match(r.out, /6 cases [(]4 cases, 2 controls[)]/);
});

test("--json prints the whole plan: rows (case, variant, query), the summary and the problems", (t) => {
  const dir = files(t);
  const r = run([`--cases=${join(dir, "cases.json")}`, `--controls=${join(dir, "controls.json")}`, "--json"], dir);
  assert.equal(r.status, 0, r.err);
  const plan = JSON.parse(r.out);
  assert.equal(plan.rows.length, 8);
  assert.deepEqual(plan.rows[0], { caseId: "c-01", source: "cases", variant: "raw", query: "how do glaciers on an invented planet melt" });
  assert.equal(plan.summary.distinctSearches, 7);
  assert.deepEqual(plan.problems, []);
});

test("--reader loads a local module and plans the read rows from it", (t) => {
  const dir = files(t);
  writeFileSync(join(dir, "reader.mjs"), "export default (text) => text.toLowerCase().split(' ').filter(Boolean).join(' ');\n");
  const r = run([`--cases=${join(dir, "cases.json")}`, `--controls=${join(dir, "controls.json")}`, `--reader=${join(dir, "reader.mjs")}`, "--json"], dir);
  assert.equal(r.status, 0, r.err);
  const plan = JSON.parse(r.out);
  assert.equal(plan.summary.rows.byVariant.read, 5);
  assert.ok(plan.rows.some((x) => x.variant === "read" && x.caseId === "c-01" && x.query === "how do glaciers on an invented planet melt"));
});

test("a file that was asked for by name and cannot be read, or is not a list of cases, is an error", (t) => {
  const dir = tmp(t);
  const none = run(["--cases=" + join(dir, "nope-cases.json"), "--controls=" + join(dir, "nope-controls.json")], dir);
  assert.equal(none.status, 1);
  assert.match(none.err, /cannot read/);
  const bad = join(dir, "bad.json");
  writeFileSync(bad, "{ not json");
  const r = run([`--cases=${bad}`, `--controls=${bad}`], dir);
  assert.equal(r.status, 1);
  assert.match(r.err, /not valid JSON/);
  const shape = join(dir, "shape.json");
  writeFileSync(shape, JSON.stringify({ rows: [] }));
  const s = run([`--cases=${shape}`, `--controls=${shape}`], dir);
  assert.equal(s.status, 1);
  assert.match(s.err, /list of cases/);
});

/** A copy of the two files in the folders they have in the repository, so that their default paths point into a folder of the test's own. */
function tree(t) {
  const dir = tmp(t);
  mkdirSync(join(dir, "apps", "api", "scripts", "lib"), { recursive: true });
  mkdirSync(join(dir, "apps", "api", "eval", "data"), { recursive: true });
  copyFileSync(CLI_FILE, join(dir, "apps", "api", "scripts", "intent-replay-plan.mjs"));
  copyFileSync(fileURLToPath(here("./intent-replay-plan.mjs")), join(dir, "apps", "api", "scripts", "lib", "intent-replay-plan.mjs"));
  return { dir, cli: join(dir, "apps", "api", "scripts", "intent-replay-plan.mjs"), data: join(dir, "apps", "api", "eval", "data") };
}
const runTree = (tr, args) => {
  const r = spawnSync(process.execPath, [tr.cli, ...args], { cwd: tr.dir, encoding: "utf8" });
  return { status: r.status, out: r.stdout, err: r.stderr };
};

test("with no arguments and no case files yet it says which are missing and is not a failure", (t) => {
  const tr = tree(t);
  const r = runTree(tr, []);
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /dry run/i);
  assert.match(r.out, /intent-cases[.]json: not there yet/);
  assert.match(r.out, /intent-controls[.]json: not there yet/);
  assert.match(r.out, /0 distinct searches/);
});

test("with no arguments it reads intent-cases.json and intent-controls.json next to the eval data, as they appear", (t) => {
  const tr = tree(t);
  writeFileSync(join(tr.data, "intent-cases.json"), JSON.stringify(CASES));
  const only = runTree(tr, []);
  assert.equal(only.status, 0, only.err);
  assert.match(only.out, /intent-controls[.]json: not there yet/);
  assert.match(only.out, /5 distinct searches/);
  writeFileSync(join(tr.data, "intent-controls.json"), JSON.stringify(CONTROLS));
  const both = runTree(tr, []);
  assert.equal(both.status, 0, both.err);
  assert.doesNotMatch(both.out, /not there yet/);
  assert.match(both.out, /7 distinct searches/);
});

test("problems in the files give exit code 1 after the plan is printed; an unknown option gives 2", (t) => {
  const dir = tmp(t);
  writeFileSync(join(dir, "cases.json"), JSON.stringify([{ id: "a", text: "alpha topic" }, { id: "a", text: "again" }]));
  writeFileSync(join(dir, "controls.json"), "[]");
  const r = run([`--cases=${join(dir, "cases.json")}`, `--controls=${join(dir, "controls.json")}`], dir);
  assert.equal(r.status, 1);
  assert.match(r.out, /1 problem/);
  assert.match(r.out, /already used/);
  const u = run(["--frobnicate"], dir);
  assert.equal(u.status, 2);
  assert.match(u.err, /usage/i);
});
