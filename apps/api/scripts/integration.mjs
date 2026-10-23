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
const PORT = 8788;
const STATE = ".wrangler/integration-state";
const CONFIG = "wrangler.integration.jsonc";
const withBrowser = process.argv.includes("--browser");
// --only=<substring of a suite label> runs just the matching suites, e.g. --only="browser: auth" (several: --only="operations,browser: idea")
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
const isWin = process.platform === "win32";

// wrangler.jsonc only has whole-line // comments, so a line filter is enough to read it as JSON.
const cfg = JSON.parse(readFileSync(`${api}wrangler.jsonc`, "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n"));
delete cfg.ai;
delete cfg.account_id;
delete cfg.triggers;
// Keep the limiter bindings (so their wiring is exercised) but make them effectively unlimited: every request from the test
// clients shares one IP, and the suites send far more than the production per-IP budget.
for (const r of cfg.ratelimits ?? []) r.simple.limit = 1_000_000;
writeFileSync(`${api}${CONFIG}`, JSON.stringify(cfg, null, 2));

const wrangler = (args, opts = {}) => spawnSync("npx", ["wrangler", ...args], { cwd: api, shell: isWin, stdio: "inherit", ...opts });

rmSync(`${api}${STATE}`, { recursive: true, force: true });
if (wrangler(["d1", "migrations", "apply", "scholar-db", "--local", "--config", CONFIG, "--persist-to", STATE]).status !== 0) process.exit(1);

const vars = {
  GOOGLE_CLIENT_ID: "dev", GOOGLE_CLIENT_SECRET: "dev-secret", ORCID_CLIENT_ID: "dev", ORCID_CLIENT_SECRET: "dev-secret",
  // .dev.vars is read by `wrangler dev` too: the tests must never report to the real Sentry project, so its address is blanked here.
  SENTRY_DSN: "",
  DEV_IDP_URL: "http://localhost:9911", ORCID_BASE_URL: "http://localhost:9911/orcid", ENABLE_DEV_ROUTES: "1", QA_STUB: "1", OCR_PAGES_PER_DAY: "25",
  CROSSREF_MAILTO: process.env.CROSSREF_MAILTO ?? "ci@example.com",
  // Only the browser smoke test searches; it needs the real provider keys (passed through from the environment).
  ...Object.fromEntries(["OPENALEX_API_KEY", "S2_API_KEY", "NCBI_API_KEY"].filter((k) => process.env[k]).map((k) => [k, process.env[k]])),
};
const server = spawn("npx", ["wrangler", "dev", "--config", CONFIG, "--port", String(PORT), "--persist-to", STATE, "--test-scheduled", ...Object.entries(vars).flatMap(([k, v]) => ["--var", `${k}:${v}`])], {
  cwd: api, shell: isWin, stdio: ["ignore", "pipe", "pipe"], detached: !isWin,
});
let log = "";
for (const s of [server.stdout, server.stderr]) s.on("data", (d) => { log += d; });

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
  const tables = ["library_items", "sessions", "identities", "users", "oauth_states", "audit_log"];
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
  const r = spawnSync(process.execPath, [file, ...args], { cwd, stdio: "inherit", env: { ...process.env, APP: `http://localhost:${PORT}` } });
  return r.status === 0;
};

let ok = true;
try {
  await waitForHealth();
  ok = await run("auth integration", "scripts/auth-e2e.mjs") && ok;
  ok = await run("library integration", "scripts/library-e2e.mjs") && ok;
  ok = await run("documents integration", "scripts/docs-e2e.mjs") && ok;
  ok = await run("scanned papers integration", "scripts/scan-e2e.mjs") && ok;
  ok = await run("idea check integration", "scripts/idea-e2e.mjs") && ok;
  ok = await run("feedback integration", "scripts/feedback-e2e.mjs") && ok;
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
