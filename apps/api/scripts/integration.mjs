// One command that proves the Worker works end to end, locally or in CI:
//   fresh local D1 -> migrations -> real Worker (wrangler dev) + fake identity provider -> auth and library integration tests
//   (add --browser to also run the three Playwright suites; needs a Chrome/Edge install, see E2E_BROWSER)
//
//   npm run integration -w apps/api           # needs `npm run build` first (the Worker serves apps/web/dist)
//
// It uses a generated copy of wrangler.jsonc without the Workers AI binding (that binding is remote-only and needs a login,
// and nothing under test uses it) and a throwaway state directory, so it never touches your dev database.
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const api = fileURLToPath(new URL("..", import.meta.url));
const web = fileURLToPath(new URL("../../web", import.meta.url));
// The port, the state folder and the generated config can be changed (INTEGRATION_PORT, INTEGRATION_STATE, INTEGRATION_CONFIG) so a second run can live beside another Worker that holds 8788.
const PORT = Number(process.env.INTEGRATION_PORT ?? 8788);
const STATE = process.env.INTEGRATION_STATE ?? ".wrangler/integration-state";
const CONFIG = process.env.INTEGRATION_CONFIG ?? "wrangler.integration.jsonc";
const withBrowser = process.argv.includes("--browser");
// --only=<substring of a suite label> runs just the matching suites, e.g. --only="browser: auth" (several: --only="operations,browser: idea")
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
const isWin = process.platform === "win32";

// wrangler.jsonc only has whole-line // comments, so a line filter is enough to read it as JSON.
const cfg = JSON.parse(readFileSync(`${api}wrangler.jsonc`, "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n"));
delete cfg.ai;
delete cfg.account_id;
delete cfg.triggers;
// The own domain is a production route: kept in the test copy, `wrangler dev` takes the Worker's address from it, and the login's redirects then leave for the real domain.
delete cfg.routes;
delete cfg.workers_dev;
// The committed launch state "TRENDING": "off" (wrangler.jsonc) hides the Home page's list from the route; the suites read the list, so the copy has no such line. INTEGRATION_TRENDING=dark or =off puts one back (below).
if (cfg.vars) delete cfg.vars.TRENDING;
// The MCP server (src/mcp) needs a KV namespace of its own (OAUTH_KV in wrangler.jsonc): the test copy swaps in a local one, never the real namespace's id, and the switch on
// (INTEGRATION_MCP=off leaves it off, to see the paths answer 404 as before), so that scripts/mcp-e2e.mjs can go through the whole OAuth and MCP exchange.
cfg.kv_namespaces = [...(cfg.kv_namespaces ?? []).filter((k) => k.binding !== "OAUTH_KV"), { binding: "OAUTH_KV", id: "oauth-kv-local" }];
// Keep the limiter bindings (so their wiring is exercised) but make them effectively unlimited: every request from the test
// clients shares one IP, and the suites send far more than the production per-IP budget.
for (const r of cfg.ratelimits ?? []) r.simple.limit = 1_000_000;
writeFileSync(`${api}${CONFIG}`, JSON.stringify(cfg, null, 2));

const wrangler = (args, opts = {}) => spawnSync("npx", ["wrangler", ...args], { cwd: api, shell: isWin, stdio: "inherit", ...opts });

rmSync(`${api}${STATE}`, { recursive: true, force: true });
if (wrangler(["d1", "migrations", "apply", "scholar-db", "--local", "--config", CONFIG, "--persist-to", STATE]).status !== 0) process.exit(1);

// INTEGRATION_VARS="NAME:value,NAME:value", read once: the Worker gets them, and the floor's stand-in switch above follows CHAT_FLOOR
const integrationVars = Object.fromEntries((process.env.INTEGRATION_VARS ?? "").split(",").filter(Boolean).map((p) => [p.slice(0, p.indexOf(":")), p.slice(p.indexOf(":") + 1)]));
const vars = {
  GOOGLE_CLIENT_ID: "dev", GOOGLE_CLIENT_SECRET: "dev-secret", ORCID_CLIENT_ID: "dev", ORCID_CLIENT_SECRET: "dev-secret",
  // .dev.vars is read by `wrangler dev` too: the tests must never report to the real Sentry project, so its address is blanked here.
  SENTRY_DSN: "",
  DEV_IDP_URL: "http://localhost:9911", ORCID_BASE_URL: "http://localhost:9911/orcid", ENABLE_DEV_ROUTES: "1", QA_STUB: "1", SSE_KEEPALIVE_MS: "1000", OCR_PAGES_PER_DAY: "25",
  CROSSREF_MAILTO: process.env.CROSSREF_MAILTO ?? "ci@example.com",
  // INTEGRATION_TRENDING=off (or =dark) starts the Worker with the variable TRENDING=off (or dark) (run it with --only="trending": scripts/trending-e2e.mjs then checks that switch instead of the others)
  ...(process.env.INTEGRATION_TRENDING ? { TRENDING: process.env.INTEGRATION_TRENDING } : {}),
  MCP: process.env.INTEGRATION_MCP ?? "on",
  // check_claim has a switch of its own (src/mcp/flag.ts), off in production: on here, so that scripts/mcp-e2e.mjs reaches the tool (it follows MCP: off with the server off)
  MCP_CHECK_CLAIM: process.env.INTEGRATION_MCP === "off" ? "off" : "on",
  // INTEGRATION_VARS="CHAT_COUNTERS:on,CHAT_FAILPOLICY:shadow" starts the Worker with those variables too (the gate flags of docs/design/intent-and-state.md are unset in wrangler.jsonc, so a default run tests them OFF);
  // the suites read the same variable to know which position they are looking at (run it with --only="chat integration" to see the flags work on the real database)
  ...integrationVars,
  // R9 (CHAT_FLOOR=writer or on): the stand-in search then writes the words of every question into its records (src/chat/stub.ts), so that the suites, which ask about anything, meet a relevant list and not the stand-in's five glaucoma
  // records for every question; the word "offtopic" in a question keeps those records, which is how the floor's own checks get a list in which no paper matches. Without the floor acting the stand-in is what it always was.
  ...(["writer", "on"].includes(integrationVars.CHAT_FLOOR) ? { QA_STUB_TOPIC: "1" } : {}),
  // Only the browser smoke test searches; it needs the real provider keys (passed through from the environment).
  ...Object.fromEntries(["OPENALEX_API_KEY", "S2_API_KEY", "NCBI_API_KEY"].filter((k) => process.env[k]).map((k) => [k, process.env[k]])),
};
const server = spawn("npx", ["wrangler", "dev", "--config", CONFIG, "--port", String(PORT), "--persist-to", STATE, "--test-scheduled", ...Object.entries(vars).flatMap(([k, v]) => ["--var", `${k}:${v}`])], {
  cwd: api, shell: isWin, stdio: ["ignore", "pipe", "pipe"], detached: !isWin,
});
let log = "";
// only the end of it is ever read (to say why the Worker did not start), so it is kept short however long the run is
for (const s of [server.stdout, server.stderr]) s.on("data", (d) => { log = (log + d).slice(-65536); });

const stop = () => {
  if (server.exitCode !== null) return;
  if (isWin) spawnSync("taskkill", ["/T", "/F", "/PID", String(server.pid)], { stdio: "ignore" });
  else try { process.kill(-server.pid, "SIGTERM"); } catch { /* already gone */ }
};
process.on("exit", stop);
process.on("SIGINT", () => process.exit(130));

async function waitForHealth() {
  for (let i = 0; i < 90; i++) {
    if (server.exitCode !== null) throw new Error("wrangler dev exited early:\n" + log);
    try { if ((await fetch(`http://localhost:${PORT}/api/v1/health`)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Worker did not become healthy in 90 s:\n" + log);
}

// Suites sign the same fake users in and out, so each one starts from an empty account table. Done through the Worker (a dev-only route), never by
// writing to the database file from a second process while the Worker has it open: that made `wrangler dev` spin at 100% CPU and stop answering.
const resetAccounts = async () => {
  const tables = ["litscan_shares", "litscan_events", "litscans", "litscan_daily", "library_items", "sessions", "identities", "users", "oauth_states", "audit_log"];
  // This process has been idle for the length of the previous suite, and the server has closed the connection it kept: a second try opens a new one.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`http://localhost:${PORT}/api/v1/dev/sql`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sql: tables.map((t) => `DELETE FROM ${t}`) }) });
      return res.ok;
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
};

const run = async (label, file, args = [], cwd = api) => {
  if (only && !only.split(",").some((o) => label.includes(o))) return true;
  console.log(`
=== ${label}`);
  if (!(await resetAccounts())) throw new Error("could not reset the local accounts between suites");
  // Not spawnSync: that stops this process's event loop for the whole suite, so the `data` handlers above stop reading the Worker's log pipe, and once the pipe is full (about 175 KB on
  // Windows: a suite of three minutes and more) the Worker stops answering (pending requests, 30 s timeouts at a different step each run). An async child keeps the loop, and the pipe, going.
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, [file, ...args], { cwd, stdio: "inherit", env: { ...process.env, APP: `http://localhost:${PORT}` } });
    child.on("error", (e) => { console.error(`could not start ${file}: ${e.message}`); resolve(1); });
    child.on("close", (c) => resolve(c ?? 1)); // a suite that was killed by a signal has no exit code: that is a failure
  });
  return code === 0;
};

let ok = true;
try {
  await waitForHealth();
  ok = await run("auth integration", "scripts/auth-e2e.mjs") && ok;
  ok = await run("library integration", "scripts/library-e2e.mjs") && ok;
  ok = await run("retraction re-check integration", "scripts/retraction-e2e.mjs") && ok;
  ok = await run("documents integration", "scripts/docs-e2e.mjs") && ok;
  ok = await run("scanned papers integration", "scripts/scan-e2e.mjs") && ok;
  ok = await run("public cache integration", "scripts/cache-e2e.mjs") && ok;
  ok = await run("trending list integration", "scripts/trending-e2e.mjs") && ok;
  ok = await run("shared lane integration", "scripts/gate-e2e.mjs") && ok;
  ok = await run("idea check integration", "scripts/idea-e2e.mjs") && ok;
  ok = await run("chat integration", "scripts/chat-e2e.mjs") && ok;
  ok = await run("open-access papers integration", "scripts/oa-e2e.mjs") && ok;
  ok = await run("literature scan integration", "scripts/litscan-e2e.mjs") && ok;
  ok = await run("feedback integration", "scripts/feedback-e2e.mjs") && ok;
  ok = await run("MCP server integration", "scripts/mcp-e2e.mjs") && ok;
  if (withBrowser) {
    ok = await run("browser: smoke + axe", "e2e/smoke.mjs", [`http://localhost:${PORT}`], web) && ok;
    ok = await run("browser: auth", "e2e/auth.mjs", [`http://localhost:${PORT}`], web) && ok;
    ok = await run("browser: library", "e2e/library.mjs", [`http://localhost:${PORT}`], web) && ok;
    ok = await run("browser: verifier", "e2e/verify.mjs", [`http://localhost:${PORT}`], web) && ok;
    ok = await run("browser: papers", "e2e/papers.mjs", [`http://localhost:${PORT}`], web) && ok;
    ok = await run("browser: scanned papers", "e2e/scan.mjs", [`http://localhost:${PORT}`], web) && ok;
    ok = await run("browser: idea check", "e2e/idea.mjs", [`http://localhost:${PORT}`], web) && ok;
    ok = await run("browser: admin and reports", "e2e/admin.mjs", [`http://localhost:${PORT}`], web) && ok;
    ok = await run("browser: legal pages", "e2e/legal.mjs", [`http://localhost:${PORT}`], web) && ok;
    ok = await run("browser: workspace (new look)", "e2e/workspace.mjs", [`http://localhost:${PORT}`], web) && ok;
    ok = await run("browser: the default look (W6)", "e2e/default.mjs", [`http://localhost:${PORT}`], web) && ok;
    ok = await run("browser: first paint and layout shift (W6)", "e2e/perf.mjs", [`http://localhost:${PORT}`], web) && ok;
    ok = await run("browser: chat (prompt box)", "e2e/chat.mjs", [`http://localhost:${PORT}`], web) && ok;
    ok = await run("browser: chat performance", "e2e/chat-perf.mjs", [`http://localhost:${PORT}`], web) && ok;
    ok = await run("browser: chat script and look (C5, C6)", "e2e/chat-look.mjs", [`http://localhost:${PORT}`], web) && ok;
    ok = await run("browser: chat polish (composer, edge, arrow, Home, no examples)", "e2e/polish-chat.mjs", [`http://localhost:${PORT}`], web) && ok;
    ok = await run("browser: typing in bursts (React update depth)", "e2e/typing-burst.mjs", [`http://localhost:${PORT}`], web) && ok;
    ok = await run("browser: new topic and the did-not-finish line", "e2e/new-topic.mjs", [`http://localhost:${PORT}`], web) && ok;
    ok = await run("browser: the Thinking block and the turn ledger", "e2e/think.mjs", [`http://localhost:${PORT}`], web) && ok;
    ok = await run("browser: the Understand step (what the page draws; the design's examples when CHAT_UNDERSTAND is on)", "e2e/understand.mjs", [`http://localhost:${PORT}`], web) && ok;
    ok = await run("browser: reader polish (back, drawing tools, question box)", "e2e/polish-reader.mjs", [`http://localhost:${PORT}`], web) && ok;
    ok = await run("browser: trending", "e2e/trending.mjs", [`http://localhost:${PORT}`], web) && ok;
    ok = await run("browser: ask any paper", "e2e/oa.mjs", [`http://localhost:${PORT}`], web) && ok;
    ok = await run("browser: literature scan", "e2e/litscan.mjs", [`http://localhost:${PORT}`], web) && ok;
    ok = await run("browser: icon motion", "e2e/icons.mjs", [`http://localhost:${PORT}`], web) && ok;
    ok = await run("browser: Rive pictures", "e2e/rive.mjs", [`http://localhost:${PORT}`], web) && ok;
    ok = await run("browser: idea check in the conversation", "e2e/idea-chat.mjs", [`http://localhost:${PORT}`], web) && ok;
    ok = await run("browser: annotated PDF", "e2e/annotated.mjs", [`http://localhost:${PORT}`], web) && ok;
    ok = await run("browser: offline reading", "e2e/offline.mjs", [`http://localhost:${PORT}`], web) && ok;
    ok = await run("browser: parked features", "e2e/parked.mjs", [`http://localhost:${PORT}`], web) && ok;
    ok = await run("browser: AI apps (MCP consent and Connected apps)", "e2e/mcp.mjs", [`http://localhost:${PORT}`], web) && ok;
    // Only when asked for (needs real PDFs, live Crossref/OpenAlex and a few minutes): REAL_PDFS=<folder> [REAL_VERIFY=1]
    if (process.env.REAL_PDFS) ok = await run("browser: real papers", "e2e/real-papers.mjs", [process.env.REAL_PDFS, `http://localhost:${PORT}`, ...(process.env.REAL_VERIFY ? ["--verify"] : [])], web) && ok;
  }
  // Last on purpose: it changes the local database from a second process (renames tables, ages rows), which the browser suites should not have to live with.
  ok = await run("operations integration", "scripts/ops-e2e.mjs") && ok;
} catch (e) {
  console.error(e.message);
  ok = false;
}
stop();
rmSync(`${api}${CONFIG}`, { force: true });
console.log(ok ? "\nintegration: all passed" : "\nintegration: FAILED");
process.exit(ok ? 0 : 1);
