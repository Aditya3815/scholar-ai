// Adds the recordings a replay run reported as missing, without re-recording everything:
//   npm run eval 2>&1 | grep "^  GET "      # the missing requests
//   node eval/patch-fixtures.mjs "GET https://api.openalex.org/works?..." ...      (or --from-file requests.txt, one per line)
// (add --prior-art first to patch the prior-art recording, fixtures-prior-art.json.gz, instead of the citation one)
// Each request is fetched live (keys from .dev.vars), trimmed and scrubbed exactly like a normal recording, and merged into fixtures.json.gz.
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { trimBody } from "./lib/trim.mjs";

const priorArt = process.argv.includes("--prior-art");
const file = new URL(priorArt ? "./fixtures-prior-art.json.gz" : "./fixtures.json.gz", import.meta.url);
const vars = {};
try {
  for (const line of readFileSync(new URL("../.dev.vars", import.meta.url), "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) vars[m[1]] = m[2].trim().replace(/^"|"$/g, "");
  }
} catch {
  /* no .dev.vars: keys may come from the environment, and OpenAlex and Crossref also answer (more slowly) without one */
}
for (const k of ["OPENALEX_API_KEY", "CROSSREF_MAILTO", "CORE_API_KEY"]) vars[k] ??= process.env[k];
vars.CROSSREF_MAILTO ??= "eval@example.org";
const fixtures = JSON.parse(gunzipSync(readFileSync(file)).toString("utf8"));

let added = 0;
let skipped = 0;
// `--from-file <path>`: one request per line (a long list does not fit on the command line)
const ffIdx = process.argv.indexOf("--from-file");
const fromFile = ffIdx > 0 ? readFileSync(process.argv[ffIdx + 1], "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : [];
const rest = process.argv.slice(2).filter((a, i, all) => a !== "--prior-art" && a !== "--from-file" && all[i - 1] !== "--from-file");
for (const arg of [...rest, ...fromFile]) {
  const key = arg.replace(/^GET /, "");
  const u = new URL(key);
  if (u.host === "api.openalex.org" && vars.OPENALEX_API_KEY) u.searchParams.set("api_key", vars.OPENALEX_API_KEY);
  if (u.host === "api.crossref.org") u.searchParams.set("mailto", vars.CROSSREF_MAILTO);
  const isCore = u.host === "api.core.ac.uk";
  if (isCore && !vars.CORE_API_KEY) { console.error(`not recorded (no CORE_API_KEY): ${key}`); process.exitCode = 1; continue; }
  // CORE allows ten requests a minute: one every seven seconds, and a 429 is waited out (its reset time is in the response) rather than recorded
  if (isCore && added + skipped > 0) await new Promise((r) => setTimeout(r, 7000));
  const headers = u.host === "api.crossref.org" ? { "User-Agent": `ScholarRefCheck/0.1 (mailto:${vars.CROSSREF_MAILTO})` } : isCore ? { Authorization: `Bearer ${vars.CORE_API_KEY}` } : {};
  let res = await fetch(u, { headers });
  if (isCore && res.status === 429) {
    const until = Date.parse(res.headers.get("x-ratelimit-retry-after") ?? "");
    await new Promise((r) => setTimeout(r, Math.min(Math.max(until - Date.now(), 1000) + 1000, 70_000)));
    res = await fetch(u, { headers });
  }
  if (res.status === 429 || res.status >= 500) { console.error(`not recorded (HTTP ${res.status}): ${key}`); process.exitCode = 1; skipped++; continue; }
  const stored = new URL(key);
  for (const k of ["api_key", "mailto"]) stored.searchParams.delete(k);
  stored.searchParams.sort();
  const k = `GET ${stored.origin}${stored.pathname}?${stored.searchParams.toString()}`;
  fixtures[k] = { s: res.status, b: trimBody(stored.toString(), await res.text()) };
  console.log(`recorded (HTTP ${res.status}): ${k.slice(0, 120)}`);
  added++;
}
if (added) {
  const sorted = Object.fromEntries(Object.entries(fixtures).sort(([a], [b]) => (a < b ? -1 : 1)));
  writeFileSync(file, gzipSync(JSON.stringify(sorted), { level: 9 }));
}
console.log(`${added} recording(s) added`);
