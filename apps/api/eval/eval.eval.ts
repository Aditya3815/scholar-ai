// Citation-accuracy eval. Runs the REAL search pipeline and Reference Verifier code against frozen datasets.
//   npm run eval -w apps/api            replay recorded API responses (CI: deterministic, offline, free)
//   npm run eval:record -w apps/api     refresh the recordings from the live APIs (~40 min, ~$0.15 of OpenAlex)
//   npm run eval:live -w apps/api       hit live APIs without saving (weekly drift check)
//   EVAL_QUICK=1 + eval:live            ~10 min subset while iterating on the code (never saved, never gates a release)
// The gates below are hard failures. "0 fabricated citations" is the product's core promise.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { memoryStore } from "../src/cache/store";
import { crossrefByDoi, doiResolves } from "../src/references/lookup";
import { tokenize } from "../src/references/match";
import { verifyReference, type RefResult } from "../src/references/verify";
import { runSearch } from "../src/search";
import { findRetracted } from "../src/search/retraction";
import { FetchLayer, type Mode } from "./lib/fetch-layer";
// @ts-expect-error plain .mjs helper shared with the dataset builders
import { formatRef, stripRetractionBanner } from "./lib/text.mjs";

/* ---------- thresholds ---------- */
const GATES = {
  unresolvableDois: 0, // every DOI the search RETURNS must resolve at doi.org (the pipeline removes the ones that do not)
  titleMismatchDois: 0, // ...and agree with Crossref's title
  retractionRecall: 1.0, // all known retracted papers detected
  retractionFalsePositives: 0, // no ordinary paper flagged
  fakesVerified: 0, // NO fabricated reference may come back verified
  realRefsVerified: 0.9, // share of genuine references we verify
  knownItemRecallAt10: 0.9,
  topicalRecallAt10: 0.85,
  providerFailureRate: 0.05,
  // Held-out set (never tuned on). Thresholds are regression guards set just below the first honest measurement.
  heldoutFakesVerified: 0,
  heldoutRealRefsVerified: 0.88, // measured 93% (56/60) on 2026-10-18
  heldoutKnownItemRecallAt10: 0.92, // measured 97% (58/60)
};

const MODE = (process.env.EVAL_MODE ?? "replay") as Mode;
const QUICK = process.env.EVAL_QUICK === "1" && MODE !== "replay";
const HERE = fileURLToPath(new URL(".", import.meta.url));
const read = <T>(f: string) => JSON.parse(readFileSync(HERE + "data/" + f, "utf8")) as T;
const subset = <T>(a: T[], n: number): T[] => (QUICK ? a.filter((_, i) => i % Math.ceil(a.length / n) === 0) : a);

type Paper = { doi: string; title: string; year: number; authors: { given: string; family: string }[]; venue: string | null; topic: string; field: string };
type Retracted = { doi: string; title: string; year: number };
type Fake = { id: string; kind: string; expect: string[]; text: string; note: string };
type Topical = { q: string; title?: string; expect: string[] };
const papers = subset(read<Paper[]>("papers.json"), 25);
const retracted = subset(read<Retracted[]>("retracted.json"), 6);
const fakes = subset(read<Fake[]>("fake_refs.json"), 12);
const topical = subset(read<Topical[]>("topical.json"), 8);
type HeldPaper = Paper & { group: "india" | "global" };
const heldPapers = subset(read<HeldPaper[]>("heldout_papers.json"), 12);
const heldFakes = subset(read<Fake[]>("heldout_fakes.json"), 10);

const env = {
  store: memoryStore(),
  OPENALEX_API_KEY: process.env.OPENALEX_API_KEY ?? "eval",
  NCBI_API_KEY: process.env.NCBI_API_KEY ?? "eval",
  S2_API_KEY: process.env.S2_API_KEY ?? "eval",
  CROSSREF_MAILTO: process.env.CROSSREF_MAILTO ?? "eval@example.org",
};

const layer = new FetchLayer(MODE, HERE + "fixtures.json.gz");
const log = (s: string) => process.stdout.write(s + "\n");

const wordSet = (s: string) => new Set(tokenize(s));
/** Same paper? Symmetric word overlap, so "Faculty Opinions recommendation of X" does NOT count as X. */
const jaccard = (a: string, b: string) => {
  const A = wordSet(a), B = wordSet(b);
  const i = [...A].filter((t) => B.has(t)).length;
  const u = new Set([...A, ...B]).size;
  return u ? i / u : 0;
};
/** Is one title (nearly) contained in the other? Used to catch a DOI whose registered title contradicts ours. */
const containment = (a: string, b: string) => {
  const A = wordSet(a), B = wordSet(b);
  const i = [...A].filter((t) => B.has(t)).length;
  return A.size && B.size ? Math.max(i / A.size, i / B.size) : 0;
};
const samePaper = (a: string, b: string) => jaccard(a, b) >= 0.8;
const mainTitle = (t: string) => {
  const head = t.split(":")[0]!.trim();
  return head.split(/\s+/).length >= 3 ? head : t;
};

/* ---------- results ---------- */
type SearchRun = { q: string; dois: string[]; titles: string[]; retracted: boolean[]; sources: string[][]; doiDropped: number };
const DETAIL: Record<string, string[]> = { unresolvable: [], titleMismatch: [], topicalMiss: [], retractedSearch: [], fakeVerified: [], genuineMiss: [], knownItemMiss: [], heldKnownMiss: [], heldGenuineMiss: [], heldFakeVerified: [] };
const M = {} as {
  knownItem: { hits10: number; hits20: number; mrr: number };
  topical: { hits10: number };
  retractedSearch: { foundByDoi: number; foundOnlyAsOtherRecord: number; flagged: number };
  retraction: { detected: number; total: number; falsePositives: string[] };
  integrity: { checked: number; unresolvable: string[]; unknown: number; titleMismatch: string[]; noCrossref: number };
  doiPipeline: { removed: number; checkFailures: number; searches: number };
  verifier: { real: { verified: number; byStatus: Record<string, number>; retractedFlags: number }; fakes: { verified: Fake[]; expected: number; byKind: Record<string, Record<string, number>> } };
  providers: { runs: number; failures: number };
  heldout: {
    knownItem: { hits10: number; hits20: number; byGroup: Record<string, { n: number; hits10: number }> };
    real: { verified: number; byStatus: Record<string, number>; byGroup: Record<string, { n: number; verified: number }> };
    fakes: { verified: Fake[]; expected: number; byKind: Record<string, Record<string, number>> };
  };
};

async function search(q: string): Promise<SearchRun> {
  const r = await runSearch(env, q, 20);
  M.providers.runs += Object.keys(r.providers).length;
  M.providers.failures += Object.values(r.providers).filter((p) => !p.ok).length;
  M.doiPipeline.searches++;
  M.doiPipeline.removed += r.doiCheck.count;
  if (!r.doiCheck.ok) M.doiPipeline.checkFailures++;
  return {
    q,
    dois: r.results.map((x) => x.doi ?? ""),
    titles: r.results.map((x) => x.title),
    retracted: r.results.map((x) => x.retracted),
    sources: r.results.map((x) => x.sources),
    doiDropped: r.doiCheck.count,
  };
}

const rankOf = (run: SearchRun, doi: string, title: string): number => {
  const i = run.dois.findIndex((d, k) => d === doi || samePaper(run.titles[k]!, title));
  return i < 0 ? 0 : i + 1;
};

beforeAll(async () => {
  layer.install();
  M.providers = { runs: 0, failures: 0 };
  M.doiPipeline = { removed: 0, checkFailures: 0, searches: 0 };
  const allResults: { doi: string; title: string; sources: string[]; q: string }[] = [];
  const keep = (run: SearchRun) => run.dois.forEach((d, i) => d && allResults.push({ doi: d, title: run.titles[i]!, sources: run.sources[i]!, q: run.q }));

  /* 1. known-item search: can a scholar find a paper by its title? */
  M.knownItem = { hits10: 0, hits20: 0, mrr: 0 };
  for (const [i, p] of papers.entries()) {
    const run = await search(mainTitle(p.title));
    keep(run);
    const rank = rankOf(run, p.doi, p.title);
    if (rank >= 1) M.knownItem.hits20++;
    if (rank >= 1 && rank <= 10) M.knownItem.hits10++;
    else DETAIL.knownItemMiss!.push(`${rank ? `rank ${rank}` : "not in top 20"}: ${p.title.slice(0, 100)}`);
    if (rank) M.knownItem.mrr += 1 / rank;
    if ((i + 1) % 25 === 0) log(`  searched ${i + 1}/${papers.length} known items`);
  }
  M.knownItem.mrr /= papers.length;

  /* 1b. the same on the HELD-OUT papers (random sample, half Indian-affiliated): what a scholar looking for an ordinary paper sees */
  M.heldout = { knownItem: { hits10: 0, hits20: 0, byGroup: {} }, real: { verified: 0, byStatus: {}, byGroup: {} }, fakes: { verified: [], expected: 0, byKind: {} } };
  for (const p of heldPapers) {
    const run = await search(mainTitle(p.title));
    keep(run);
    const rank = rankOf(run, p.doi, p.title);
    const g = (M.heldout.knownItem.byGroup[p.group] ??= { n: 0, hits10: 0 });
    g.n++;
    if (rank >= 1) M.heldout.knownItem.hits20++;
    if (rank >= 1 && rank <= 10) { M.heldout.knownItem.hits10++; g.hits10++; }
    else DETAIL.heldKnownMiss!.push(`[${p.group}] ${rank ? `rank ${rank}` : "not in top 20"}: ${p.title.slice(0, 100)}`);
  }
  log(`  searched ${heldPapers.length} held-out known items`);

  /* 2. topical landmarks: the famous paper (any of its DOIs, or the same title) in the top 10 */
  M.topical = { hits10: 0 };
  for (const t of topical) {
    const run = await search(t.q);
    keep(run);
    const top = run.dois.slice(0, 10).map((d, i) => ({ d, title: run.titles[i]! }));
    if (top.some((x) => t.expect.includes(x.d) || (t.title && samePaper(x.title, t.title)))) M.topical.hits10++;
    else DETAIL.topicalMiss!.push(`"${t.q}": expected ${t.expect.join(" | ")}; top3: ${run.titles.slice(0, 3).map((x) => x.slice(0, 55)).join(" // ")}`);
  }

  /* 3. retracted papers: found by title (by its own DOI), and flagged? */
  M.retractedSearch = { foundByDoi: 0, foundOnlyAsOtherRecord: 0, flagged: 0 };
  for (const r of retracted) {
    const clean = stripRetractionBanner(r.title);
    const run = await search(mainTitle(clean));
    keep(run);
    const at = run.dois.indexOf(r.doi);
    if (at >= 0) {
      M.retractedSearch.foundByDoi++;
      if (run.retracted[at]) M.retractedSearch.flagged++;
      else DETAIL.retractedSearch!.push(`${r.doi} returned but NOT flagged retracted: ${clean.slice(0, 80)}`);
    } else if (run.titles.some((t) => samePaper(t, clean))) M.retractedSearch.foundOnlyAsOtherRecord++;
  }

  /* 4. retraction detection straight from Retraction Watch via Crossref, plus a no-false-positive control */
  const retractedDois = retracted.map((r) => r.doi);
  const detected = await findRetracted(retractedDois, env, AbortSignal.timeout(60_000));
  const control: string[] = [];
  for (let i = 0; i < papers.length; i += 25) control.push(...(await findRetracted(papers.slice(i, i + 25).map((p) => p.doi), env, AbortSignal.timeout(60_000))));
  M.retraction = { detected: retractedDois.filter((d) => detected.includes(d)).length, total: retractedDois.length, falsePositives: control };

  /* 5. citation integrity over EVERY DOI any search RETURNED (after the pipeline's own DOI check), verified independently */
  const uniq = new Map<string, string>();
  const meta = new Map<string, { sources: string[]; q: string }>();
  for (const r of allResults) if (!uniq.has(r.doi)) { uniq.set(r.doi, r.title); meta.set(r.doi, { sources: r.sources, q: r.q }); }
  M.integrity = { checked: uniq.size, unresolvable: [], unknown: 0, titleMismatch: [], noCrossref: 0 };
  let n = 0;
  for (const [doi, title] of uniq) {
    let ok: boolean | null = null;
    try { ok = await doiResolves(doi, env); } catch { ok = null; }
    if (ok === false) {
      M.integrity.unresolvable.push(doi);
      DETAIL.unresolvable!.push(`${doi} "${title.slice(0, 70)}" from [${meta.get(doi)!.sources.join(",")}] for "${meta.get(doi)!.q.slice(0, 50)}"`);
    } else if (ok === null) M.integrity.unknown++;
    try {
      const rec = await crossrefByDoi(doi, env);
      if (!rec) M.integrity.noCrossref++;
      else if (containment(title, rec.title) < 0.6) {
        M.integrity.titleMismatch.push(doi);
        DETAIL.titleMismatch!.push(`${doi} [${meta.get(doi)!.sources.join(",")}] ours: "${title.slice(0, 70)}" | crossref: "${rec.title.slice(0, 70)}"`);
      }
    } catch { /* Crossref hiccup: counted as unchecked */ }
    if (++n % 250 === 0) log(`  integrity-checked ${n}/${uniq.size} DOIs`);
  }

  /* 6. Reference Verifier: genuine references (5 formats) and fabricated ones */
  const byStatus: Record<string, number> = {};
  let retractedFlags = 0;
  for (const [i, p] of papers.entries()) {
    const text = formatRef(p, i);
    const r: RefResult = await verifyReference(text, env);
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    if (r.retracted) retractedFlags++;
    if (r.status !== "verified") DETAIL.genuineMiss!.push(`[${r.status}] ${text.slice(0, 120)} => ${r.reason.slice(0, 150)} checks=${JSON.stringify(r.checks)}`);
    if ((i + 1) % 25 === 0) log(`  verified ${i + 1}/${papers.length} genuine references`);
  }
  const fakeVerified: Fake[] = [];
  const byKind: Record<string, Record<string, number>> = {};
  let expected = 0;
  for (const f of fakes) {
    const r = await verifyReference(f.text, env);
    if (r.status === "verified") {
      fakeVerified.push(f);
      DETAIL.fakeVerified!.push(`${f.id} ${f.kind}: ${f.text}\n      => ${r.reason}\n      match=${JSON.stringify(r.match)} checks=${JSON.stringify(r.checks)}`);
    }
    if (f.expect.includes(r.status)) expected++;
    (byKind[f.kind] ??= {})[r.status] = (byKind[f.kind]![r.status] ?? 0) + 1;
  }
  for (const [i, p] of heldPapers.entries()) {
    const text = formatRef(p, i);
    const r: RefResult = await verifyReference(text, env);
    M.heldout.real.byStatus[r.status] = (M.heldout.real.byStatus[r.status] ?? 0) + 1;
    const g = (M.heldout.real.byGroup[p.group] ??= { n: 0, verified: 0 });
    g.n++;
    if (r.status === "verified") { M.heldout.real.verified++; g.verified++; }
    else DETAIL.heldGenuineMiss!.push(`[${p.group} ${r.status}] ${text.slice(0, 120)} => ${r.reason.slice(0, 140)} checks=${JSON.stringify(r.checks)}`);
  }
  for (const f of heldFakes) {
    const r = await verifyReference(f.text, env);
    if (r.status === "verified") {
      M.heldout.fakes.verified.push(f);
      DETAIL.heldFakeVerified!.push(`${f.id} ${f.kind}: ${f.text}
      => ${r.reason}
      match=${JSON.stringify(r.match)} checks=${JSON.stringify(r.checks)}`);
    }
    if (f.expect.includes(r.status)) M.heldout.fakes.expected++;
    (M.heldout.fakes.byKind[f.kind] ??= {})[r.status] = (M.heldout.fakes.byKind[f.kind]![r.status] ?? 0) + 1;
  }
  log(`  verified ${heldPapers.length} held-out genuine and ${heldFakes.length} fabricated references`);
  M.verifier = { real: { verified: byStatus.verified ?? 0, byStatus, retractedFlags }, fakes: { verified: fakeVerified, expected, byKind } };
}, 3 * 60 * 60 * 1000);

afterAll(() => {
  layer.save();
  layer.uninstall();
  if (!M.knownItem) return;
  const pct = (a: number, b: number) => `${a}/${b} (${b ? ((a / b) * 100).toFixed(0) : 0}%)`;
  const rows: [string, string][] = [
    ["mode", `${MODE}${QUICK ? " QUICK subset" : ""} (${layer.calls} HTTP calls${layer.mode === "record" ? `, ${layer.size} fixtures saved` : ""})`],
    ["known-item search recall@10 / @20 / MRR", `${pct(M.knownItem.hits10, papers.length)} / ${pct(M.knownItem.hits20, papers.length)} / ${M.knownItem.mrr.toFixed(2)}`],
    ["topical landmarks in top 10", pct(M.topical.hits10, topical.length)],
    ["retracted papers returned by search (own DOI) / flagged", `${pct(M.retractedSearch.foundByDoi, retracted.length)} / ${pct(M.retractedSearch.flagged, M.retractedSearch.foundByDoi || 1)} (+${M.retractedSearch.foundOnlyAsOtherRecord} only as another record)`],
    ["retraction detection (Retraction Watch via Crossref)", pct(M.retraction.detected, M.retraction.total)],
    ["retraction false positives on ordinary papers", String(M.retraction.falsePositives.length)],
    ["DOIs removed by the pipeline (nonexistent or wrong record)", `${M.doiPipeline.removed} across ${M.doiPipeline.searches} searches (DOI-check failures: ${M.doiPipeline.checkFailures})`],
    ["DOIs RETURNED to the user, independently re-checked", `${M.integrity.checked} (unresolvable ${M.integrity.unresolvable.length}, title mismatch ${M.integrity.titleMismatch.length}, no Crossref record ${M.integrity.noCrossref}, unknown ${M.integrity.unknown})`],
    ["genuine references verified", pct(M.verifier.real.verified, papers.length)],
    ["genuine references by status", JSON.stringify(M.verifier.real.byStatus)],
    ["fabricated references VERIFIED (must be 0)", pct(M.verifier.fakes.verified.length, fakes.length)],
    ["fabricated references in an expected non-verified status", pct(M.verifier.fakes.expected, fakes.length)],
    ["HELD-OUT known-item recall@10 / @20", `${pct(M.heldout.knownItem.hits10, heldPapers.length)} / ${pct(M.heldout.knownItem.hits20, heldPapers.length)}  ${Object.entries(M.heldout.knownItem.byGroup).map(([g, v]) => `${g} ${v.hits10}/${v.n}`).join(", ")}`],
    ["HELD-OUT genuine references verified", `${pct(M.heldout.real.verified, heldPapers.length)}  ${Object.entries(M.heldout.real.byGroup).map(([g, v]) => `${g} ${v.verified}/${v.n}`).join(", ")}`],
    ["HELD-OUT genuine references by status", JSON.stringify(M.heldout.real.byStatus)],
    ["HELD-OUT fabricated references VERIFIED (must be 0)", pct(M.heldout.fakes.verified.length, heldFakes.length)],
    ["provider failures", pct(M.providers.failures, M.providers.runs)],
  ];
  log("\n=== EVAL REPORT ===");
  for (const [k, v] of rows) log(`${k.padEnd(62)} ${v}`);
  if (layer.missing.length) {
    log(`\n--- ${layer.missing.length} requests had no recording (replay) ---`);
    const byHost: Record<string, number> = {}; for (const k of layer.missing) { const h = new URL(k.slice(k.indexOf(" ") + 1)).host + " " + (k.includes("filter=doi") ? "doi-batch" : k.includes("filter=updates") ? "retraction" : k.includes("query.") ? "search" : "other"); byHost[h] = (byHost[h] ?? 0) + 1; } log("  by kind: " + JSON.stringify(byHost)); for (const k of [...new Set(layer.missing)].slice(0, 60)) log("  " + k); // in full: they can be fed to eval/patch-fixtures.mjs
  }
  for (const [section, lines] of Object.entries(DETAIL)) {
    if (!lines.length) continue;
    log(`\n--- ${section} (${lines.length}) ---`);
    for (const l of lines.slice(0, 20)) log("  " + l);
  }
  if (MODE === "record" || (MODE === "live" && !QUICK && process.env.EVAL_REPORT === "1")) {
    mkdirSync(HERE + "../../../docs/eval", { recursive: true });
    const md = [
      `# Eval report (${MODE}, ${new Date().toISOString().slice(0, 10)})`,
      "",
      "| Metric | Result |",
      "| --- | --- |",
      ...rows.map(([k, v]) => `| ${k} | ${v.replace(/\|/g, "/")} |`),
      "",
      "## Held-out fabricated references by kind and resulting status",
      "",
      "```json",
      JSON.stringify(M.heldout.fakes.byKind, null, 1),
      "```",
      "",
      "## Fabricated references by kind and resulting status",
      "",
      "```json",
      JSON.stringify(M.verifier.fakes.byKind, null, 1),
      "```",
      "",
      ...Object.entries(DETAIL).flatMap(([section, lines]) => (lines.length ? [`## ${section} (${lines.length})`, "", ...lines.map((l) => `- ${l.replace(/\n\s*/g, " ")}`), ""] : [])),
    ].join("\n");
    writeFileSync(HERE + "../../../docs/eval/REPORT.md", md);
  }
});

describe("citation accuracy gates", () => {
  it("replay fixtures cover every request the code makes", () => {
    if (MODE !== "replay") return;
    expect(layer.missing.slice(0, 5), "re-record with `npm run eval:record -w apps/api` if the code's requests changed on purpose").toEqual([]);
  });

  it("G1: every DOI the search returns resolves, and its title agrees with Crossref (0 fabricated citations)", () => {
    expect(M.integrity.unresolvable, "DOIs returned that do not resolve").toHaveLength(GATES.unresolvableDois);
    expect(M.integrity.titleMismatch, "DOIs returned whose title disagrees with Crossref").toHaveLength(GATES.titleMismatchDois);
    expect(M.integrity.checked).toBeGreaterThan(QUICK ? 100 : 500);
  });

  it("G2: retraction detection is complete and has no false positives", () => {
    expect(M.retraction.detected / M.retraction.total).toBeGreaterThanOrEqual(GATES.retractionRecall);
    expect(M.retraction.falsePositives).toHaveLength(GATES.retractionFalsePositives);
    expect(M.retractedSearch.flagged, "retracted papers returned by search must carry the flag").toBe(M.retractedSearch.foundByDoi);
  });

  it("G3: no fabricated reference is ever verified", () => {
    expect(M.verifier.fakes.verified.map((f) => `${f.id} ${f.kind}: ${f.text}`)).toHaveLength(GATES.fakesVerified);
  });

  it("G4: genuine references are verified at an acceptable rate", () => {
    expect(M.verifier.real.verified / papers.length).toBeGreaterThanOrEqual(GATES.realRefsVerified);
  });

  it("G5: a paper is found by its title (known-item recall@10)", () => {
    expect(M.knownItem.hits10 / papers.length).toBeGreaterThanOrEqual(GATES.knownItemRecallAt10);
  });

  it("G6: landmark papers appear for topical queries", () => {
    expect(M.topical.hits10 / topical.length).toBeGreaterThanOrEqual(GATES.topicalRecallAt10);
  });

  it("H1: no fabricated reference from the held-out set is verified", () => {
    expect(M.heldout.fakes.verified.map((f) => `${f.id} ${f.kind}: ${f.text}`)).toHaveLength(GATES.heldoutFakesVerified);
  });

  it("H2: held-out genuine references are verified at no less than the measured rate", () => {
    expect(M.heldout.real.verified / heldPapers.length).toBeGreaterThanOrEqual(GATES.heldoutRealRefsVerified);
  });

  it("H3: held-out papers are found by title at no less than the measured rate", () => {
    expect(M.heldout.knownItem.hits10 / heldPapers.length).toBeGreaterThanOrEqual(GATES.heldoutKnownItemRecallAt10);
  });

  it("providers are healthy during the run", () => {
    expect(M.providers.failures / M.providers.runs).toBeLessThanOrEqual(GATES.providerFailureRate);
  });
});

