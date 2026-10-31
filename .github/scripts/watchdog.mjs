// Hourly check of the live service from outside: is it up, is its database migrated, did the daily job run, is the web app being served.
//   BASE_URL=https://sodhsetu.in node .github/scripts/watchdog.mjs
// Each check is tried a few times before it counts as failed, so one dropped request does not wake anyone. The exit code is 1 when a check
// failed; a short summary goes to the job summary and to the `detail` output, which the alert issue quotes.
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const CHECKS = [
  { name: "service", path: "/api/v1/health", kind: "json", test: (j) => j?.ok === true && j?.db === "ok" && j?.migrations > 0, why: (j) => `ok=${j?.ok} db=${j?.db} migrations=${j?.migrations}` },
  { name: "daily job", path: "/api/v1/health/jobs", kind: "json", test: (j) => j?.ok === true, why: (j) => (j?.jobs ?? []).map((x) => `${x.name}: ${x.state}`).join(", ") || (j?.error ? `error=${j.error}` : "no detail") },
  { name: "web app", path: "/", kind: "html", test: (t) => /<!doctype html/i.test(t.slice(0, 200)) && /<div id="root"/i.test(t), why: () => "the home page did not look like the app" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One try. Returns {ok, reason}. Never throws. */
export async function tryOnce(base, check, doFetch = fetch, timeoutMs = 10_000) {
  let res;
  try {
    res = await doFetch(new URL(check.path, base), { signal: AbortSignal.timeout(timeoutMs), headers: { "User-Agent": "scholar-watchdog/1", Accept: check.kind === "json" ? "application/json" : "text/html" }, redirect: "manual" });
  } catch (e) {
    return { ok: false, reason: /timeout|abort/i.test(String(e?.name) + String(e?.message)) ? `no answer within ${timeoutMs / 1000} s` : `could not connect (${String(e?.cause?.code ?? e?.message ?? e).slice(0, 80)})` };
  }
  let text = "";
  try {
    text = await res.text();
  } catch {
    return { ok: false, reason: `HTTP ${res.status}, body unreadable` };
  }
  if (res.status !== 200) {
    let extra = "";
    if (check.kind === "json") {
      try {
        extra = ` (${check.why(JSON.parse(text))})`;
      } catch {
        /* not JSON: an error page from the platform */
      }
    }
    return { ok: false, reason: `HTTP ${res.status}${extra}` };
  }
  if (check.kind === "json") {
    let j;
    try {
      j = JSON.parse(text);
    } catch {
      return { ok: false, reason: "HTTP 200 but the answer is not JSON" };
    }
    return check.test(j) ? { ok: true, reason: "ok" } : { ok: false, reason: `HTTP 200 but ${check.why(j)}` };
  }
  return check.test(text) ? { ok: true, reason: "ok" } : { ok: false, reason: `HTTP 200 but ${check.why(text)}` };
}

export async function runChecks({ base, doFetch = fetch, attempts = 3, gapMs = 15_000, wait = sleep, checks = CHECKS }) {
  const results = [];
  for (const check of checks) {
    let last = { ok: false, reason: "not tried" };
    let tries = 0;
    while (tries < attempts) {
      tries++;
      last = await tryOnce(base, check, doFetch);
      if (last.ok) break;
      if (tries < attempts) await wait(gapMs);
    }
    results.push({ name: check.name, path: check.path, ...last, tries });
  }
  return results;
}

export const summary = (results) => results.map((r) => `${r.ok ? "ok  " : "FAIL"} ${r.name} (${r.path}): ${r.reason}${r.tries > 1 ? ` after ${r.tries} tries` : ""}`).join("\n");
export const detailLine = (results) => results.filter((r) => !r.ok).map((r) => `${r.name}: ${r.reason}`).join("; ").slice(0, 400);

export async function main(env = process.env, out = console, doFetch = fetch, wait = sleep) {
  const base = env.BASE_URL;
  if (!base || !/^https:\/\/[^/]+\/?$/.test(base)) {
    out.error("BASE_URL must be an https address such as https://sodhsetu.in");
    return 2;
  }
  const results = await runChecks({ base, doFetch, wait });
  out.log(summary(results));
  const failed = results.some((r) => !r.ok);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `### Watchdog\n\n\`\`\`\n${summary(results)}\n\`\`\`\n`);
  if (env.GITHUB_OUTPUT && failed) appendFileSync(env.GITHUB_OUTPUT, `detail=${detailLine(results)}\n`);
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(await main());
