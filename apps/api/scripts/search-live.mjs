// Runs the real search code against the real services (no Worker, no cache): node scripts/search-live.mjs "SwinYolo" "glaucoma screening"
// Needs OPENALEX_API_KEY and S2_API_KEY in the environment (apps/api/.dev.vars). Shows what each source returned and what was searched as well.
import { build } from "esbuild";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "live-search-"));
await build({ entryPoints: { search: join(root, "apps/api/src/search/index.ts"), store: join(root, "apps/api/src/cache/store.ts") }, bundle: true, format: "esm", platform: "node", outdir: tmp, logLevel: "silent", splitting: true, external: [] });
const { runSearch } = await import(pathToFileURL(join(tmp, "search.js")).href);
const { memoryStore } = await import(pathToFileURL(join(tmp, "store.js")).href);
for (const q of process.argv.slice(2)) {
  const env = { store: memoryStore(), OPENALEX_API_KEY: process.env.OPENALEX_API_KEY, S2_API_KEY: process.env.S2_API_KEY, CROSSREF_MAILTO: process.env.CROSSREF_MAILTO ?? "t@example.org" };
  const t0 = Date.now();
  const r = await runSearch(env, q, 20);
  console.log(`\n"${q}": ${r.results.length} papers in ${Date.now() - t0} ms; also searched: ${JSON.stringify(r.alsoSearched ?? [])}; providers: ${Object.entries(r.providers).map(([k, v]) => `${k}=${v.ok ? v.count : "FAIL"}`).join(" ")}`);
  r.results.slice(0, 8).forEach((p, i) => console.log(`  ${i + 1}. ${p.year ?? "----"} ${p.title.slice(0, 90)}  [${p.sources.join(",")}]`));
}
