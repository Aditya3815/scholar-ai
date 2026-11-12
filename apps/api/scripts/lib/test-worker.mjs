// A real Worker for the integration suites: a copy of wrangler.jsonc made fit for a local run, a fresh local D1 with every migration, and `wrangler dev` with the test variables and a run's
// switch positions (docs/design/untangle.md, F24). The ports, the state folder and the generated config follow INTEGRATION_PORT and INTEGRATION_IDP_PORT (scripts/lib/harness.mjs), so two runs
// can go side by side on different ports.
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseJsonc } from "./jsonc.mjs";
import { IDP_PORT, IDP_SECRET, IDP_URL, WORKER_PORT } from "./harness.mjs";

const api = fileURLToPath(new URL("../../", import.meta.url));
const isWin = process.platform === "win32";

/** A made-up account id for MCP_BETA_USERS (in production a Worker secret): the Worker runs with MCP "beta" as production does, with a beta list that names no real account. */
export const TEST_BETA_USER = "integration-beta-user";

/**
 * wrangler.jsonc as a local run can use it: no Workers AI binding (remote-only, it needs a login, and nothing under test uses it), no account, no cron trigger (the suites fire it through
 * /cdn-cgi/handler/scheduled), no production route (`wrangler dev` would take the Worker's address from the own domain and the sign-in's redirects would leave for it), a local namespace in
 * place of the real OAUTH_KV, and every rate limit raised out of reach (all test clients share one IP and send far more than a person's budget). The committed `vars` stay: they are the
 * positions of production, which the default run tests.
 */
export function localConfig() {
  const cfg = parseJsonc(readFileSync(`${api}wrangler.jsonc`, "utf8"));
  delete cfg.ai;
  delete cfg.account_id;
  delete cfg.triggers;
  delete cfg.routes;
  delete cfg.workers_dev;
  cfg.kv_namespaces = [...(cfg.kv_namespaces ?? []).filter((k) => k.binding !== "OAUTH_KV"), { binding: "OAUTH_KV", id: "oauth-kv-local" }];
  for (const r of cfg.ratelimits ?? []) r.simple.limit = 1_000_000;
  return cfg;
}

/** The variables every test Worker gets besides its switches: the fake sign-in, the dev routes and the offline stand-ins, a short keep-alive, and no Sentry. */
export function testVars() {
  return {
    GOOGLE_CLIENT_ID: "dev", GOOGLE_CLIENT_SECRET: IDP_SECRET, ORCID_CLIENT_ID: "dev", ORCID_CLIENT_SECRET: IDP_SECRET,
    // .dev.vars is read by `wrangler dev` too: the tests must never report to the real Sentry project, so its address is blanked here.
    SENTRY_DSN: "",
    DEV_IDP_URL: IDP_URL, ORCID_BASE_URL: `${IDP_URL}/orcid`, ENABLE_DEV_ROUTES: "1", QA_STUB: "1", SSE_KEEPALIVE_MS: "1000", OCR_PAGES_PER_DAY: "25",
    CROSSREF_MAILTO: process.env.CROSSREF_MAILTO ?? "ci@example.com",
    MCP_BETA_USERS: TEST_BETA_USER,
    // Only the browser smoke test searches; it needs the real provider keys (passed through from the environment).
    ...Object.fromEntries(["OPENALEX_API_KEY", "S2_API_KEY", "NCBI_API_KEY"].filter((k) => process.env[k]).map((k) => [k, process.env[k]])),
  };
}

/**
 * Starts the Worker with `switchVars` (a run's positions, on top of the committed vars) and waits until it answers. Returns its address, the switch variables the suites are to be told
 * (`switchVars` over the committed ones: INTEGRATION_VARS), and stop(). `follows` adds variables that follow a switch (scripts/lib/suites.mjs, FOLLOWS).
 */
export async function startTestWorker({ switchVars = {}, follows = [], port = WORKER_PORT } = {}) {
  const state = process.env.INTEGRATION_STATE ?? `.wrangler/integration-state-${port}`;
  const config = process.env.INTEGRATION_CONFIG ?? `wrangler.integration-${port}.jsonc`;
  const cfg = localConfig();
  writeFileSync(`${api}${config}`, JSON.stringify(cfg, null, 2));
  const wrangler = (args) => spawnSync("npx", ["wrangler", ...args], { cwd: api, shell: isWin, stdio: "inherit" });
  rmSync(`${api}${state}`, { recursive: true, force: true });
  if (wrangler(["d1", "migrations", "apply", "scholar-db", "--local", "--config", config, "--persist-to", state]).status !== 0) throw new Error("the migrations did not apply");

  const suiteVars = { ...cfg.vars, ...switchVars };
  const followed = Object.assign({}, ...follows.filter((f) => Object.entries(f.when).every(([k, ps]) => ps.includes(suiteVars[k]))).map((f) => f.vars));
  const vars = { ...testVars(), ...switchVars, ...followed };
  const server = spawn("npx", ["wrangler", "dev", "--config", config, "--port", String(port), "--inspector-port", String(port + 1000), "--persist-to", state, "--test-scheduled", ...Object.entries(vars).flatMap(([k, v]) => ["--var", `${k}:${v}`])], {
    cwd: api, shell: isWin, stdio: ["ignore", "pipe", "pipe"], detached: !isWin,
  });
  let log = "";
  // only the end of it is ever read (to say why the Worker did not start), so it is kept short however long the run is
  for (const s of [server.stdout, server.stderr]) s.on("data", (d) => { log = (log + d).slice(-65536); });
  const url = `http://localhost:${port}`;
  const stop = () => {
    if (server.exitCode === null) {
      if (isWin) spawnSync("taskkill", ["/T", "/F", "/PID", String(server.pid)], { stdio: "ignore" });
      else try { process.kill(-server.pid, "SIGTERM"); } catch { /* already gone */ }
    }
    rmSync(`${api}${config}`, { force: true });
  };
  process.on("exit", stop);
  try {
    for (let i = 0; ; i++) {
      if (server.exitCode !== null) throw new Error("wrangler dev exited early:\n" + log);
      if (i >= 90) throw new Error("Worker did not become healthy in 90 s:\n" + log);
      try { if ((await fetch(`${url}/api/v1/health`)).ok) break; } catch { /* not up yet: deliberate, the loop asks again */ }
      await new Promise((r) => setTimeout(r, 1000));
    }
  } catch (e) {
    stop();
    throw e;
  }
  return { url, port, idpPort: IDP_PORT, suiteVars, vars, stop };
}
