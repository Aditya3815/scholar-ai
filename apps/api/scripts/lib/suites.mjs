// The integration suites and the runs that start a Worker for them, as data (docs/design/untangle.md, F24; decision 13). scripts/integration.mjs reads this file and nothing else to know
// what to run; scripts/lib/suites.node-test.mjs (npm run test:scripts) holds it to the folders, so a suite file in no row and in no NOT_RUN line fails there and in the runner.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const apps = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * One row a suite, in the order they run. `file` is relative to apps/; `browser` suites run only with --browser (they need a Chrome or Edge, E2E_BROWSER). `reset`: the account tables are
 * emptied before it (resetStatements below); a suite that signs nobody in leaves them as they are. `needs`: the positions it is written for; in a run where a switch stands elsewhere the suite
 * is skipped there, and it is listed in a named run below that gives it those positions (the table test holds that). `last`: it runs after every other suite of its run, and why.
 * `when`: an environment variable without which it is not run (and what it is).
 */
export const SUITES = [
  { label: "auth integration", file: "api/scripts/auth-e2e.mjs", browser: false, reset: true },
  { label: "library integration", file: "api/scripts/library-e2e.mjs", browser: false, reset: true },
  { label: "retraction re-check integration", file: "api/scripts/retraction-e2e.mjs", browser: false, reset: true },
  { label: "documents integration", file: "api/scripts/docs-e2e.mjs", browser: false, reset: true },
  { label: "scanned papers integration", file: "api/scripts/scan-e2e.mjs", browser: false, reset: true },
  { label: "public cache integration", file: "api/scripts/cache-e2e.mjs", browser: false, reset: true },
  { label: "trending list integration", file: "api/scripts/trending-e2e.mjs", browser: false, reset: false },
  { label: "shared lane integration", file: "api/scripts/gate-e2e.mjs", browser: false, reset: false },
  { label: "idea check integration", file: "api/scripts/idea-e2e.mjs", browser: false, reset: true },
  { label: "chat integration", file: "api/scripts/chat-e2e.mjs", browser: false, reset: true },
  { label: "open-access papers integration", file: "api/scripts/oa-e2e.mjs", browser: false, reset: true },
  { label: "literature scan integration", file: "api/scripts/litscan-e2e.mjs", browser: false, reset: true },
  { label: "feedback integration", file: "api/scripts/feedback-e2e.mjs", browser: false, reset: true },
  // the server's whole OAuth and MCP exchange is written for MCP "on" (every account) and, as a second branch, "off" (404 everywhere); "beta" has no suite of its own yet
  { label: "MCP server integration", file: "api/scripts/mcp-e2e.mjs", browser: false, reset: true, needs: { MCP: ["on", "off"] } },
  // CHAT_TOOLS (docs/design/chat-tools.md): on in wrangler.jsonc, so the suite checks the tools run in the reply; --run=chat-tools-off checks a list is still offered
  { label: "chat tools integration", file: "api/scripts/chat-tools-e2e.mjs", browser: false, reset: true },
  { label: "browser: smoke + axe", file: "web/e2e/smoke.mjs", browser: true, reset: false },
  { label: "browser: auth", file: "web/e2e/auth.mjs", browser: true, reset: true },
  { label: "browser: library", file: "web/e2e/library.mjs", browser: true, reset: true },
  { label: "browser: verifier", file: "web/e2e/verify.mjs", browser: true, reset: false },
  { label: "browser: papers", file: "web/e2e/papers.mjs", browser: true, reset: true },
  { label: "browser: scanned papers", file: "web/e2e/scan.mjs", browser: true, reset: true },
  { label: "browser: idea check", file: "web/e2e/idea.mjs", browser: true, reset: true },
  { label: "browser: admin and reports", file: "web/e2e/admin.mjs", browser: true, reset: true },
  { label: "browser: legal pages", file: "web/e2e/legal.mjs", browser: true, reset: false },
  { label: "browser: workspace (new look)", file: "web/e2e/workspace.mjs", browser: true, reset: true },
  { label: "browser: the default look (W6)", file: "web/e2e/default.mjs", browser: true, reset: true },
  { label: "browser: first paint and layout shift (W6)", file: "web/e2e/perf.mjs", browser: true, reset: false },
  { label: "browser: chat (prompt box)", file: "web/e2e/chat.mjs", browser: true, reset: true },
  { label: "browser: chat performance", file: "web/e2e/chat-perf.mjs", browser: true, reset: true },
  { label: "browser: chat script and look (C5, C6)", file: "web/e2e/chat-look.mjs", browser: true, reset: true },
  { label: "browser: chat polish (composer, edge, arrow, Home, no examples)", file: "web/e2e/polish-chat.mjs", browser: true, reset: true },
  { label: "browser: typing in bursts (React update depth)", file: "web/e2e/typing-burst.mjs", browser: true, reset: true },
  { label: "browser: new topic and the did-not-finish line", file: "web/e2e/new-topic.mjs", browser: true, reset: true },
  { label: "browser: the Thinking block and the turn ledger", file: "web/e2e/think.mjs", browser: true, reset: true },
  { label: "browser: the Understand step (what the page draws; the design's examples when CHAT_UNDERSTAND is on)", file: "web/e2e/understand.mjs", browser: true, reset: true },
  { label: "browser: chat tools (what the page draws for a tool run in the reply)", file: "web/e2e/chat-tools.mjs", browser: true, reset: true },
  { label: "browser: reader polish (back, drawing tools, question box)", file: "web/e2e/polish-reader.mjs", browser: true, reset: true },
  { label: "browser: citation cards in the reader", file: "web/e2e/cites.mjs", browser: true, reset: true },
  // the Home page's Trending row is read from the real route in one section: it is there only with the list shown
  { label: "browser: trending", file: "web/e2e/trending.mjs", browser: true, reset: true, needs: { TRENDING: ["on"] } },
  { label: "browser: ask any paper", file: "web/e2e/oa.mjs", browser: true, reset: true },
  { label: "browser: literature scan", file: "web/e2e/litscan.mjs", browser: true, reset: true },
  { label: "browser: icon motion", file: "web/e2e/icons.mjs", browser: true, reset: false },
  { label: "browser: Rive pictures", file: "web/e2e/rive.mjs", browser: true, reset: true },
  { label: "browser: idea check in the conversation", file: "web/e2e/idea-chat.mjs", browser: true, reset: true },
  { label: "browser: annotated PDF", file: "web/e2e/annotated.mjs", browser: true, reset: true },
  { label: "browser: offline reading", file: "web/e2e/offline.mjs", browser: true, reset: true },
  { label: "browser: parked features", file: "web/e2e/parked.mjs", browser: true, reset: true },
  { label: "browser: AI apps (MCP consent and Connected apps)", file: "web/e2e/mcp.mjs", browser: true, reset: true, needs: { MCP: ["on", "off"] } },
  // needs real PDFs, live Crossref/OpenAlex and a few minutes: REAL_PDFS=<folder> [REAL_VERIFY=1]
  { label: "browser: real papers", file: "web/e2e/real-papers.mjs", browser: true, reset: true, when: { env: "REAL_PDFS", what: "a folder of real PDFs" } },
  // it changes the local database from a second process (renames tables, ages rows), which no later suite should have to live with
  { label: "operations integration", file: "api/scripts/ops-e2e.mjs", browser: false, reset: true, last: "it renames job_runs and audit_log and ages the job's rows from a second process" },
];

/** Suite files that no run starts, each with the reason. Everything else under api/scripts/*-e2e.mjs and web/e2e/*.mjs must have a row above. */
export const NOT_RUN = {
  "web/e2e/poc.mjs": "walks the static design page docs/design/poc/unified-workspace.html, not the app, and launches Edge by name (channel msedge), which the Linux CI does not have",
};

/** The suites whose checks follow the chat's gate flags (they read the switches through scripts/lib/harness.mjs): what each chat run of the matrix starts. */
const CHAT_SUITES = [
  "chat integration",
  "chat tools integration",
  "browser: chat (prompt box)",
  "browser: the Thinking block and the turn ledger",
  "browser: the Understand step (what the page draws; the design's examples when CHAT_UNDERSTAND is on)",
  "browser: chat tools (what the page draws for a tool run in the reply)",
];
const TRENDING_SUITES = ["trending list integration", "operations integration", "browser: trending"];
const MCP_SUITES = ["MCP server integration", "browser: AI apps (MCP consent and Connected apps)"];

/**
 * The runs. `default` is production's positions (decision 13): wrangler.jsonc's `vars` as committed (TRENDING off, MCP beta, CHAT_TOOLS on, every other gate unset), and every suite that is
 * written for them. Each named run starts its own Worker with `vars` on top of those and runs only `suites`: the positions production does not have yet, so the checks written for them still
 * run. `node scripts/integration.mjs --run=<name>[,<name>...]`, or `--run=all`.
 */
export const RUNS = {
  default: { vars: {}, why: "the positions of production (wrangler.jsonc's vars as committed)" },
  "trending-on": { vars: { TRENDING: "on" }, suites: TRENDING_SUITES, why: "the Home page's Trending list shown (the way on in docs/runbook.md, after dark)" },
  "trending-dark": { vars: { TRENDING: "dark" }, suites: ["trending list integration"], why: "the job makes the list and the route hides it" },
  "mcp-on": { vars: { MCP: "on", MCP_CHECK_CLAIM: "on" }, suites: MCP_SUITES, why: "the MCP server open to every account, check_claim listed" },
  "mcp-off": { vars: { MCP: "off", MCP_CHECK_CLAIM: "off" }, suites: MCP_SUITES, why: "every path of the MCP server answers 404, as before it existed" },
  "chat-counters-failpolicy": { vars: { CHAT_COUNTERS: "on", CHAT_FAILPOLICY: "on" }, suites: CHAT_SUITES, why: "R3 and R5 on" },
  "chat-safety": { vars: { CHAT_SAFETY: "on", CHAT_COUNTERS: "on" }, suites: CHAT_SUITES, why: "the safety lane on (R4)" },
  "chat-floor": { vars: { CHAT_FLOOR: "on", CHAT_COUNTERS: "on" }, suites: CHAT_SUITES, why: "the relevance floor on (R9)" },
  "chat-understand": { vars: { CHAT_UNDERSTAND: "on" }, suites: CHAT_SUITES, why: "the Understand step decides" },
  "chat-think": { vars: { CHAT_THINK: "on" }, suites: CHAT_SUITES, why: "the Thinking block's lines are sent" },
  "chat-tools-off": { vars: { CHAT_TOOLS: "off" }, suites: CHAT_SUITES, why: "a pasted list is offered and nothing runs" },
};

/**
 * Worker variables that follow a switch's position, as data: R9's floor needs the stand-in search to write each question's words into its records (src/chat/stub.ts), or every question meets the
 * stand-in's five glaucoma records and nothing is ever relevant. Applied after a run's own vars.
 */
export const FOLLOWS = [{ when: { CHAT_FLOOR: ["writer", "on"] }, vars: { QA_STUB_TOPIC: "1" }, why: "the stand-in search writes the question's words into its records" }];

/** The suite files on disk that the table must account for: api/scripts/*-e2e.mjs and web/e2e/*.mjs. */
export function suiteFilesOnDisk() {
  return [
    ...readdirSync(`${apps}api/scripts`).filter((f) => f.endsWith("-e2e.mjs")).map((f) => `api/scripts/${f}`),
    ...readdirSync(`${apps}web/e2e`).filter((f) => f.endsWith(".mjs")).map((f) => `web/e2e/${f}`),
  ].sort();
}

/** What is wrong with the table, as sentences (none: it is right). */
export function tableProblems() {
  const problems = [];
  const files = new Set(SUITES.map((s) => s.file));
  const labels = SUITES.map((s) => s.label);
  for (const f of suiteFilesOnDisk()) if (!files.has(f) && !(f in NOT_RUN)) problems.push(`${f} is in no row of scripts/lib/suites.mjs and not in NOT_RUN (with a reason)`);
  for (const s of SUITES) if (!suiteFilesOnDisk().includes(s.file)) problems.push(`${s.label}: ${s.file} does not exist`);
  for (const f of Object.keys(NOT_RUN)) if (files.has(f)) problems.push(`${f} has a row and is in NOT_RUN`);
  for (const l of labels) if (labels.indexOf(l) !== labels.lastIndexOf(l)) problems.push(`two rows are labelled "${l}"`);
  for (const [name, run] of Object.entries(RUNS)) for (const l of run.suites ?? []) if (!labels.includes(l)) problems.push(`run ${name} names "${l}", which is no row`);
  // a suite the default run skips for its positions runs, with every position it is written for, in a named run
  for (const s of SUITES.filter((x) => x.needs)) {
    for (const [sw, positions] of Object.entries(s.needs)) {
      for (const p of positions) {
        const where = Object.entries(RUNS).filter(([, r]) => (r.suites ?? []).includes(s.label) && r.vars[sw] === p);
        if (!where.length) problems.push(`${s.label} is written for ${sw} ${p}, and no named run gives it that`);
      }
    }
  }
  return problems;
}

/** The suites of a run, in the order they run: the table's order, with a `last` suite after the others. */
export function suitesOf(runName) {
  const run = RUNS[runName];
  if (!run) throw new Error(`no run named ${runName}: ${Object.keys(RUNS).join(", ")}`);
  const rows = run.suites ? SUITES.filter((s) => run.suites.includes(s.label)) : SUITES;
  return [...rows.filter((s) => !s.last), ...rows.filter((s) => s.last)];
}

/**
 * The tables emptied between suites, read from the migrations: every table that references `users` (directly or through another such table), children before the tables they reference so
 * that no foreign key stops a DELETE, then `users`, then the two tables of signing in that hold no foreign key: `oauth_states` (a half-done sign-in of a fake person) and `audit_log`
 * (what was done to the accounts). (F15's registry of personal data takes this over once it exists.)
 */
export const RESET_EXTRA = ["oauth_states", "audit_log"];
export function resetTables() {
  const dir = `${apps}api/migrations`;
  const refs = new Map(); // table -> tables it references
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = readFileSync(`${dir}/${f}`, "utf8").replace(/--[^\n]*/g, "");
    for (const m of sql.matchAll(/DROP TABLE (?:IF EXISTS )?(\w+)/gi)) refs.delete(m[1]);
    for (const m of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)\s*\(([\s\S]*?)\);/gi)) refs.set(m[1], new Set([...m[2].matchAll(/REFERENCES\s+(\w+)/gi)].map((r) => r[1])));
    for (const m of sql.matchAll(/ALTER TABLE (\w+) ADD (?:COLUMN )?[^;]*?REFERENCES\s+(\w+)/gi)) refs.get(m[1])?.add(m[2]);
  }
  const holds = new Set(["users"]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [t, to] of refs) if (!holds.has(t) && [...to].some((x) => holds.has(x))) (holds.add(t), (grew = true));
  }
  // children first: a table goes once every table that references it has gone
  const order = [];
  const left = new Set(holds);
  while (left.size) {
    const next = [...left].filter((t) => ![...left].some((o) => o !== t && refs.get(o)?.has(t))).sort();
    if (!next.length) throw new Error(`the tables that hold accounts reference each other in a circle: ${[...left].join(", ")}`);
    for (const t of next) (order.push(t), left.delete(t));
  }
  return [...order, ...RESET_EXTRA];
}
