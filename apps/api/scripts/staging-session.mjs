// Throwaway test accounts for the STAGING copy only, so a check can run against the deployed Worker without a person signing in (real sign-in needs a browser and the identity provider).
//   node scripts/staging-session.mjs make <count> <file>   creates <count> accounts with a session each; writes their cookies to <file> (a JSON list; keep it out of the repository)
//   node scripts/staging-session.mjs cleanup               deletes every account this script made, and what hangs on it
// It writes to the database `scholar-db-staging` and nothing else: the name is fixed here, production cannot be named. The accounts have an address that cannot receive mail
// (example.invalid), have read the current privacy text (the same as someone clicking "I understand"), and the session cookie is the same kind a sign-in creates: the database
// holds only its SHA-256.
import { spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const api = fileURLToPath(new URL("..", import.meta.url));
const DB = "scholar-db-staging";
const PREFIX = "oa-check-";
const DOMAIN = "@example.invalid";

/** Runs wrangler through node itself, not through a shell: on Windows a shell would split the SQL at its spaces. Returns the rows of the last statement. */
const WRANGLER = fileURLToPath(new URL("../../../node_modules/wrangler/bin/wrangler.js", import.meta.url));
function d1(sql) {
  const r = spawnSync(process.execPath, [WRANGLER, "d1", "execute", DB, "--remote", "--env", "staging", "--json", "--command", sql], { cwd: api, encoding: "utf8", maxBuffer: 20_000_000 });
  if (r.status !== 0) throw new Error(`wrangler failed: ${(r.stderr || r.stdout).slice(-600)}`);
  const all = JSON.parse(r.stdout.slice(r.stdout.indexOf("[")));
  return all.at(-1)?.results ?? [];
}

const [, , cmd, a, b] = process.argv;
if (cmd === "make") {
  const count = Number(a);
  if (!Number.isInteger(count) || count < 1 || count > 40 || !b) throw new Error("usage: make <1 to 40> <file>");
  const version = /PRIVACY_VERSION = "([^"]+)"/.exec(readFileSync(fileURLToPath(new URL("../../../packages/shared/src/legal.ts", import.meta.url)), "utf8"))?.[1];
  if (!version) throw new Error("PRIVACY_VERSION not found");
  const run = Date.now();
  const cookies = [];
  const statements = [];
  for (let i = 0; i < count; i++) {
    const id = randomUUID();
    const token = randomBytes(32).toString("base64url");
    const sid = createHash("sha256").update(token).digest("hex");
    statements.push(`INSERT INTO users (id, email, email_verified, name, role, privacy_ack, privacy_ack_at) VALUES ('${id}', '${PREFIX}${run}-${i}${DOMAIN}', 1, 'Staging check ${i}', 'scholar', '${version}', datetime('now'))`);
    statements.push(`INSERT INTO sessions (id, user_id, expires_at, user_agent) VALUES ('${sid}', '${id}', datetime('now', '+1 day'), 'staging-session.mjs')`);
    cookies.push(`__Host-sid=${token}`);
  }
  d1(statements.join("; "));
  writeFileSync(b, JSON.stringify(cookies));
  console.log(`made ${count} account(s) on ${DB}; cookies written to ${b}`);
} else if (cmd === "cleanup") {
  const users = d1(`SELECT id FROM users WHERE email LIKE '${PREFIX}%${DOMAIN}'`).map((r) => r.id);
  if (users.length === 0) { console.log("nothing to clean up"); process.exit(0); }
  const list = users.map((u) => `'${u}'`).join(",");
  // every table that names a person: delete their rows first (some have no foreign key), then the accounts
  // D1 does not allow the pragma functions, so the tables that have a column called user_id are found by reading their definitions
  const tables = d1("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name <> 'users' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").filter((r) => /^\s*user_id\s/m.test(r.sql ?? "")).map((r) => r.name);
  // a literature scan's events hang on the scan, not on the person: they go first (the scan row is referenced by them)
  d1(`DELETE FROM litscan_events WHERE scan_id IN (SELECT id FROM litscans WHERE user_id IN (${list}))`);
  for (const t of tables) d1(`DELETE FROM ${t} WHERE user_id IN (${list})`);
  d1(`DELETE FROM users WHERE id IN (${list})`);
  console.log(`deleted ${users.length} account(s) and their rows in ${tables.length} table(s) on ${DB}`);
} else {
  throw new Error("usage: make <count> <file> | cleanup");
}
