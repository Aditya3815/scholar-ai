// Uploads secrets from apps/api/.dev.vars to the production Worker (`wrangler secret bulk`).
// Values never touch the command line or the terminal output; only key names are printed.
//
//   npm run secrets:push -w apps/api            # pushes every key below that is set in .dev.vars
//   npm run secrets:push -w apps/api -- --dry   # shows which keys WOULD be pushed
//   npm run secrets:push -w apps/api -- --only=GOOGLE_CLIENT_ID,GOOGLE_CLIENT_SECRET
//
// Dev-only flags are NEVER pushed: ENABLE_DEV_ROUTES would expose the free LLM smoke route, and DEV_IDP_URL would
// redirect logins to a fake provider.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const NEVER = new Set(["ENABLE_DEV_ROUTES", "DEV_IDP_URL"]);
const dry = process.argv.includes("--dry");
const root = fileURLToPath(new URL("..", import.meta.url));

const values = {};
for (const line of readFileSync(join(root, ".dev.vars"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z][A-Z0-9_]*)=(.+)$/);
  if (m && !NEVER.has(m[1])) values[m[1]] = m[2].trim();
}
// --only A,B pushes just those keys (least privilege: do not upload a key to production before a feature needs it).
const onlyArg = process.argv.find((a) => a.startsWith("--only="))?.slice("--only=".length);
if (onlyArg) {
  const only = new Set(onlyArg.split(",").map((s) => s.trim()).filter(Boolean));
  for (const k of Object.keys(values)) if (!only.has(k)) delete values[k];
  for (const k of only) if (!(k in values)) console.log(`note: ${k} is not set in .dev.vars (or is a dev-only key) and was skipped`);
}
const keys = Object.keys(values);
if (keys.length === 0) { console.log("nothing to push"); process.exit(0); }
console.log(`${dry ? "would push" : "pushing"} ${keys.length} secrets: ${keys.join(", ")}`);
if (dry) process.exit(0);

const dir = mkdtempSync(join(tmpdir(), "scholar-secrets-"));
const file = join(dir, "secrets.json");
try {
  writeFileSync(file, JSON.stringify(values), { encoding: "utf8", mode: 0o600 }); // UTF-8 without BOM
  const r = spawnSync("npx", ["wrangler", "secret", "bulk", file], { cwd: root, stdio: "inherit", shell: true });
  process.exit(r.status ?? 1);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
