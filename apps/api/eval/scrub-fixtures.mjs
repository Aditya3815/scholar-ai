// Re-applies the current trimming/scrubbing to an existing recording (no network): node eval/scrub-fixtures.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { trimBody } from "./lib/trim.mjs";

const file = fileURLToPath(new URL("./fixtures.json.gz", import.meta.url));
const fx = JSON.parse(gunzipSync(readFileSync(file)).toString("utf8"));
const before = gunzipSync(readFileSync(file)).length;
for (const [key, v] of Object.entries(fx)) v.b = trimBody(key.slice(key.indexOf(" ") + 1), v.b);
const out = JSON.stringify(fx);
writeFileSync(file, gzipSync(out, { level: 9 }));
const emails = (out.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []).filter((e) => e !== "redacted@example.invalid");
console.log(`fixtures: ${Object.keys(fx).length}, ${(before / 1e6).toFixed(1)} MB -> ${(out.length / 1e6).toFixed(1)} MB uncompressed, remaining real emails: ${emails.length}`);
