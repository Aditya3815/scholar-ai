import { test } from "node:test";
import assert from "node:assert/strict";
import { countsLine, diffFingerprints, fingerprint, isUserTable, parseJsonOutput, quoteIdent, resultSets, tableFingerprint } from "./fingerprint.mjs";

const WARNING = "\u001b[33m▲ [43;33m[[43;30mWARNING[43;33m][0m Processing wrangler.jsonc configuration:\n\n  - vars exist\n\n\n";

test("parseJsonOutput reads the array that follows warnings, even though the warnings contain [", () => {
  const out = parseJsonOutput(`${WARNING}[\n  {\n    "results": [{ "n": 1 }],\n    "success": true\n  }\n]\n`);
  assert.deepEqual(resultSets(out), [[{ n: 1 }]]);
});

test("parseJsonOutput reads an object, an empty list, and output with nothing before it", () => {
  assert.deepEqual(parseJsonOutput('{\n  "bookmark": "00000004-abc"\n}\n'), { bookmark: "00000004-abc" });
  assert.deepEqual(parseJsonOutput("noise\n[]\n"), []);
  assert.deepEqual(parseJsonOutput(`${WARNING}{\n  "previous_bookmark": "a",\n  "new_bookmark": "b"\n}`), { previous_bookmark: "a", new_bookmark: "b" });
});

test("parseJsonOutput says so when there is no JSON", () => {
  assert.throws(() => parseJsonOutput("Error: not logged in"), /no JSON/);
});

test("resultSets gives one list of rows per statement, and an empty list for a statement with no results", () => {
  assert.deepEqual(resultSets([{ results: [{ a: 1 }] }, { success: true }]), [[{ a: 1 }], []]);
  assert.deepEqual(resultSets({ results: [{ a: 1 }] }), [[{ a: 1 }]]);
});

test("a table fingerprint changes with any change in content, order or count", () => {
  const base = tableFingerprint([{ id: 1, v: "a" }, { id: 2, v: "b" }]);
  assert.equal(base.count, 2);
  assert.deepEqual(tableFingerprint([{ id: 1, v: "a" }, { id: 2, v: "b" }]), base);
  assert.notEqual(tableFingerprint([{ id: 1, v: "a" }, { id: 2, v: "B" }]).hash, base.hash);
  assert.notEqual(tableFingerprint([{ id: 2, v: "b" }, { id: 1, v: "a" }]).hash, base.hash);
  assert.notEqual(tableFingerprint([{ id: 1, v: "a" }]).hash, base.hash);
  assert.deepEqual(tableFingerprint([]).count, 0);
});

const SCHEMA = [{ type: "table", name: "users", sql: "CREATE TABLE users (id)" }];
const make = (users, docs, schema = SCHEMA) => fingerprint(["documents", "users"], [docs, users], schema);

test("identical databases have no differences", () => {
  assert.deepEqual(diffFingerprints(make([{ id: 1 }], []), make([{ id: 1 }], [])), []);
});

test("differences say which table, and how", () => {
  const a = make([{ id: 1 }, { id: 2 }], [{ id: "d" }]);
  assert.deepEqual(diffFingerprints(a, make([{ id: 1 }], [{ id: "d" }])), ["users: 2 rows against 1"]);
  assert.deepEqual(diffFingerprints(a, make([{ id: 1 }, { id: 3 }], [{ id: "d" }])), ["users: same number of rows (2) but different content"]);
  assert.deepEqual(diffFingerprints(a, make([{ id: 1 }, { id: 2 }], [{ id: "d" }], [{ type: "table", name: "users", sql: "CREATE TABLE users (id, x)" }])), ["the schema (tables, indexes, triggers) differs"]);
});

test("a table that exists in only one of them is reported either way round", () => {
  const a = fingerprint(["users", "doc_notes"], [[], [{ id: 1 }]], SCHEMA);
  const b = fingerprint(["users"], [[]], SCHEMA);
  assert.deepEqual(diffFingerprints(a, b), ["doc_notes: missing from the second (1 rows in the first)"]);
  assert.deepEqual(diffFingerprints(b, a), ["doc_notes: only in the second (1 rows)"]);
});

test("ignored tables and the ignored schema are left out", () => {
  const a = make([{ id: 1 }], []);
  const b = make([{ id: 1 }], [{ id: "x" }], [{ type: "table", name: "other", sql: "x" }]);
  assert.deepEqual(diffFingerprints(a, b, { ignore: ["documents", "(schema)"] }), []);
});

test("fingerprint refuses mismatched names and answers", () => {
  assert.throws(() => fingerprint(["a", "b"], [[]], []), /2 tables but 1 answers/);
});

test("countsLine lists non-empty tables only", () => {
  assert.equal(countsLine(make([{ id: 1 }, { id: 2 }], [])), "users 2");
  assert.equal(countsLine(make([], [])), "(all tables empty)");
});

test("our tables are kept, SQLite's and Cloudflare's are not; identifiers are quoted", () => {
  assert.equal(isUserTable("users"), true);
  assert.equal(isUserTable("d1_migrations"), true);
  assert.equal(isUserTable("sqlite_sequence"), false);
  assert.equal(isUserTable("_cf_KV"), false);
  assert.equal(quoteIdent('we"ird'), '"we""ird"');
});
