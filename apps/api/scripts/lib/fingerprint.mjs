// Helpers for the restore rehearsal: read wrangler's JSON output (which may be preceded by warnings), and fingerprint a whole database so that
// "restored" means "identical", not "looks about right".
import { createHash } from "node:crypto";

/** The JSON array wrangler prints after any warnings. Warnings can contain "[" (colour codes), so the array is found by its shape. */
export function parseJsonOutput(text) {
  const m = /(^|\n)(\[|\{)\s*\n?\s*("|\{|\]|\})/.exec(text);
  if (!m) throw new Error(`no JSON in the output: ${text.slice(0, 200)}`);
  const start = m.index + m[1].length;
  return JSON.parse(text.slice(start));
}

/** All the rows of every statement in a `d1 execute --json` answer. */
export const resultSets = (parsed) => (Array.isArray(parsed) ? parsed : [parsed]).map((r) => r.results ?? []);

const sha = (s) => createHash("sha256").update(s).digest("hex");

/** Count and a hash over the rows in the order given (callers order by rowid). */
export function tableFingerprint(rows) {
  return { count: rows.length, hash: sha(JSON.stringify(rows)) };
}

/**
 * @param {string[]} names  table names
 * @param {object[][]} sets  rows of `SELECT * FROM <name> ORDER BY rowid`, in the same order as names
 * @param {object[]} schema rows of `SELECT type, name, sql FROM sqlite_master ORDER BY type, name`
 */
export function fingerprint(names, sets, schema) {
  if (names.length !== sets.length) throw new Error(`${names.length} tables but ${sets.length} answers`);
  return {
    schema: sha(JSON.stringify(schema)),
    tables: Object.fromEntries(names.map((n, i) => [n, tableFingerprint(sets[i])])),
  };
}

/** Human-readable differences between two fingerprints; empty means identical. `ignore` lists tables left out of the comparison. */
export function diffFingerprints(a, b, { ignore = [] } = {}) {
  const out = [];
  const skip = new Set(ignore);
  if (a.schema !== b.schema && !skip.has("(schema)")) out.push("the schema (tables, indexes, triggers) differs");
  const names = new Set([...Object.keys(a.tables), ...Object.keys(b.tables)]);
  for (const n of [...names].sort()) {
    if (skip.has(n)) continue;
    const x = a.tables[n];
    const y = b.tables[n];
    if (!x) out.push(`${n}: only in the second (${y.count} rows)`);
    else if (!y) out.push(`${n}: missing from the second (${x.count} rows in the first)`);
    else if (x.count !== y.count) out.push(`${n}: ${x.count} rows against ${y.count}`);
    else if (x.hash !== y.hash) out.push(`${n}: same number of rows (${x.count}) but different content`);
  }
  return out;
}

/** Row counts as a short line, for the report. */
export const countsLine = (fp) =>
  Object.entries(fp.tables)
    .filter(([, t]) => t.count > 0)
    .map(([n, t]) => `${n} ${t.count}`)
    .join(", ") || "(all tables empty)";

/** Table names to compare: ours, not SQLite's or Cloudflare's own bookkeeping. */
export const isUserTable = (name) => !/^(sqlite_|_cf_)/.test(name);

/** SQL text for a quoted identifier (table names come from sqlite_master, but are quoted anyway). */
export const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;
