// One command that proves the Worker works end to end, locally or in CI: for each run, a fresh local D1 -> migrations -> a real Worker (wrangler dev) + the fake identity provider -> the suites.
//
//   npm run integration -w apps/api                       # needs `npm run build` first (the Worker serves apps/web/dist)
//   node scripts/integration.mjs [--browser] [--only=<label part>[,...]] [--run=<name>[,<name>...] | --run=all]
//
// What runs is data (scripts/lib/suites.mjs, docs/design/untangle.md F24): the suites, each with its file, whether it needs a browser (--browser; a Chrome or Edge, E2E_BROWSER), whether the
// account tables are emptied before it, and the switch positions it is written for; and the runs. The default run is production's positions (decision 13: wrangler.jsonc's vars as committed,
// TRENDING off, MCP beta); each named run (--run=trending-on, trending-dark, mcp-on, mcp-off, chat-...) starts its own Worker with other positions and runs the suites written for them.
// A suite whose positions a run does not give is skipped there with a line saying which named run has it.
//
// Variables (all optional): INTEGRATION_PORT (the Worker, default 8788) and INTEGRATION_IDP_PORT (the fake identity provider, default 9911), so that two runs can go side by side;
// INTEGRATION_VARS="NAME:value,..." puts switches on top of a run's own; INTEGRATION_TRENDING=<position> and INTEGRATION_MCP=<position> are short for the trending and MCP switches
// (INTEGRATION_MCP takes MCP_CHECK_CLAIM with it, off with off and on otherwise). REAL_PDFS=<folder> [REAL_VERIFY=1] adds the real-papers browser suite.
//
// It uses a generated copy of wrangler.jsonc (scripts/lib/test-worker.mjs) and a throwaway state folder, so it never touches your dev database.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { RUNS, FOLLOWS, tableProblems, suitesOf, resetTables } from "./lib/suites.mjs";
import { startTestWorker, localConfig } from "./lib/test-worker.mjs";
import { position, WORKER_PORT } from "./lib/harness.mjs";

const apps = fileURLToPath(new URL("../../", import.meta.url));
const withBrowser = process.argv.includes("--browser");
// --only=<substring of a suite label> runs just the matching suites, e.g. --only="browser: auth" (several: --only="operations,browser: idea")
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
const runArg = process.argv.find((a) => a.startsWith("--run="))?.slice(6) ?? "default";
const runNames = runArg === "all" ? Object.keys(RUNS) : runArg.split(",").filter(Boolean);

const problems = tableProblems();
for (const n of runNames) if (!RUNS[n]) problems.push(`no run named ${n} (there are: ${Object.keys(RUNS).join(", ")}, all)`);
if (problems.length) {
  console.error("scripts/lib/suites.mjs does not match the suites on disk:\n  " + problems.join("\n  "));
  process.exit(1);
}

/** The switches the environment puts on top of every run's own. */
const fromEnv = {
  ...(process.env.INTEGRATION_TRENDING ? { TRENDING: process.env.INTEGRATION_TRENDING } : {}),
  ...(process.env.INTEGRATION_MCP ? { MCP: process.env.INTEGRATION_MCP, MCP_CHECK_CLAIM: process.env.INTEGRATION_MCP === "off" ? "off" : "on" } : {}),
  ...Object.fromEntries((process.env.INTEGRATION_VARS ?? "").split(",").filter(Boolean).map((p) => [p.slice(0, p.indexOf(":")), p.slice(p.indexOf(":") + 1)])),
};

// Suites sign the same fake users in and out, so each one starts from empty account tables. Done through the Worker (a dev-only route), never by writing to the database file from a
// second process while the Worker has it open: that made `wrangler dev` spin at 100% CPU and stop answering. The tables come from the migrations (scripts/lib/suites.mjs, resetTables).
const RESET = resetTables().map((t) => `DELETE FROM ${t}`);
const resetAccounts = async (url) => {
  // This process has been idle for the length of the previous suite, and the server has closed the connection it kept: a second try opens a new one.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${url}/api/v1/dev/sql`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sql: RESET }) });
      return res.ok;
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
};

/** Why a suite does not run in this run with these positions (null: it runs). */
const notHere = (suite, suiteVars) => {
  if (suite.browser && !withBrowser) return "browser";
  if (only && !only.split(",").some((o) => suite.label.includes(o))) return "only";
  if (suite.when && !process.env[suite.when.env]) return "when";
  for (const [sw, positions] of Object.entries(suite.needs ?? {})) {
    const p = position(sw, suiteVars);
    if (!positions.includes(p)) {
      const elsewhere = Object.entries(RUNS).filter(([, r]) => (r.suites ?? []).includes(suite.label)).map(([n]) => n);
      return `skipped: written for ${sw} ${positions.join(" or ")}, this run has ${p} (it runs in --run=${elsewhere.join(", --run=")})`;
    }
  }
  return null;
};

const runSuite = async (suite, worker) => {
  console.log(`\n=== ${suite.label}`);
  if (suite.reset && !(await resetAccounts(worker.url))) throw new Error("could not reset the local accounts between suites");
  const args = suite.file === "web/e2e/real-papers.mjs" ? [process.env.REAL_PDFS, worker.url, ...(process.env.REAL_VERIFY ? ["--verify"] : [])] : [];
  const cwd = `${apps}${suite.file.split("/")[0]}`;
  // Not spawnSync: that stops this process's event loop for the whole suite, so the Worker's log pipe is no longer read, and once it is full (about 175 KB on Windows: a suite of three
  // minutes and more) the Worker stops answering. An async child keeps the loop, and the pipe, going.
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, [suite.file.split("/").slice(1).join("/"), ...args], {
      cwd, stdio: "inherit",
      env: { ...process.env, APP: worker.url, INTEGRATION_PORT: String(worker.port), INTEGRATION_IDP_PORT: String(worker.idpPort), INTEGRATION_VARS: Object.entries(worker.suiteVars).map(([k, v]) => `${k}:${v}`).join(",") },
    });
    child.on("error", (e) => { console.error(`could not start ${suite.file}: ${e.message}`); resolve(1); });
    child.on("close", (c) => resolve(c ?? 1)); // a suite that was killed by a signal has no exit code: that is a failure
  });
  return code === 0;
};

let ok = true;
for (const name of runNames) {
  const run = RUNS[name];
  const switchVars = { ...run.vars, ...fromEnv };
  const planned = suitesOf(name);
  // positions as the suites will be told them: the committed vars under the run's (known before the Worker starts, to skip a run with nothing to do)
  const preview = { ...localConfig().vars, ...switchVars };
  const reasons = planned.map((s) => [s, notHere(s, preview)]);
  const toRun = reasons.filter(([, r]) => r === null).map(([s]) => s);
  console.log(`\n##### run ${name}: ${run.why}${Object.keys(switchVars).length ? ` (${Object.entries(switchVars).map(([k, v]) => `${k}:${v}`).join(",")})` : ""}`);
  for (const [s, r] of reasons) if (r?.startsWith("skipped")) console.log(`--- ${s.label}: ${r}`);
  if (!toRun.length) continue;
  let worker;
  try {
    worker = await startTestWorker({ switchVars, follows: FOLLOWS, port: WORKER_PORT });
    for (const s of toRun) ok = (await runSuite(s, worker)) && ok;
  } catch (e) {
    console.error(e.message);
    ok = false;
  } finally {
    await worker?.stop();
  }
}
console.log(ok ? "\nintegration: all passed" : "\nintegration: FAILED");
process.exit(ok ? 0 : 1);
