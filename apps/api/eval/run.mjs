// `node eval/run.mjs record|live`: loads API keys from apps/api/.dev.vars, then runs the eval against the real APIs.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const mode = process.argv[2];
if (!["record", "live"].includes(mode)) { console.error("usage: node eval/run.mjs record|live"); process.exit(2); }
const root = fileURLToPath(new URL("..", import.meta.url));

const env = { ...process.env, EVAL_MODE: mode };
try {
  for (const line of readFileSync(root + ".dev.vars", "utf8").split(/\r?\n/)) {
    const m = line.match(/^(OPENALEX_API_KEY|NCBI_API_KEY|S2_API_KEY|CORE_API_KEY|CROSSREF_MAILTO)=(.+)$/);
    if (m && !env[m[1]]) env[m[1]] = m[2].trim();
  }
} catch { /* in CI the keys come from the environment (repository secrets) */ }

const missing = ["OPENALEX_API_KEY", "S2_API_KEY", "CROSSREF_MAILTO"].filter((k) => !env[k]);
if (missing.length) { console.error(`missing ${missing.join(", ")}: needed for ${mode} mode`); process.exit(2); }

const r = spawnSync("npx", ["vitest", "run", "-c", "vitest.eval.config.ts"], { cwd: root, env, stdio: "inherit", shell: true });
process.exit(r.status ?? 1);
