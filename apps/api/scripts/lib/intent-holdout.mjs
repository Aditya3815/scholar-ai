// The sealed hold-out of the intent eval (docs/design/intent-and-state.md, 8.2): the 120 blind messages are kept in ONE encrypted file, apps/api/eval/data/intent-holdout.enc, so that
// the numbers measured on them are honest. Only CI (the key is a GitHub secret) and the owner (the key is in his password manager) can read it. This library is the whole format
// and every check; scripts/intent-holdout.mjs is the command line over it.
//
// File layout (all fixed, nothing is guessed when reading):
//   8 bytes   magic "SODHHOLD"
//   1 byte    format version (1)
//   12 bytes  nonce, random for every seal
//   4 bytes   length of the summary (big endian)
//   n bytes   summary: JSON {total, bySet: {set: {language: count}}}. No text and no id, so `verify` can show the counts without the key.
//   m bytes   AES-256-GCM ciphertext of the cases (a JSON list)
//   16 bytes  GCM tag
// Everything before the ciphertext is the "additional data" of the cipher: a changed summary, version or nonce fails to open, like a changed ciphertext. Reading never returns part of a
// hold-out: a wrong key, a changed or shortened file, another version, all throw a HoldoutError before any case is given to a caller.
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const MAGIC = Buffer.from("SODHHOLD", "ascii");
export const VERSION = 1;
export const KEY_ENV = "INTENT_HOLDOUT_KEY";
export const REVEAL_ENV = "INTENT_HOLDOUT_REVEAL";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const FIXED_HEADER = MAGIC.length + 1 + NONCE_BYTES + 4;
const MAX_SUMMARY_BYTES = 4096;

/** The repository this script is in: apps/api/scripts/lib is four folders below it. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
export const DEFAULT_SEALED_PATH = join(REPO_ROOT, "apps", "api", "eval", "data", "intent-holdout.enc");

/** Every refusal of this library. The message is safe to print: it never holds a key or the text of a case. `code` is for tests and callers. */
export class HoldoutError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "HoldoutError";
    this.code = code;
  }
}
const fail = (code, message) => new HoldoutError(code, message);

/* ---------- the key ---------- */

/** A key is base64 of exactly 32 bytes (what `keygen` prints). Anything else is refused, and the error does not repeat what was given. */
export function parseKey(text) {
  const s = typeof text === "string" ? text.trim() : "";
  const refused = () => fail("bad-key", "the key must be base64 of 32 bytes (44 characters, the last one =); make one with: node apps/api/scripts/intent-holdout.mjs keygen");
  if (!/^[A-Za-z0-9+/]{43}=$/.test(s)) throw refused();
  const raw = Buffer.from(s, "base64");
  if (raw.length !== KEY_BYTES || raw.toString("base64") !== s) throw refused();
  return raw;
}

export const generateKey = () => randomBytes(KEY_BYTES).toString("base64");

/** The nearest part of the path that exists is resolved through links, the rest is added as written: a file that is not there yet can still be placed. */
function realish(p) {
  let cur = resolve(p);
  const rest = [];
  for (;;) {
    try {
      return join(realpathSync(cur), ...[...rest].reverse());
    } catch {
      const up = dirname(cur);
      if (up === cur) return resolve(p);
      rest.push(basename(cur));
      cur = up;
    }
  }
}

/** Which file or folder this is, whatever it is called: the volume and the file number of the system. Null when the path is not there, or the system gives no number. */
function identityOf(p) {
  try {
    const s = statSync(p, { bigint: true });
    return s.ino === 0n ? null : `${s.dev}:${s.ino}`;
  } catch {
    return null;
  }
}

/**
 * Is the path in the folder, by what the files are rather than by how the path is spelled: walks up from the path (a file that is not there yet starts at its nearest folder that is) and asks
 * at each step whether this is the repository's folder. The written form hides on Windows what this sees: an 8.3 short name ("RF-PHA~1"), the extended-length prefix, an administrative share
 * (host, then C$, then the folders), and any other way of reaching the same folder. The text comparison above stays for a machine that gives no file numbers.
 */
function isInsideById(path, repoRoot) {
  const root = identityOf(repoRoot);
  if (root === null) return false;
  for (let cur = resolve(path); ; cur = dirname(cur)) {
    if (identityOf(cur) === root) return true;
    if (dirname(cur) === cur) return false;
  }
}

/** The plain hold-out and the key never live in the repository (a public one): this is checked before the file is read. */
export function assertOutsideRepo(path, what, repoRoot = REPO_ROOT) {
  const rel = relative(realish(repoRoot), realish(path));
  const inside = rel === "" || (rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel)) || isInsideById(path, repoRoot);
  if (inside) throw fail("inside-repo", `${what} must be outside the repository (${path}): the repository is public and a hold-out that was ever committed is not blind any more`);
}

/** The key from --key-file when one is given (it wins over the environment), else from INTENT_HOLDOUT_KEY. */
export function loadKey({ env = process.env, keyFile } = {}) {
  if (keyFile) {
    assertOutsideRepo(keyFile, "the key file");
    let text;
    try {
      text = readFileSync(keyFile, "utf8");
    } catch (e) {
      throw fail("key-file", `cannot read the key file ${keyFile} (${e?.code ?? "error"})`);
    }
    return parseKey(text);
  }
  const v = env[KEY_ENV];
  if (typeof v !== "string" || !v.trim()) throw fail("no-key", `no key: set ${KEY_ENV} (base64 of 32 bytes) or give --key-file <a file outside the repository>`);
  return parseKey(v);
}

const checkKey = (key) => {
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) throw fail("bad-key", "the key must be a buffer of 32 bytes (use parseKey)");
};

/* ---------- the cases ---------- */

const LABEL = /^[A-Za-z0-9._-]{1,32}$/;
const CASE_ID = /^[A-Za-z0-9._:-]{1,64}$/;
const MAX_TEXT = 10_000;

/**
 * The cases of a hold-out: a list, or an object with a "cases" list. Each needs an id (a short code, so that it can be printed and carries no message), a set, a language and the
 * text; every other field (class, gold, retrieval ...) is kept as it is. A problem is named by the case's position, never by its text.
 */
export function validateCases(input) {
  const list = Array.isArray(input) ? input : input && typeof input === "object" && Array.isArray(input.cases) ? input.cases : null;
  if (!list) throw fail("bad-cases", 'the hold-out must be a list of cases (or an object with a "cases" list)');
  if (list.length === 0) throw fail("bad-cases", "the hold-out has no cases");
  const problems = [];
  const firstAt = new Map();
  list.forEach((c, i) => {
    const at = `case ${i + 1}`;
    if (!c || typeof c !== "object" || Array.isArray(c)) return void problems.push(`${at} is not an object`);
    if (typeof c.id !== "string" || !CASE_ID.test(c.id)) problems.push(`${at}: the id must be 1 to 64 characters of letters, digits and . _ : -`);
    else if (firstAt.has(c.id)) problems.push(`${at} has the same id as case ${firstAt.get(c.id)}`);
    else firstAt.set(c.id, i + 1);
    if (typeof c.set !== "string" || !LABEL.test(c.set)) problems.push(`${at}: the set must be 1 to 32 characters of letters, digits and . _ -`);
    if (typeof c.language !== "string" || !LABEL.test(c.language)) problems.push(`${at}: the language must be 1 to 32 characters of letters, digits and . _ -`);
    if (typeof c.text !== "string" || c.text.trim() === "" || c.text.length > MAX_TEXT) problems.push(`${at}: the text must be a non-empty string of at most ${MAX_TEXT} characters`);
  });
  if (problems.length) throw fail("bad-cases", `the hold-out is not valid: ${problems.slice(0, 10).join("; ")}${problems.length > 10 ? `; and ${problems.length - 10} more` : ""}`);
  return list;
}

/* ---------- a sheet the writers fill in (CSV) ---------- */

/** The rows of a CSV text (RFC 4180): a quoted cell can hold commas, line breaks and a doubled quote; a leading BOM and CRLF line ends are fine. Empty rows are left out; `n` is the row's place in the sheet (the header is row 1), as a spreadsheet shows it. */
function parseCsv(text) {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows = [];
  let cells = [];
  let cell = "";
  let quoted = false;
  let n = 1;
  const endRow = () => {
    cells.push(cell);
    if (cells.some((c) => c.trim() !== "")) rows.push({ n, cells });
    cells = [];
    cell = "";
    n++;
  };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (s[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = false;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === ",") {
      cells.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      endRow();
    } else cell += ch;
  }
  if (quoted) throw fail("bad-csv", "the CSV has a quote that is never closed");
  if (cell !== "" || cells.length) endRow();
  return rows;
}

const CSV_REQUIRED = ["id", "set", "language", "text"];

/**
 * The cases of a sheet: a header line (id, set, language and text are needed; class, author, tags and any other column are kept) and one case a row. Cells are trimmed and an empty cell is left out;
 * `tags` is split at semicolons. A problem is named by the row and the column, never by a text. The cases still go through validateCases.
 */
export function casesFromCsv(text) {
  const rows = parseCsv(String(text));
  if (rows.length === 0) throw fail("bad-csv", "the CSV has no rows (it needs a header line)");
  const names = rows[0].cells.map((h) => h.trim().toLowerCase());
  // A column is named by its place, never by its name: a first row that is not a header holds a message, and a name taken from it would print that message.
  const seen = new Map();
  names.forEach((name, j) => {
    if (name === "") return;
    if (seen.has(name)) throw fail("bad-csv", `the CSV has the same column twice (columns ${seen.get(name) + 1} and ${j + 1})`);
    seen.set(name, j);
  });
  for (const need of CSV_REQUIRED) if (!seen.has(need)) throw fail("bad-csv", `the CSV is missing the column ${need}`);
  return rows.slice(1).map(({ n, cells }) => {
    if (cells.length !== names.length) throw fail("bad-csv", `row ${n} has ${cells.length} fields but the header has ${names.length}`);
    const entries = [];
    names.forEach((name, j) => {
      const value = cells[j].trim();
      if (value === "") return;
      if (name === "") throw fail("bad-csv", `row ${n} has a cell under a column with no name`);
      entries.push([name, name === "tags" ? value.split(";").map((t) => t.trim()).filter(Boolean) : value]);
    });
    return Object.fromEntries(entries);
  });
}

const SCHEMA_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MAX_PROBLEM_LINES = 20;

const PLAIN_FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]{0,24}$/;

/** One problem line without any part of a text: an "unknown field" names the field only when it looks like a column name (a sentence in a header cell is a message), and a problem with the text keeps its kind only. */
function printable(problem) {
  if (problem.startsWith("text:")) return problem.replace(/ [(].*$/s, "");
  return problem.replace(/unknown field "(.*)"/s, (_all, name) => (PLAIN_FIELD_NAME.test(name) ? `unknown field "${name}"` : "unknown field (name not shown: it is not a plain column name)"));
}

/**
 * What the case schema says about each case (apps/api/eval/lib/intent-schema.ts, `validateCase`, passed in as `validate`), as lines that are safe to print: a case is named by its id, or by its
 * place when the id is not usable, and a problem with the text keeps its kind but not the part of the text it quotes (an e-mail address, a phone number).
 */
export function schemaProblems(cases, validate) {
  const lines = [];
  cases.forEach((c, i) => {
    const label = typeof c?.id === "string" && SCHEMA_ID.test(c.id) ? `case ${c.id}` : `case #${i + 1}`;
    for (const problem of validate(c)) lines.push(`${label}: ${printable(problem)}`);
  });
  return lines.length > MAX_PROBLEM_LINES ? [...lines.slice(0, MAX_PROBLEM_LINES), `and ${lines.length - MAX_PROBLEM_LINES} more`] : lines;
}

/** Counts by set and by language, in a fixed order, from labels only. Maps and fromEntries, so a label such as "__proto__" is just a name. */
export function summarize(cases) {
  const bySet = new Map();
  for (const c of cases) {
    const langs = bySet.get(c.set) ?? new Map();
    langs.set(c.language, (langs.get(c.language) ?? 0) + 1);
    bySet.set(c.set, langs);
  }
  const sorted = (m) => [...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return { total: cases.length, bySet: Object.fromEntries(sorted(bySet).map(([s, langs]) => [s, Object.fromEntries(sorted(langs))])) };
}

/** The counts as lines for a screen: "set  language  count". */
export function formatCounts(summary) {
  const rows = Object.entries(summary.bySet).flatMap(([set, langs]) => Object.entries(langs).map(([lang, n]) => [set, lang, String(n)]));
  const head = ["set", "language", "cases"];
  const w = (i) => Math.max(...rows.map((r) => r[i].length), head[i].length);
  const line = (r) => `${r[0].padEnd(w(0))}  ${r[1].padEnd(w(1))}  ${r[2].padStart(w(2))}`;
  return [line(head), ...rows.map(line)];
}

/* ---------- the seal ---------- */

const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};

export const sha256Hex = (buf) => createHash("sha256").update(buf).digest("hex");

/**
 * The id a case has inside the sealed file: "HO-" and ten hex digits of a keyed hash of the id its writer gave it. The writers' ids are the codes of the scenarios, and the scenarios are in the
 * public writing guide, so a failing case's id would say what the message is about; this one says nothing to anyone without the key. It is the same at every seal with the same key, so a case
 * keeps its id when the hold-out is sealed again, and the owner, who has the plain files, can find a case from the id he knows.
 */
export function opaqueId(key, id) {
  checkKey(key);
  return `HO-${createHmac("sha256", key).update(`sodhsetu-holdout-id:${id}`).digest("hex").slice(0, 10)}`;
}

/** The cases with their ids made opaque, every other field as it was. The input is not changed. */
export function withOpaqueIds(cases, key) {
  checkKey(key);
  const out = validateCases(cases).map((c) => ({ ...c, id: opaqueId(key, c.id) }));
  if (new Set(out.map((c) => c.id)).size !== out.length) throw fail("id-collision", "two cases got the same opaque id: this cannot be fixed by the writers, so tell the lead");
  return out;
}

/** The bytes of a sealed hold-out. A new nonce every time, so sealing the same cases twice gives two different files. */
export function seal(cases, key) {
  checkKey(key);
  const list = validateCases(cases);
  const summary = Buffer.from(JSON.stringify(summarize(list)), "utf8");
  // open() refuses a header over this size: a file written here must be one that can be read
  if (summary.length > MAX_SUMMARY_BYTES) throw fail("summary-too-big", `the hold-out has too many different set and language labels to count in its header (more than ${MAX_SUMMARY_BYTES} bytes of counts)`);
  const nonce = randomBytes(NONCE_BYTES);
  const header = Buffer.concat([MAGIC, Buffer.from([VERSION]), nonce, u32(summary.length), summary]);
  const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(header);
  const body = Buffer.concat([cipher.update(JSON.stringify(list), "utf8"), cipher.final()]);
  return Buffer.concat([header, body, cipher.getAuthTag()]);
}

/** The parts of a sealed file, from its structure alone (no key). Throws on anything that is not a whole file of a version this code knows. */
function parseSealed(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < MAGIC.length || !buf.subarray(0, MAGIC.length).equals(MAGIC)) throw fail("not-sealed", "not a sealed hold-out file (it does not start with the SODHHOLD mark)");
  if (buf.length < FIXED_HEADER + TAG_BYTES) throw fail("truncated", "the sealed file is cut short");
  const version = buf[MAGIC.length];
  if (version !== VERSION) throw fail("version", `this file is version ${version}; this script supports version ${VERSION} only`);
  const summaryLength = buf.readUInt32BE(FIXED_HEADER - 4);
  const headerEnd = FIXED_HEADER + summaryLength;
  if (summaryLength > MAX_SUMMARY_BYTES || headerEnd + TAG_BYTES > buf.length) throw fail("truncated", "the sealed file is cut short, or its header is damaged");
  const summaryBytes = buf.subarray(FIXED_HEADER, headerEnd);
  let summary;
  try {
    summary = JSON.parse(summaryBytes.toString("utf8"));
  } catch {
    throw fail("bad-header", "the header of the sealed file is damaged");
  }
  if (!summary || typeof summary.total !== "number" || !summary.bySet || typeof summary.bySet !== "object") throw fail("bad-header", "the header of the sealed file is damaged");
  return {
    version,
    nonce: buf.subarray(MAGIC.length + 1, MAGIC.length + 1 + NONCE_BYTES),
    header: buf.subarray(0, headerEnd),
    summary,
    summaryBytes,
    body: buf.subarray(headerEnd, buf.length - TAG_BYTES),
    tag: buf.subarray(buf.length - TAG_BYTES),
  };
}

/** The cases of a sealed file, in memory. The key is wrong, or one byte changed, or the file is shorter or longer than it was: nothing comes out. */
export function open(buf, key) {
  checkKey(key);
  const p = parseSealed(buf);
  let plain;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, p.nonce, { authTagLength: TAG_BYTES });
    decipher.setAAD(p.header);
    decipher.setAuthTag(p.tag);
    plain = Buffer.concat([decipher.update(p.body), decipher.final()]);
  } catch {
    throw fail("cannot-decrypt", "could not open the hold-out: the key is wrong, or the file was changed or cut short");
  }
  let cases;
  try {
    cases = validateCases(JSON.parse(plain.toString("utf8")));
  } catch (e) {
    if (e instanceof HoldoutError) throw e;
    throw fail("bad-contents", "the sealed contents are not a list of cases");
  }
  if (JSON.stringify(summarize(cases)) !== p.summaryBytes.toString("utf8")) throw fail("summary-mismatch", "the counts in the header do not match the sealed cases");
  return cases;
}

/** Opens the file in memory and hands the cases to `fn`; what `fn` returns is returned. `fn` must give back numbers and case ids, not text (the plan: only the owner reads a failing case). */
export function aggregate(buf, key, fn) {
  return fn(open(buf, key));
}

/** What can be said about a sealed file without showing any case: its hash, size, version and counts. With the key the counts are checked against the real contents. */
export function describe(buf, key) {
  const p = parseSealed(buf);
  if (key) {
    const cases = open(buf, key);
    return { sha256: sha256Hex(buf), version: p.version, bytes: buf.length, summary: summarize(cases), summaryChecked: true };
  }
  return { sha256: sha256Hex(buf), version: p.version, bytes: buf.length, summary: p.summary, summaryChecked: false };
}

/* ---------- reveal: the owner reads a failing case ---------- */

/** CI systems say so in the environment, each in its own way: GitHub Actions and most others set CI, GitHub also GITHUB_ACTIONS, Azure Pipelines TF_BUILD; the value is "true", "True", "1" and so on. Anything but empty, "false" or "0" counts. */
const CI_VARIABLES = ["CI", "GITHUB_ACTIONS", "TF_BUILD"];
const inCi = (env) => CI_VARIABLES.some((name) => {
  const v = typeof env[name] === "string" ? env[name].trim().toLowerCase() : "";
  return v !== "" && v !== "false" && v !== "0";
});

/**
 * Why a case may not be shown now, or null. The plan: the owner, not an engineer, reads the text of a failing case. A switch in the environment is a speed bump, not a lock (whoever
 * has the key can decrypt the file): it stops a script, a habit or a CI log from printing text by accident.
 */
export function revealRefusal(env = process.env) {
  if (inCi(env)) return "reveal is not allowed in CI: a failing case is read by the owner on his own machine, never in a log that engineers can read";
  if (env[REVEAL_ENV] !== "owner") return `reveal is for the owner: it shows the text of a hold-out case. The owner sets ${REVEAL_ENV}=owner for that one command; an engineer does not`;
  return null;
}

/** A case by its id in the sealed file, or (when a key is given) by the id its writer gave it: the owner has the plain files and knows that one. */
export function findCase(cases, id, key) {
  const c = cases.find((x) => x.id === id) ?? (key ? cases.find((x) => x.id === opaqueId(key, id)) : undefined);
  if (!c) throw fail("no-case", `no case with the id ${id}`);
  return c;
}
