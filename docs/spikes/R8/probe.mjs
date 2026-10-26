// Spike R8, part 3: the same open-access PDF links as fetchability.mjs, fetched by Cloudflare's network (wrangler dev --remote) instead of a laptop.
//   npx wrangler dev --remote --port 8800   (in another terminal);  node probe.mjs
import { readFileSync, writeFileSync } from "node:fs";
const rows = JSON.parse(readFileSync(new URL("./fetchability.json", import.meta.url), "utf8"));
const out = [];
for (const [i, r] of rows.entries()) {
  const url = r.url;
  if (!url) continue;
  const res = await (await fetch(`http://localhost:8800/probe?url=${encodeURIComponent(url)}`)).json();
  out.push({ host: r.host, laptop: r.ok, cloudflare: res.pdf === true, status: res.status });
  console.log(`${r.ok ? "laptop ok " : "laptop bad"}  ${res.pdf ? "cloudflare ok " : "cloudflare bad"} ${String(res.status).padStart(3)}  ${r.host}`);
  await new Promise((r2) => setTimeout(r2, 400));
}
const both = out.filter((o) => o.laptop === o.cloudflare).length;
console.log(`\nlaptop ${out.filter((o) => o.laptop).length} of ${out.length}, cloudflare ${out.filter((o) => o.cloudflare).length} of ${out.length}; same answer for ${both}`);
writeFileSync(new URL("./probe.json", import.meta.url), JSON.stringify(out, null, 2));
