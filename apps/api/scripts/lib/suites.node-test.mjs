// The integration runner's table (scripts/lib/suites.mjs) against the folders and the migrations: every suite file has a row or a reason in NOT_RUN, every suite a run skips for its switch
// positions has a named run that gives it those positions, the order rule (ops last) holds in every run, and the tables emptied between suites cover every table that references an account.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RUNS, SUITES, NOT_RUN, tableProblems, suitesOf, resetTables, suiteFilesOnDisk } from "./suites.mjs";
import { localConfig } from "./test-worker.mjs";
import { position } from "./harness.mjs";

test("the table matches the suite files on disk and its runs", () => {
  assert.deepEqual(tableProblems(), []);
  assert.ok(SUITES.length >= 49 && Object.keys(NOT_RUN).length >= 1);
  assert.equal(suiteFilesOnDisk().length, SUITES.length + Object.keys(NOT_RUN).length);
});

test("a suite file in no row is found", () => {
  const extra = [...suiteFilesOnDisk(), "web/e2e/new-suite.mjs"];
  const files = new Set(SUITES.map((s) => s.file));
  assert.deepEqual(extra.filter((f) => !files.has(f) && !(f in NOT_RUN)), ["web/e2e/new-suite.mjs"]);
});

test("the default run is production's positions, read from wrangler.jsonc through the registry", () => {
  const vars = { ...localConfig().vars, ...RUNS.default.vars };
  assert.equal(position("TRENDING", vars), "off");
  assert.equal(position("MCP", vars), "beta");
  assert.equal(position("CHAT_TOOLS", vars), "on");
  assert.equal(position("MCP_CHECK_CLAIM", vars), "off");
  // and a suite written for other positions is not run there, but in a named run that gives them
  const skipped = SUITES.filter((s) => Object.entries(s.needs ?? {}).some(([sw, ps]) => !ps.includes(position(sw, vars))));
  assert.deepEqual(skipped.map((s) => s.label).sort(), ["MCP server integration", "browser: AI apps (MCP consent and Connected apps)", "browser: trending"].sort());
});

test("a suite marked last runs after every other suite of each run that has it", () => {
  for (const name of Object.keys(RUNS)) {
    const order = suitesOf(name);
    const firstLast = order.findIndex((s) => s.last);
    if (firstLast >= 0) assert.ok(order.slice(firstLast).every((s) => s.last), name);
  }
});

test("the tables emptied between suites: every table that references users, children first, and the hand list they replace", () => {
  const tables = resetTables();
  for (const t of ["litscan_shares", "litscan_events", "litscans", "litscan_daily", "library_items", "sessions", "identities", "users", "oauth_states", "audit_log"]) assert.ok(tables.includes(t), t);
  for (const t of ["documents", "doc_chunks", "feedback", "library_alerts", "usage_ledger", "ocr_usage"]) assert.ok(tables.includes(t), t);
  assert.ok(tables.indexOf("doc_chunks") < tables.indexOf("documents") && tables.indexOf("documents") < tables.indexOf("users"));
  assert.ok(tables.indexOf("litscan_events") < tables.indexOf("litscans") && tables.indexOf("litscans") < tables.indexOf("users"));
  // public data stays: the cache, the shared index of open-access papers, the jobs' heartbeat
  for (const t of ["api_cache", "oa_papers", "job_runs", "paper_retraction"]) assert.ok(!tables.includes(t), t);
});
