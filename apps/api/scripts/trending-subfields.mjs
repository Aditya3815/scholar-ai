// Makes the table of subfields behind the Trending feed (packages/shared/src/subfield-policy.ts, docs/design/chatview-and-trending.md T6) from OpenAlex's live list.
//   node scripts/trending-subfields.mjs              fetch https://api.openalex.org/subfields (2 requests) and rewrite the rows of the file
//   node scripts/trending-subfields.mjs --check      fetch, compare with the file, write nothing; exit 1 if OpenAlex's list differs from the table
//   node scripts/trending-subfields.mjs --from <page1.json> [<page2.json> ...]   the same from saved pages (no network)
// The file's decisions (allow, hold, never) are kept; a subfield that is new to the file is held, and the first run uses the rules in lib/trending-subfields.mjs. The owner reads the
// table once: change a decision by editing the policy word on its line. An OPENALEX_API_KEY in the environment is sent if there is one (never printed); without one the two requests
// share OpenAlex's small free daily budget, which is enough.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { countBy, mergeRows, parseLive, readRows, renderRows, replaceBlock } from "./lib/trending-subfields.mjs";

const TARGET = fileURLToPath(new URL("../../../packages/shared/src/subfield-policy.ts", import.meta.url));
const MAILTO = "tiadiaditya@gmail.com";
const args = process.argv.slice(2);
const check = args.includes("--check");
const fromAt = args.indexOf("--from");

async function livePages() {
  if (fromAt >= 0) return args.slice(fromAt + 1).map((p) => JSON.parse(readFileSync(p, "utf8")));
  const pages = [];
  for (let page = 1; page <= 5; page++) {
    const url = new URL("https://api.openalex.org/subfields");
    url.search = new URLSearchParams({ "per-page": "200", page: String(page), select: "id,display_name,field,domain", mailto: MAILTO, ...(process.env.OPENALEX_API_KEY ? { api_key: process.env.OPENALEX_API_KEY } : {}) }).toString();
    const res = await fetch(url, { headers: { "user-agent": `sodhsetu-trending-subfields (mailto:${MAILTO})` }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`OpenAlex answered ${res.status} for page ${page}`);
    const body = await res.json();
    pages.push(body);
    if ((body.results ?? []).length < 200) break;
  }
  return pages;
}

const text = readFileSync(TARGET, "utf8");
const existing = readRows(text);
const live = parseLive(await livePages());
const { rows, added, removed, renamed } = mergeRows(live, existing.size ? existing : null);
const next = replaceBlock(text, renderRows(rows));

console.log(`${live.length} subfields from OpenAlex; the file had ${existing.size}.`);
console.log("policy:", JSON.stringify(countBy(rows, "policy")), " domains:", JSON.stringify(countBy(rows, "domain")));
for (const [label, list] of [["new (held)", added], ["gone from OpenAlex", removed], ["renamed (held again)", renamed]]) if (list.length) console.log(`${label}:\n  ${list.join("\n  ")}`);

if (check) {
  const same = next === text && !added.length && !removed.length && !renamed.length;
  console.log(same ? "The table matches OpenAlex's list." : "The table does NOT match OpenAlex's list: run this script without --check, then read the changes.");
  process.exit(same ? 0 : 1);
}
if (next === text) console.log("Nothing to change.");
else {
  writeFileSync(TARGET, next);
  console.log(`Wrote ${TARGET}`);
}
