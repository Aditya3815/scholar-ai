// Rehearses getting the data back, on the STAGING database only (never production): put realistic rows in, take a restore point, "lose" everything
// (wipe every table and drop one), restore with D1 Time Travel, and prove the database is byte-for-byte what it was. Then prove the undo works, and that a
// plain SQL export (the copy that does not depend on Time Travel) can be loaded into a fresh database and gives the same data.
//
//   node scripts/restore-rehearsal.mjs --yes        (needs `npx wrangler login`; staging must be deployed: npm run deploy:staging -w apps/api)
//
// Safe by construction: the database name is fixed below and must be the one `env.staging` in wrangler.jsonc points at, and must not be production's.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { countsLine, diffFingerprints, fingerprint, isUserTable, parseJsonOutput, quoteIdent, resultSets } from "./lib/fingerprint.mjs";

const DB = "scholar-db-staging";
const ENV = "staging";
const api = fileURLToPath(new URL("..", import.meta.url));

if (!process.argv.includes("--yes")) {
  console.log("This restores the STAGING database (scholar-db-staging) several times and wipes its data on purpose. Run it again with --yes.");
  process.exit(2);
}

// The guard: staging must still be what this script thinks it is.
const cfg = JSON.parse(readFileSync(`${api}wrangler.jsonc`, "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n"));
const stagingDb = cfg.env?.staging?.d1_databases?.[0];
if (stagingDb?.database_name !== DB || stagingDb.database_id === cfg.d1_databases?.[0]?.database_id) {
  console.error("Refusing to run: env.staging in wrangler.jsonc is not the staging database any more.");
  process.exit(2);
}

const work = mkdtempSync(join(tmpdir(), "restore-rehearsal-"));
const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? `: ${detail}` : ""}`);
  return ok;
};
const t0 = Date.now();
const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;

// wrangler is started directly with node, not through a shell: on Windows a shell splits an argument that has spaces, and SQL has plenty.
const WRANGLER = fileURLToPath(new URL("../../../node_modules/wrangler/bin/wrangler.js", import.meta.url));
function wrangler(args) {
  const r = spawnSync(process.execPath, [WRANGLER, ...args], { cwd: api, encoding: "utf8", maxBuffer: 100 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`wrangler ${args.slice(0, 3).join(" ")} failed:\n${r.stdout}\n${r.stderr}`);
  return `${r.stdout}${r.stderr}`;
}
/**
 * Runs SQL on staging (remote), or on a local copy when `local` is a state directory. --command, not --file: for a remote database a file goes
 * through the bulk-import path, which does not give rows back.
 */
function run(sql, { local } = {}) {
  const where = local ? ["--local", "--persist-to", local] : ["--remote"];
  return parseJsonOutput(wrangler(["d1", "execute", DB, "--env", ENV, ...where, "--json", "--command", sql]));
}

async function snapshot(label, { local } = {}) {
  const tables = resultSets(run("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;", { local }))[0].map((r) => r.name).filter(isUserTable);
  const sets = resultSets(
    run(
      [...tables.map((n) => `SELECT * FROM ${quoteIdent(n)} ORDER BY rowid;`), "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type, name;"].join("\n"),
      { local },
    ),
  );
  const fp = fingerprint(tables, sets.slice(0, tables.length), sets[tables.length]);
  console.log(`  ${label}: ${countsLine(fp)}`);
  return fp;
}

const SEED = `
INSERT INTO users (id, email, email_verified, name, role) VALUES ('rehearsal-u1', 'r1@rehearsal.invalid', 1, 'Rehearsal One', 'scholar'), ('rehearsal-u2', 'r2@rehearsal.invalid', 1, 'Rehearsal Two', 'professor');
INSERT INTO identities (provider, subject, user_id) VALUES ('google', 'rehearsal-g1', 'rehearsal-u1'), ('orcid', '0000-0000-0000-0001', 'rehearsal-u2');
INSERT INTO library_items (user_id, paper_id, data) VALUES ('rehearsal-u1', 'doi:10.1/x', '{"title":"A saved paper"}'), ('rehearsal-u1', 'doi:10.1/y', '{"title":"Another"}');
INSERT INTO documents (id, user_id, title, filename, size_bytes, pages, status, chunk_count) VALUES ('rehearsal-d1', 'rehearsal-u1', 'Doc one', 'one.pdf', 1000, 3, 'ready', 2), ('rehearsal-d2', 'rehearsal-u2', 'Doc two', 'two.pdf', 2000, 5, 'ready', 1);
INSERT INTO doc_chunks (doc_id, idx, page, text, embedding) VALUES ('rehearsal-d1', 1000, 1, 'First chunk of text, with ünïcode and "quotes".', 'AAAA'), ('rehearsal-d1', 2000, 2, 'Second chunk.', 'BBBB'), ('rehearsal-d2', 1000, 1, 'Other paper chunk.', 'CCCC');
INSERT INTO doc_qa (id, doc_id, question, answer) VALUES ('rehearsal-q1', 'rehearsal-d1', 'What is measured?', '{"answer":"x"}');
INSERT INTO doc_notes (id, doc_id, page, quote, note) VALUES ('rehearsal-n1', 'rehearsal-d1', 1, 'First chunk', 'a note');
INSERT INTO feedback (id, user_id, kind, problem, note, context) VALUES ('rehearsal-f1', 'rehearsal-u1', 'other', 'other', 'hi', '{}');
INSERT INTO llm_usage (subject, task, sensitivity, provider, model, tokens_in, tokens_out) VALUES ('rehearsal-u1', 'qa', 'private', 'workers-ai', 'm', 100, 50);
INSERT INTO audit_log (action) VALUES ('rehearsal');
`;
const CLEAN = `
DELETE FROM users WHERE id LIKE 'rehearsal-%';
DELETE FROM llm_usage WHERE subject LIKE 'rehearsal-%';
DELETE FROM audit_log WHERE action = 'rehearsal';
`;
/** What a careless "DELETE FROM" on every table, and a bad migration that drops one, would do. */
const DISASTER = `
DELETE FROM doc_notes; DELETE FROM doc_qa; DELETE FROM doc_chunks; DELETE FROM documents; DELETE FROM library_items; DELETE FROM feedback;
DELETE FROM sessions; DELETE FROM oauth_states; DELETE FROM identities; DELETE FROM users; DELETE FROM llm_usage; DELETE FROM audit_log; DELETE FROM api_cache;
DROP TABLE doc_notes;
`;

const bookmark = () => parseJsonOutput(wrangler(["d1", "time-travel", "info", DB, "--env", ENV, "--json"])).bookmark;
async function restoreTo(bm) {
  const t = Date.now();
  const out = parseJsonOutput(wrangler(["d1", "time-travel", "restore", DB, "--env", ENV, `--bookmark=${bm}`, "--json"]));
  return { previous: out.previous_bookmark ?? out.previousBookmark, ms: Date.now() - t };
}
/** Restoring is quick but the database can lag a moment: ask up to three times before calling it a mismatch. */
async function settledSnapshot(label, expected, opts = {}) {
  let fp;
  for (let i = 1; i <= 3; i++) {
    fp = await snapshot(i === 1 ? label : `${label} (look ${i})`, opts);
    if (diffFingerprints(expected, fp, opts.ignore ? { ignore: opts.ignore } : {}).length === 0) return { fp, looks: i };
    await new Promise((r) => setTimeout(r, 5000));
  }
  return { fp, looks: 3 };
}

try {
  console.log(`\nRestore rehearsal on ${DB} (${new Date().toISOString()})`);

  console.log("\n1. Is staging ready?");
  const mig = wrangler(["d1", "migrations", "list", DB, "--env", ENV, "--remote"]);
  if (!check("every migration is applied", /No migrations to apply/i.test(mig), /No migrations/i.test(mig) ? "" : "deploy staging first: npm run deploy:staging -w apps/api")) throw new Error("staging is not migrated");

  console.log("\n2. Put realistic rows in, and take the restore point");
  run(`${CLEAN}`); // a rehearsal that stopped half way last time
  run(SEED);
  const before = await snapshot("data before");
  check("rows are in every table the seed touches", before.tables.users.count >= 2 && before.tables.doc_chunks.count >= 3 && before.tables.doc_notes.count >= 1 && before.tables.feedback.count >= 1);
  const point = bookmark();
  check("Time Travel gave a restore point (bookmark)", /^[0-9a-f-]{20,}$/.test(String(point)), point);
  await new Promise((r) => setTimeout(r, 4000)); // the loss must happen after the restore point

  console.log("\n3. The disaster");
  run(DISASTER);
  const wiped = await snapshot("data after the disaster");
  check("the data is gone and a table is missing", wiped.tables.users?.count === 0 && !("doc_notes" in wiped.tables));

  console.log("\n4. Restore to the restore point");
  const r1 = await restoreTo(point);
  check("the restore command answered with the bookmark to undo it", /^[0-9a-f-]{20,}$/.test(String(r1.previous)), `${secs(r1.ms)}`);
  const { fp: restored, looks } = await settledSnapshot("data after the restore", before);
  const d1 = diffFingerprints(before, restored);
  check("every table, row and the schema are identical to before the disaster", d1.length === 0, d1.join("; ") || `${looks === 1 ? "at the first look" : `after ${looks} looks`}`);

  console.log("\n5. The undo: restoring is itself reversible");
  const r2 = await restoreTo(r1.previous);
  const undone = await settledSnapshot("data after undoing", wiped);
  const d2 = diffFingerprints(wiped, undone.fp);
  check("restoring to the bookmark it printed brings back the wiped state exactly", d2.length === 0, d2.join("; ") || secs(r2.ms));
  const r3 = await restoreTo(point);
  const again = await settledSnapshot("data after restoring again", before);
  const d3 = diffFingerprints(before, again.fp);
  check("and restoring to the restore point once more gives the original data again", d3.length === 0, d3.join("; ") || secs(r3.ms));

  console.log("\n6. The copy that does not depend on Time Travel: a SQL export loaded into a fresh database");
  const dump = join(work, "dump.sql");
  wrangler(["d1", "export", DB, "--env", ENV, "--remote", "--output", dump, "--skip-confirmation"]);
  const text = readFileSync(dump, "utf8");
  check("the export has the schema and the rows", /CREATE TABLE/i.test(text) && /rehearsal-u1/.test(text), `${(text.length / 1024).toFixed(0)} KB`);
  const state = join(work, "local-state");
  mkdirSync(state, { recursive: true });
  wrangler(["d1", "execute", DB, "--env", ENV, "--local", "--persist-to", state, "--file", dump]);
  const loaded = await snapshot("data in the fresh database", { local: state });
  // The export writes the same data but may write the table definitions in its own style, so rows are compared, not the schema text.
  const d4 = diffFingerprints(again.fp, loaded, { ignore: ["(schema)", "d1_migrations"] });
  check("every table has the same rows as the original", d4.length === 0, d4.join("; "));
} catch (e) {
  check("the rehearsal ran to the end", false, String(e.message ?? e).split("\n")[0]);
  console.error(e);
} finally {
  try {
    run(CLEAN);
    console.log("\nCleaned up the rehearsal rows.");
  } catch (e) {
    console.log(`\nCould not clean up the rehearsal rows (ids start with "rehearsal-"): ${String(e.message).split("\n")[0]}`);
  }
  rmSync(work, { recursive: true, force: true });
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${failed.length ? `${failed.length} of ${checks.length} checks FAILED` : `all ${checks.length} checks passed`} in ${secs(Date.now() - t0)}`);
process.exit(failed.length ? 1 : 0);
