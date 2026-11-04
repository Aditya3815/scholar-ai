// The sealed hold-out of the intent eval (docs/design/intent-and-state.md, 8.2). The messages are written by people and kept in one encrypted file that no engineer reads;
// this command makes the file and answers the questions that can be answered without showing a message. The format and every check are in scripts/lib/intent-holdout.mjs.
//
//   node apps/api/scripts/intent-holdout.mjs keygen
//   node apps/api/scripts/intent-holdout.mjs seal <plain.json or sheet.csv> [more files] [--out <file>] [--key-file <file>] [--replace]
//   node apps/api/scripts/intent-holdout.mjs check <plain.json or sheet.csv> [more files]
//   node apps/api/scripts/intent-holdout.mjs verify [--file <sealed>] [--key-file <file>] [--expect-sha256 <hex>]
//   node apps/api/scripts/intent-holdout.mjs aggregate [--file <sealed>] [--key-file <file>]
//   node apps/api/scripts/intent-holdout.mjs reveal --id <case id> [--file <sealed>] [--key-file <file>]      (the owner only)
//
// The key is base64 of 32 bytes, from INTENT_HOLDOUT_KEY or from --key-file (a file outside the repository). The plain files (JSON, or the CSV sheets the writers fill in) are outside the repository too. Nothing here ever prints
// a key, and nothing but `reveal` prints the text of a case; every command writes its output at the end, so a failure leaves no partial output. `seal` replaces the writers' ids (the codes of
// the scenarios, which are in the public writing guide) with opaque ones, so that no id printed by `aggregate` or by CI says what a case is about.
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import {
  DEFAULT_SEALED_PATH, HoldoutError, KEY_ENV, REVEAL_ENV, aggregate, assertOutsideRepo, casesFromCsv, describe, findCase, formatCounts, generateKey, loadKey, open, revealRefusal, schemaProblems, seal, sha256Hex, summarize, validateCases, withOpaqueIds,
} from "./lib/intent-holdout.mjs";

const USAGE = `usage: node apps/api/scripts/intent-holdout.mjs <command>
  keygen                                      print a new key and say where to keep it
  seal <file.json|file.csv>... [--out f] [--key-file f] [--replace]
                                              join the plain files (kept outside the repository), give each case an opaque id and encrypt them (default out: apps/api/eval/data/intent-holdout.enc)
  check <file.json|file.csv>...               check plain files against the case schema and each other, before anything is sealed; no key, no text
  verify [--file f] [--key-file f] [--expect-sha256 hex]
                                              the file's hash and the counts by set and language; no text
  aggregate [--file f] [--key-file f]         counts and opaque case ids from the decrypted file; no text, and no id that names a scenario
  reveal --id <case id> [--file f] [--key-file f]
                                              the owner only: show one case, by its opaque id or the id its writer gave it (needs ${REVEAL_ENV}=owner); the case then moves to DEV`;

class UsageError extends Error {}

function readFileOrFail(path, what) {
  try {
    return readFileSync(path);
  } catch (e) {
    throw new HoldoutError("read", `cannot read ${what} ${path} (${e?.code ?? "error"})`);
  }
}

/** The key, when a command may run without one: only a key that was given is loaded (and a bad one is still refused). */
const optionalKey = (values) => (values["key-file"] || process.env[KEY_ENV] ? loadKey({ keyFile: values["key-file"] }) : null);

const countsBlock = (summary) => formatCounts(summary).map((l) => `  ${l}`);

const tableBlock = (head, rows) => {
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  return [head, ...rows].map((r) => "  " + r.map((c, i) => (i === r.length - 1 ? c.padStart(w[i]) : c.padEnd(w[i]))).join("  "));
};

function keygen() {
  return [
    "A new hold-out key (base64 of 32 bytes). Whoever has it can read the sealed hold-out, so do not paste it into a chat, a ticket or a file in the repository:",
    "",
    generateKey(),
    "",
    "Keep it in two places only:",
    "  1. the owner's password manager;",
    `  2. the GitHub repository secret ${KEY_ENV} (Settings, Secrets and variables, Actions): the one place CI gets it from.`,
    "It is not in the repository, and this command wrote no file.",
    `To seal or open on your own machine, put it in the environment (${KEY_ENV}) for that one command, or in a key file outside the repository (--key-file).`,
  ];
}

/** The case schema's own validator (apps/api/eval/lib/intent-schema.ts): one copy of the rules, read as it is. Node reads a TypeScript file without a build from 22.18. */
async function loadValidator() {
  try {
    return (await import(new URL("../eval/lib/intent-schema.ts", import.meta.url).href)).validateCase;
  } catch {
    throw new HoldoutError("no-schema", `cannot read the case schema (apps/api/eval/lib/intent-schema.ts): it needs Node 22.18 or newer, which reads TypeScript files; this is ${process.version}`);
  }
}

/** The cases of one plain file: a CSV sheet by its extension, else JSON. */
function readPlain(path) {
  const raw = readFileOrFail(path, "the plain file").toString("utf8");
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw; // Windows tools write a byte-order mark; the CSV reader drops one too
  if (/\.csv$/i.test(path)) return validateCases(casesFromCsv(text));
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HoldoutError("bad-json", "it is not valid JSON"); // the parser's own message quotes the text
  }
  return validateCases(parsed);
}

/**
 * All the plain files, joined: each one must be outside the repository (checked before any is read), read, valid for the case schema, and its ids must not be in another file. Every problem of
 * every file is reported at once, by file and case, so that a writer's sheet can be corrected in one round; none of them quotes a text.
 */
async function readAll(files) {
  for (const file of files) assertOutsideRepo(file, "the plain file");
  const validate = await loadValidator();
  const problems = [];
  const firstIn = new Map();
  const cases = [];
  for (const file of files) {
    const name = basename(file);
    let list;
    try {
      list = readPlain(file);
    } catch (e) {
      if (!(e instanceof HoldoutError)) throw e;
      problems.push(`${name}: ${e.message}`);
      continue;
    }
    for (const line of schemaProblems(list, validate)) problems.push(`${name}: ${line}`);
    for (const c of list) {
      if (firstIn.has(c.id)) problems.push(`the id ${c.id} is in both ${basename(firstIn.get(c.id))} and ${name}`);
      else {
        firstIn.set(c.id, file);
        cases.push(c);
      }
    }
  }
  if (problems.length) throw new HoldoutError("bad-cases", problems.join("\n"));
  return cases;
}

async function checkCommand(positionals) {
  if (positionals.length === 0) throw new UsageError("check needs at least one plain file (JSON, or a CSV sheet)");
  const cases = await readAll(positionals);
  return [`checked ${cases.length} cases in ${positionals.length} ${positionals.length === 1 ? "file" : "files"} against the case schema: no problems`, ...countsBlock(summarize(cases))];
}

async function sealCommand(positionals, values) {
  if (positionals.length === 0) throw new UsageError("seal needs at least one plain file (JSON, or a CSV sheet), kept outside the repository");
  const out = values.out ?? DEFAULT_SEALED_PATH;
  if (existsSync(out) && !values.replace) {
    throw new HoldoutError("exists", `${out} already exists; sealing again changes its hash. To rotate the hold-out on purpose, run again with --replace and record the new sha256`);
  }
  const cases = await readAll(positionals);
  const key = loadKey({ keyFile: values["key-file"] });
  const bytes = seal(withOpaqueIds(cases, key), key);
  const part = `${out}.tmp-${process.pid}`;
  try {
    writeFileSync(part, bytes, { flag: "wx" });
    renameSync(part, out); // whole or not there: a half-written file would look sealed
  } catch (e) {
    rmSync(part, { force: true });
    throw new HoldoutError("write", `cannot write ${out} (${e?.code ?? "error"})`);
  }
  const back = open(readFileOrFail(out, "the sealed file"), key); // proof that what was written opens with this key
  return [
    `sealed ${back.length} cases from ${positionals.length} ${positionals.length === 1 ? "file" : "files"} to ${out}`,
    `sha256 ${sha256Hex(bytes)}`,
    ...countsBlock(summarize(back)),
    `read back with the key: ok (${back.length} cases)`,
    `ids: the writers' ids were replaced by opaque ones (HO- and ten hex digits, from the key and the id); a failing case's id says nothing about its scenario. ${REVEAL_ENV}=owner reveal --id takes either one`,
    "Next: put the sha256 in the commit message and commit only the .enc file. The plain files were not changed or deleted; they stay outside the repository, and are the only readable copy: keep them where you keep the key.",
  ];
}

function verifyCommand(values) {
  const file = values.file ?? DEFAULT_SEALED_PATH;
  const bytes = readFileOrFail(file, "the sealed file");
  const d = describe(bytes, optionalKey(values));
  if (values["expect-sha256"] !== undefined) {
    const want = values["expect-sha256"].trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(want)) throw new UsageError("--expect-sha256 needs 64 hex digits");
    if (want !== d.sha256) throw new HoldoutError("sha-mismatch", `the sha256 of ${file} (${d.sha256}) does not match the one expected (${want})`);
  }
  return [
    `file    ${file}`,
    `bytes   ${d.bytes}`,
    `version ${d.version}`,
    `sha256  ${d.sha256}`,
    ...countsBlock(d.summary),
    d.summaryChecked
      ? "counts: checked against the contents with the key"
      : "counts: read from the header, not checked against the contents (no key was given; the sha256 is the check)",
  ];
}

function aggregateCommand(values) {
  const file = values.file ?? DEFAULT_SEALED_PATH;
  const { summary, classes, ids } = aggregate(readFileOrFail(file, "the sealed file"), loadKey({ keyFile: values["key-file"] }), (cases) => {
    const bySet = new Map();
    const byClass = new Map();
    for (const c of cases) {
      bySet.set(c.set, [...(bySet.get(c.set) ?? []), c.id]);
      const cls = typeof c.class === "string" && c.class ? c.class : "(none)";
      byClass.set(cls, (byClass.get(cls) ?? 0) + 1);
    }
    return { summary: summarize(cases), classes: [...byClass.entries()].sort(([a], [b]) => (a < b ? -1 : 1)), ids: [...bySet.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([set, list]) => [set, list.sort()]) };
  });
  return [
    `${summary.total} cases (ids and counts only; the text is never printed)`,
    ...countsBlock(summary),
    ...tableBlock(["class", "cases"], classes.map(([name, n]) => [name, String(n)])),
    ...ids.flatMap(([set, list]) => [`ids, set ${set}:`, `  ${list.join(" ")}`]),
  ];
}

function revealCommand(values) {
  const refusal = revealRefusal();
  if (refusal) throw new HoldoutError("reveal-refused", refusal);
  if (!values.id) throw new UsageError("reveal needs --id <case id>");
  const file = values.file ?? DEFAULT_SEALED_PATH;
  const key = loadKey({ keyFile: values["key-file"] });
  const c = findCase(open(readFileOrFail(file, "the sealed file"), key), values.id, key);
  return [
    `case ${c.id}${values.id === c.id ? "" : ` (asked for as ${values.id})`} (set ${c.set}, language ${c.language})`,
    JSON.stringify(c, null, 2),
    "",
    "A person has now read this case, so it is no longer blind: it moves to DEV, and a fresh one must be written for its place (from a new scenario, by the same kind of writer).",
    "To rotate: 1. copy the case into the dev set; 2. take it out of your plain hold-out file and add the fresh case; 3. seal again with --replace; 4. record the new sha256.",
  ];
}

async function main(argv) {
  const [command, ...rest] = argv;
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      file: { type: "string" },
      "key-file": { type: "string" },
      out: { type: "string" },
      replace: { type: "boolean" },
      id: { type: "string" },
      "expect-sha256": { type: "string" },
    },
  });
  switch (command) {
    case "keygen":
      return keygen();
    case "check":
      return checkCommand(positionals);
    case "seal":
      return sealCommand(positionals, values);
    case "verify":
      return verifyCommand(values);
    case "aggregate":
      return aggregateCommand(values);
    case "reveal":
      return revealCommand(values);
    default:
      throw new UsageError(command ? `unknown command ${command}` : "no command given");
  }
}

try {
  const lines = await main(process.argv.slice(2));
  process.stdout.write(lines.join("\n") + "\n");
} catch (e) {
  if (e instanceof HoldoutError) {
    process.stderr.write(`error: ${e.message}\n`);
    process.exitCode = 1;
  } else if (e instanceof UsageError || String(e?.code).startsWith("ERR_PARSE_ARGS")) {
    process.stderr.write(`error: ${e.message}\n${USAGE}\n`);
    process.exitCode = 2;
  } else {
    // an unknown failure may carry text of a case in its message: only its kind is printed
    process.stderr.write(`error: unexpected failure (${e?.name ?? "Error"})\n`);
    process.exitCode = 1;
  }
}
