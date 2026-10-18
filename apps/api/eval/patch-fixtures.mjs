// Adds the recordings a replay run reported as missing, without re-recording everything:
//   npm run eval 2>&1 | grep "^  GET "      # the missing requests
//   node eval/patch-fixtures.mjs "GET https://api.openalex.org/works?..." ...
// Each request is fetched live (keys from .dev.vars), trimmed and scrubbed exactly like a normal recording, and merged into fixtures.json.gz.
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { trimBody } from "./lib/trim.mjs";

const file = new URL("./fixtures.json.gz", import.meta.url);
const vars = {};
for (const line of readFileSync(new URL("../.dev.vars", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) vars[m[1]] = m[2].trim().replace(/^"|"$/g, "");
}
const fixtures = JSON.parse(gunzipSync(readFileSync(file)).toString("utf8"));

let added = 0;
for (const arg of process.argv.slice(2)) {
  const key = arg.replace(/^GET /, "");
  const u = new URL(key);
  if (u.host === "api.openalex.org" && vars.OPENALEX_API_KEY) u.searchParams.set("api_key", vars.OPENALEX_API_KEY);
  if (u.host === "api.crossref.org") u.searchParams.set("mailto", vars.CROSSREF_MAILTO);
  const res = await fetch(u, { headers: u.host === "api.crossref.org" ? { "User-Agent": `ScholarRefCheck/0.1 (mailto:${vars.CROSSREF_MAILTO})` } : {} });
  if (res.status === 429 || res.status >= 500) { console.error(`not recorded (HTTP ${res.status}): ${key}`); process.exitCode = 1; continue; }
  const stored = new URL(key);
  for (const k of ["api_key", "mailto"]) stored.searchParams.delete(k);
  stored.searchParams.sort();
  const k = `GET ${stored.origin}${stored.pathname}?${stored.searchParams.toString()}`;
  fixtures[k] = { s: res.status, b: trimBody(stored.toString(), await res.text()) };
  console.log(`recorded (HTTP ${res.status}): ${k.slice(0, 120)}`);
  added++;
}
if (added) writeFileSync(file, gzipSync(JSON.stringify(Object.fromEntries(Object.entries(fixtures).sort(([a], [b]) => (a < b ? -1 : 1))), { level: 9 }));
console.log(`${added} recording(s) added`);
