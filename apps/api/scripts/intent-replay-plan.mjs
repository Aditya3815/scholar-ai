// Dry-run plan for recording the provider answers of the intent eval's retrieval replay (docs/design/intent-and-state.md, 8.3, L2). It reads the case files and prints what the
// recording WOULD ask: three variants of each message (raw, read, oracle), the number of distinct searches, the provider requests, and what it costs on OpenAlex. It makes no network
// call and records nothing: the recording has its own day and budget (docs/eval/openalex-budget.md).
//
//   node apps/api/scripts/intent-replay-plan.mjs [--cases <file>] [--controls <file>] [--reader <module>] [--exclude-sets a,b] [--json]
//
// Without --cases and --controls it reads apps/api/eval/data/intent-cases.json and intent-controls.json, and says so when one is not there yet. --reader is a local module whose default
// export is (text, case) => the product's topic for the message (the reader of R8, when it exists); without it the read rows wait. --json prints the whole plan, rows included:
// {caseId, source, variant, query}. The sealed hold-out is never read here. Exit code 1 when a file cannot be read or a case has a problem, 2 for a wrong option.
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { DEFAULT_CASES_PATH, DEFAULT_CONTROLS_PATH, DEFAULT_EXCLUDED_SETS, buildReplayPlan, casesOf, formatPlan } from "./lib/intent-replay-plan.mjs";

const USAGE = `usage: node apps/api/scripts/intent-replay-plan.mjs [--cases f] [--controls f] [--reader module] [--exclude-sets a,b] [--json]
  --cases, --controls   case files (default: apps/api/eval/data/intent-cases.json and intent-controls.json, if they exist)
  --reader              a module whose default export is (text, case) => topic; without it the read rows wait
  --exclude-sets        sets left out (default: ${DEFAULT_EXCLUDED_SETS.join(",")}; an empty value leaves none out)
  --json                print the whole plan as JSON, with the rows`;

class Failure extends Error {}

/** The case list of a file; null for a default file that is not there (yet). A file asked for by name must exist. */
function readList(path, asked) {
  if (!asked && !existsSync(path)) return null;
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    throw new Failure(`cannot read ${path} (${e?.code ?? "error"})`);
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Failure(`${path} is not valid JSON`);
  }
  const list = casesOf(json);
  if (!list) throw new Failure(`${path} must hold a list of cases (or an object with a "cases" list)`);
  return list;
}

async function loadReader(path) {
  let mod;
  try {
    mod = await import(pathToFileURL(resolve(path)).href);
  } catch (e) {
    throw new Failure(`cannot load the reader ${path} (${e?.code ?? e?.name ?? "error"})`);
  }
  const fn = mod.default ?? mod.readTopic;
  if (typeof fn !== "function") throw new Failure(`the reader ${path} must export a function as its default`);
  return fn;
}

async function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: { cases: { type: "string" }, controls: { type: "string" }, reader: { type: "string" }, "exclude-sets": { type: "string" }, json: { type: "boolean" } },
  });
  const notes = [];
  const sets = {};
  for (const [name, asked, fallback] of [["cases", values.cases, DEFAULT_CASES_PATH], ["controls", values.controls, DEFAULT_CONTROLS_PATH]]) {
    const path = asked ?? fallback;
    const list = readList(path, asked !== undefined);
    if (list === null) notes.push(`${basename(path)}: not there yet (it is written by another part of E0); planned without it`);
    else sets[name] = list;
  }
  const excludeSets = values["exclude-sets"] === undefined ? undefined : values["exclude-sets"].split(",").map((s) => s.trim()).filter(Boolean);
  const readTopic = values.reader ? await loadReader(values.reader) : undefined;
  const plan = buildReplayPlan(sets, { readTopic, ...(excludeSets ? { excludeSets } : {}) });
  const text = values.json ? JSON.stringify({ ...plan, notes }, null, 2) : [...notes, ...formatPlan(plan)].join("\n");
  process.stdout.write(text + "\n");
  if (plan.problems.length) process.exitCode = 1;
}

try {
  await main(process.argv.slice(2));
} catch (e) {
  if (e instanceof Failure) {
    process.stderr.write(`error: ${e.message}\n`);
    process.exitCode = 1;
  } else if (String(e?.code).startsWith("ERR_PARSE_ARGS")) {
    process.stderr.write(`error: ${e.message}\n${USAGE}\n`);
    process.exitCode = 2;
  } else {
    throw e;
  }
}
