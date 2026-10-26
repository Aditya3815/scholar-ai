// Spike R8, part 2: how often can a SERVER fetch the open-access PDF that a search result points at?
// Takes real open-access works about our kind of topics from OpenAlex (best_oa_location.pdf_url), tries each link the way the app would (polite User-Agent, HTTPS only, follow
// at most 3 redirects, 25 MB cap, must start with %PDF-), and reports by host. Saves what it could fetch into ./pdfs for run.mjs.
//   node fetchability.mjs [perTopic=6]
import { mkdirSync, writeFileSync, existsSync } from "node:fs";

const MAILTO = "tiadiaditya@gmail.com";
const UA = `scholar-ai-spike/1.0 (mailto:${MAILTO})`;
const PER = Number(process.argv[2] ?? 6);
const TOPICS = ["glaucoma screening", "diabetes exercise", "tuberculosis vaccine", "machine learning crop yield", "air pollution asthma children", "mindfulness student anxiety", "NEP 2020 higher education India"];
mkdirSync(new URL("./pdfs/", import.meta.url), { recursive: true });

async function works(topic) {
  const u = new URL("https://api.openalex.org/works");
  u.searchParams.set("search", topic);
  u.searchParams.set("filter", "is_oa:true,open_access.any_repository_has_fulltext:false,type:article");
  u.searchParams.set("select", "id,doi,title,best_oa_location");
  u.searchParams.set("per-page", String(PER * 3));
  u.searchParams.set("mailto", MAILTO);
  const r = await fetch(u, { headers: { "User-Agent": UA } });
  return (await r.json()).results ?? [];
}

async function tryFetch(url) {
  let cur = url;
  for (let hop = 0; hop <= 3; hop++) {
    const u = new URL(cur);
    // a plain-http link is tried once as https (many publishers list the old address); never fetched over http
    if (u.protocol === "http:") { u.protocol = "https:"; cur = u.href; }
    if (u.protocol !== "https:") return { ok: false, why: "not https" };
    const r = await fetch(cur, { headers: { "User-Agent": UA, Accept: "application/pdf,*/*;q=0.5" }, redirect: "manual", signal: AbortSignal.timeout(25000) });
    if ([301, 302, 303, 307, 308].includes(r.status)) { cur = new URL(r.headers.get("location") ?? "", cur).href; continue; }
    const type = r.headers.get("content-type") ?? "";
    if (!r.ok) return { ok: false, why: `HTTP ${r.status}` };
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length > 25 * 1048576) return { ok: false, why: "over 25 MB" };
    const magic = new TextDecoder().decode(buf.slice(0, 5));
    if (magic !== "%PDF-") return { ok: false, why: `not a PDF (${type.split(";")[0] || "no type"})` };
    return { ok: true, buf, mb: +(buf.length / 1048576).toFixed(2) };
  }
  return { ok: false, why: "too many redirects" };
}

const rows = [];
let n = 0;
for (const topic of TOPICS) {
  let taken = 0;
  for (const w of await works(topic)) {
    const loc = w.best_oa_location;
    if (!loc?.pdf_url || taken >= PER) continue;
    taken++;
    const host = new URL(loc.pdf_url).hostname.replace(/^www\./, "");
    let res;
    try { res = await tryFetch(loc.pdf_url); } catch (e) { res = { ok: false, why: e?.name === "TimeoutError" ? "timeout 25 s" : String(e.message ?? e).slice(0, 60) }; }
    const name = `oa-${String(++n).padStart(2, "0")}-${host.replace(/[^a-z0-9]+/g, "-").slice(0, 24)}`;
    if (res.ok) writeFileSync(new URL(`./pdfs/${name}.pdf`, import.meta.url), res.buf);
    rows.push({ topic, host, url: loc.pdf_url, license: loc.license ?? null, ok: res.ok, why: res.why, mb: res.mb, name: res.ok ? name : undefined });
    console.log(`${res.ok ? "ok  " : "FAIL"} ${host.padEnd(34)} ${String(loc.license ?? "-").padEnd(10)} ${res.ok ? res.mb + " MB" : res.why}`);
    await new Promise((r) => setTimeout(r, host.includes("arxiv") ? 3200 : 700));
  }
}
const by = {};
for (const r of rows) { by[r.host] ??= { ok: 0, bad: 0 }; r.ok ? by[r.host].ok++ : by[r.host].bad++; }
console.log(`\n${rows.filter((r) => r.ok).length} of ${rows.length} fetched as a PDF`);
for (const [h, v] of Object.entries(by).sort((a, b) => b[1].ok + b[1].bad - (a[1].ok + a[1].bad))) console.log(`  ${h.padEnd(36)} ${v.ok} ok, ${v.bad} failed`);
writeFileSync(new URL("./fetchability.json", import.meta.url), JSON.stringify(rows, null, 2));
