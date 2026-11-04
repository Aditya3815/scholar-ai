// The Trending contract, against the LIVE product (docs/design/chatview-and-trending.md, section 3, "Contract"): the file the Home page reads (GET /api/v1/home/trending) and the bundled
// "Try" chips (apps/web/src/workspace/starters.ts) are each searched with the product's own public search (GET /api/v1/search, the same sources and the same merge a person's search uses), and
// the run FAILS when
//   - the file is not one the page would show: unreadable, expired, past its pool's age, or with fewer than 8 phrases for everyone (a file that is switched off with `disabled: true` is not a
//     failure, unless --require-feed is given: that is the owner's own switch);
//   - a published phrase fails the verifier (at least 20 results, 10 with abstracts, 5 from the search year on, none retracted in the top 20, no journal over half): the same thresholds the job
//     asked before it published, asked again now, because a paper can be retracted after; or the search's own retraction check did not answer (nothing then shows that none is retracted);
//   - a phrase's text breaks the rules of a chip (3 to 36 characters, nothing invisible, not small talk, not generic...);
//   - a Try chip finds NOTHING, or finds a retracted paper in its top 20, or no source answered at all (fewer than 10 results, or fewer than 3 with an abstract, is only said).
// It is the weekly check of .github/workflows/trending-live.yml; by hand:
//   node scripts/trending-contract-live.mjs [--base=https://sodhsetu.in] [--pause-ms=2500] [--out=<file.json>] [--phrases="a,b"] [--require-feed] [--no-try]
// BASE_URL in the environment is the default of --base. --phrases adds phrases to check by hand with the full verifier. Nothing is sent to anyone but the address given; one search every 2.5
// seconds (the public limit is 60 a minute). It reads no key and writes no file but --out and, in a workflow, the step summary and the `detail` output the alert issue quotes.
import { appendFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const UA = "sodhsetu-trending-contract/1 (weekly check of our own site)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIN_GLOBAL = 8;
/** A Try chip that finds fewer than this is not a failure, but is said. */
const TRY_FEW = { results: 10, abstracts: 3 };

/**
 * What one search says about one phrase. `kind` "trending" (a published chip) and "hand" (a phrase given on the command line) are held to the whole verifier (T.verifySummary); a "try" chip only
 * has to find something, find no retracted paper in its top 20, and have been answered by some source (it is an evergreen search that the owner chose, and its recent-papers count is not the point).
 * `found` is the search's answer as the API gives it, or null when the call itself failed. Pure; T is the shared trending module (the script bundles it; the unit test imports it).
 */
export function judgeSearch(T, kind, found, sinceYear) {
  if (!found || typeof found !== "object" || !Array.isArray(found.results)) return { answered: false, summary: null, ok: false, failures: ["the search could not be read"], warnings: [] };
  const providers = Object.entries(found.providers ?? {});
  const answered = providers.some(([, p]) => p && p.ok === true);
  const summary = T.summarizeSearch(found.results, sinceYear);
  if (!answered) return { answered, summary, ok: false, failures: ["no source answered the search"], warnings: [] };
  const failures = [];
  const warnings = [];
  const checked = T.retractionChecked(found); // when Crossref did not answer, "no retracted paper" has not been shown
  if (kind === "try") {
    if (summary.total === 0) failures.push("found nothing");
    if (summary.retracted > 0) failures.push(`${summary.retracted} retracted paper${summary.retracted === 1 ? "" : "s"} in the top 20`);
    if (summary.total > 0 && summary.total < TRY_FEW.results) warnings.push(`only ${summary.total} results`);
    if (summary.total > 0 && summary.withAbstract < TRY_FEW.abstracts) warnings.push(`only ${summary.withAbstract} with an abstract in the top 20`);
  } else {
    failures.push(...T.verifySummary(summary).failures.map((f) => f.replace(/_/g, " ")));
    if (!checked) failures.push("the retraction check did not answer");
  }
  if (kind === "try" && !checked) warnings.push("the retraction check did not answer");
  const failed = providers.filter(([, p]) => !p || p.ok !== true).map(([name]) => name);
  if (failed.length > 0) warnings.push(`did not answer: ${failed.join(", ")}`);
  return { answered, summary, ok: failures.length === 0, failures, warnings };
}

/**
 * What the page would do with the file the route answered. `raw` is the JSON; `TC` is the page's own reader (packages/shared/src/trending-client.ts) and `T` the server's rules. The problems are
 * what make the run fail; `chips` is what is to be searched. A switched-off file is `state: "off"`, and a problem only with `requireFeed`.
 */
export function judgeFeed(T, TC, raw, now, { requireFeed = false } = {}) {
  const file = TC.parseTrending(raw);
  if (!file) return { state: "unreadable", problems: ["the page's own reader does not accept the file"], chips: [] };
  if (file.disabled) return { state: "off", problems: requireFeed ? ["the feed is switched off (disabled: true) and --require-feed was given"] : [], chips: [], file };
  if (!TC.isFresh(file, now)) return { state: "stale", problems: [`the file is expired or its pool is too old (validUntil ${file.validUntil}, pool of ${file.poolAsOf}): the page shows no Trending row, so the daily job has not made a file`], chips: [], file };
  const problems = [];
  const chips = [];
  for (const group of ["global", "in"]) {
    for (const c of file.groups[group].chips) {
      const text = T.chipTextProblem(c.text);
      if (text) problems.push(`the text of "${String(c.text).slice(0, 40)}" breaks a chip rule (${text})`);
      chips.push({ group, text: c.text, sinceYear: c.sinceYear, a: c.a, b: c.b, field: c.field });
    }
  }
  if (file.groups.global.chips.length < MIN_GLOBAL) problems.push(`only ${file.groups.global.chips.length} phrases for everyone, at least ${MIN_GLOBAL} are needed`);
  return { state: "fresh", problems, chips, file };
}

/**
 * One `name=value` line for the workflow's output file (GITHUB_OUTPUT): the value on a single line (every run of white space, line breaks included, becomes one space) and at most 400 characters.
 * A message with a second line (an esbuild failure has several) is not `name=value` and the runner refuses the whole file.
 */
export const outputLine = (name, value) => `${name}=${String(value).replace(/\s+/g, " ").trim().slice(0, 400)}`;

/** The short line the alert issue quotes: what failed, in at most 400 characters. */
export const detailLine = (problems, results) =>
  [...problems, ...results.filter((r) => !r.ok).map((r) => `${r.kind} "${r.text}"${r.group === "in" ? " (India)" : ""}: ${r.failures.join(", ")}`)]
    .join("; ")
    .slice(0, 400);

/* ---------------------------------------------------------------- the run (only when this file is run, not when it is imported) */

async function getJson(url, tries = 3, timeoutMs = 60_000) {
  let reason = "no answer";
  for (let i = 0; i < tries; i++) {
    let res = null;
    try {
      res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
      const text = await res.text();
      if (res.ok) return { ok: true, status: res.status, json: JSON.parse(text) };
      reason = `HTTP ${res.status}`;
      if (res.status !== 429 && res.status < 500) return { ok: false, status: res.status, reason };
    } catch (e) {
      reason = res && res.ok ? "the answer is not JSON" : e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError") ? `no answer within ${timeoutMs / 1000} s` : "could not connect";
    }
    if (i < tries - 1) await sleep(res && res.status === 429 ? Math.min(60_000, (Number(res.headers.get("retry-after")) || 20) * 1000) : 3000);
  }
  return { ok: false, reason };
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name, fallback = "") => {
    const hit = args.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
  };
  const base = (flag("base", process.env.BASE_URL ?? "https://sodhsetu.in") || "https://sodhsetu.in").replace(/[/]+$/, "");
  const pauseMs = Math.max(1000, Number(flag("pause-ms", "2500")) || 2500);
  const out = flag("out");
  const requireFeed = args.includes("--require-feed");
  const phrases = flag("phrases").split(",").map((s) => s.trim()).filter(Boolean);

  // the product's own rules, bundled from the repository: the verifier and the chip text rules, the page's own reader of the file, and the bundled Try chips
  const { build } = await import("esbuild");
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const outfile = join(tmpdir(), `trending-contract-${process.pid}.mjs`);
  await build({
    stdin: {
      resolveDir: join(root, "apps/api"),
      sourcefile: "trending-contract-entry.ts",
      loader: "ts",
      contents: ['export * as T from "@scholar/shared/src/trending";', 'export * as TC from "@scholar/shared/src/trending-client";', 'export * as S from "../web/src/workspace/starters";'].join("\n"),
    },
    bundle: true,
    format: "esm",
    platform: "node",
    outfile,
    logLevel: "silent",
  });
  const { T, TC, S } = await import(pathToFileURL(outfile).href);
  // a chip that is not English is sent through Auto, which translates it (so only a signed-in reader is offered it): searched as its words stand, here, it would be another search than the page makes
  const tries = Array.isArray(S.STARTERS) ? S.STARTERS.filter((t) => typeof t === "string" && (typeof S.inEnglish !== "function" || S.inEnglish(t))) : [];
  if (tries.length === 0) throw new Error("apps/web/src/workspace/starters.ts exports no STARTERS list of texts: this check reads the bundled Try chips from it");

  const now = Date.now();
  const thisYear = new Date(now).getUTCFullYear();
  const problems = [];
  console.log(`Trending contract against ${base}, ${new Date(now).toISOString()}`);

  // 1. the file
  const feed = await getJson(`${base}/api/v1/home/trending`);
  let verdict = { state: "unreachable", problems: [], chips: [] };
  if (!feed.ok) problems.push(`the feed could not be read: ${feed.reason}`);
  else {
    verdict = judgeFeed(T, TC, feed.json, now, { requireFeed });
    problems.push(...verdict.problems);
  }
  console.log(`  the file: ${verdict.state}${verdict.file ? `, asOf ${verdict.file.asOf}, ${verdict.file.groups.global.chips.length} for everyone and ${verdict.file.groups.in.chips.length} for India` : ""}`);

  // 2. what is to be searched: the published phrases (their own scope), the bundled Try chips, and the phrases given by hand
  const jobs = [
    ...verdict.chips.map((c) => ({ kind: "trending", group: c.group, text: c.text, sinceYear: c.sinceYear })),
    ...(args.includes("--no-try") ? [] : tries.map((text) => ({ kind: "try", group: "global", text, sinceYear: thisYear - 1 }))),
    ...phrases.map((text) => ({ kind: "hand", group: "global", text, sinceYear: thisYear - 1 })),
  ];
  const results = [];
  let first = true;
  for (const j of jobs) {
    if (!first) await sleep(pauseMs);
    first = false;
    const url = `${base}/api/v1/search?${new URLSearchParams({ q: j.text, limit: "40", scope: j.group === "in" ? "india" : "all" })}`;
    const t0 = Date.now();
    const got = await getJson(url);
    const judged = got.ok ? judgeSearch(T, j.kind, got.json, j.sinceYear) : { answered: false, summary: null, ok: false, failures: [`the search failed: ${got.reason}`], warnings: [] };
    const r = { ...j, ...judged, ms: Date.now() - t0 };
    results.push(r);
    const s = r.summary;
    console.log(`  ${r.ok ? "ok  " : "FAIL"} ${r.kind.padEnd(8)} ${r.group === "in" ? "IN " : "   "}${j.text.slice(0, 40).padEnd(41)}${s ? `${String(s.total).padStart(3)} results, ${String(s.withAbstract).padStart(2)} abstracts, ${String(s.recent).padStart(2)} recent, ${s.retracted} retracted, top venue ${Math.round(s.topVenueShare * 100)}%` : "no numbers"}${r.failures.length ? `  <- ${r.failures.join(", ")}` : ""}${r.warnings.length ? `  (${r.warnings.join("; ")})` : ""}`);
  }

  const failed = results.filter((r) => !r.ok);
  const detail = detailLine(problems, results);
  const ok = problems.length === 0 && failed.length === 0;
  console.log(`\n${ok ? "PASS" : "FAIL"}: ${results.length} searches, ${failed.length} failed${problems.length ? `, ${problems.length} problem${problems.length === 1 ? "" : "s"} with the file` : ""}.`);
  for (const p of problems) console.log(`  - ${p}`);

  if (out) writeFileSync(out, JSON.stringify({ checkedAt: new Date(now).toISOString(), base, ok, feed: { state: verdict.state, problems, file: verdict.file ?? null }, results: results.map(({ kind, group, text, sinceYear, answered, summary, ok: good, failures, warnings, ms }) => ({ kind, group, text, sinceYear, answered, summary, ok: good, failures, warnings, ms })) }, null, 1));
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = results.map((r) => `| ${r.ok ? "ok" : "**FAIL**"} | ${r.kind}${r.group === "in" ? " (India)" : ""} | ${r.text.replace(/[|]/g, " ")} | ${r.summary ? `${r.summary.total} / ${r.summary.withAbstract} / ${r.summary.recent} / ${r.summary.retracted}` : "-"} | ${[...r.failures, ...r.warnings].join("; ")} |`);
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, [`## Trending contract: ${ok ? "pass" : "FAIL"}`, "", `File: ${verdict.state}${problems.length ? ` (${problems.join("; ")})` : ""}`, "", "| | kind | phrase | results / abstracts / recent / retracted | |", "|---|---|---|---|---|", ...rows, ""].join("\n"));
  }
  if (process.env.GITHUB_OUTPUT && !ok) appendFileSync(process.env.GITHUB_OUTPUT, `${outputLine("detail", detail)}\n`);
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`The check could not run: ${e instanceof Error ? e.message : String(e)}`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${outputLine("detail", `the check could not run: ${e instanceof Error ? e.message : String(e)}`)}\n`);
    process.exit(1);
  });
}
