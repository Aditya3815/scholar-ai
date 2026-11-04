// R2, "one plainText at the adapter boundary": the gate of docs/design/intent-and-state.md (section 4.3, R2).
//   npm run eval            replay: the Crossref lists the eval recorded for its 200 searches are read through the real adapter and runProvider twice, with SEARCH_PLAINTEXT=off ("before": the text as the
//                           source sent it) and without the switch ("after"), and the text in them is counted.
// The gate, as the plan froze it: in 200 recorded Crossref records, 0 HTML entities and 0 control white space after cleaning; the before counts of the same records are printed next to it. The 200 are
// the first 200 records of every 20th recorded search (sorted by query), and the same counts are made over all 200 recorded searches (4,000 records), which is where the entities and tabs really are.
// G1 to G6 and the prior-art eval are the other files of this directory: they run the same recordings through the whole search and must say what they said before (the report below prints how the merge of the
// five sources changes, per search, so a title that now merges across sources is visible here). Abstracts are not in the recordings (the harness stores none), so they are tested by plain-text.test.ts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { memoryStore } from "../src/cache/store";
import { runProvider } from "../src/search";
import { crossref } from "../src/search/crossref";
import { doajAll } from "../src/search/india";
import { mergeAndRank } from "../src/search/merge";
import { openalex } from "../src/search/openalex";
import { pubmed } from "../src/search/pubmed";
import { s2 } from "../src/search/s2";
import type { Provider, ProviderPaper } from "../src/search/types";
import { FetchLayer, type Mode } from "./lib/fetch-layer";

const MODE = (process.env.EVAL_MODE ?? "replay") as Mode;
const HERE = fileURLToPath(new URL(".", import.meta.url));
const FIXTURES = HERE + "fixtures.json.gz";
const log = (s: string) => process.stdout.write(s + "\n");

const env = {
  OPENALEX_API_KEY: process.env.OPENALEX_API_KEY ?? "eval",
  NCBI_API_KEY: process.env.NCBI_API_KEY ?? "eval",
  S2_API_KEY: process.env.S2_API_KEY ?? "eval",
  CROSSREF_MAILTO: process.env.CROSSREF_MAILTO ?? "eval@example.org",
};
const OFF = "off";

/** Any HTML entity, named or numeric, whether or not plainText knows its name. */
const ENTITY = /&(?:#[0-9]+|#[xX][0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]*);/g;
/**
 * Looks like an entity and is not one: HTML defines no "NA". Wolters Kluwer sends it as the whole family name of a record with no author (10.1097/00007890-200607152-02042). plainText keeps a name outside its fixed set
 * as it came, so it is counted apart here; anything else that is left fails the gate.
 */
const NOT_ENTITIES = new Set(["&NA;"]);
const entitiesIn = (s: string) => [...s.matchAll(ENTITY)].map((m) => m[0]);
/** Control characters (tab, newline, carriage return, the C1 controls) and the two Unicode line separators. */
const CONTROL = /[\p{Cc}\p{Zl}\p{Zp}]/u;

/** The searches the eval made at Crossref, as the adapter writes them (rows=20, the type filter), by their query. */
const queries = (() => {
  const recorded = JSON.parse(gunzipSync(readFileSync(FIXTURES)).toString("utf8")) as Record<string, unknown>;
  const qs = Object.keys(recorded)
    .filter((k) => k.startsWith("GET https://api.crossref.org/works?") && k.includes("type%3Ajournal-article") && k.includes("rows=20"))
    .map((k) => new URL(k.slice("GET ".length)).searchParams.get("query.bibliographic"))
    .filter((q): q is string => !!q);
  return [...new Set(qs)].sort();
})();

type Field = "title" | "venue" | "author";
type Tally = { records: number; entity: Record<Field, number>; control: Record<Field, number>; anyEntity: number; anyControl: number; leftovers: Map<string, number>; notEntities: Map<string, number> };
const tally = (list: ProviderPaper[]): Tally => {
  const t: Tally = { records: list.length, entity: { title: 0, venue: 0, author: 0 }, control: { title: 0, venue: 0, author: 0 }, anyEntity: 0, anyControl: 0, leftovers: new Map(), notEntities: new Map() };
  for (const p of list) {
    const fields: Record<Field, string[]> = { title: [p.title], venue: p.venue ? [p.venue] : [], author: p.authors };
    let e = false, c = false;
    for (const f of Object.keys(fields) as Field[]) {
      const found = fields[f].flatMap(entitiesIn);
      for (const m of found) if (NOT_ENTITIES.has(m)) t.notEntities.set(m, (t.notEntities.get(m) ?? 0) + 1);
      const real = found.filter((m) => !NOT_ENTITIES.has(m));
      const hasE = real.length > 0;
      const hasC = fields[f].some((s) => CONTROL.test(s));
      if (hasE) {
        t.entity[f]++;
        e = true;
        for (const m of real) t.leftovers.set(m, (t.leftovers.get(m) ?? 0) + 1);
      }
      if (hasC) {
        t.control[f]++;
        c = true;
      }
    }
    if (e) t.anyEntity++;
    if (c) t.anyControl++;
  }
  return t;
};

const layer = new FetchLayer(MODE, FIXTURES);
const lists = { before: [] as ProviderPaper[][], after: [] as ProviderPaper[][] };
const sample = { before: [] as ProviderPaper[], after: [] as ProviderPaper[] };
type Merge = { q: string; before: string[]; after: string[]; sources: { before: number; after: number }; providers: number };
const merges: Merge[] = [];
const ALL: Provider[] = [openalex, s2, crossref, pubmed, doajAll];

beforeAll(async () => {
  if (MODE !== "replay") return;
  layer.install();
  const run = (p: Provider, q: string, off: boolean) => runProvider(p, q, { ...env, store: memoryStore(), ...(off ? { SEARCH_PLAINTEXT: OFF } : {}) }).then((r) => r.value);
  for (const q of queries) {
    lists.before.push(await run(crossref, q, true));
    lists.after.push(await run(crossref, q, false));
  }
  const picked = queries.map((_, i) => i).filter((i) => i % 20 === 0);
  sample.before = picked.flatMap((i) => lists.before[i]!).slice(0, 200);
  sample.after = picked.flatMap((i) => lists.after[i]!).slice(0, 200);

  // the whole merge of the five sources, as runSearch does it before its checks: which searches list other records, or in another order
  for (const q of queries) {
    const got: { before: Record<string, ProviderPaper[]>; after: Record<string, ProviderPaper[]> } = { before: {}, after: {} };
    for (const p of ALL) {
      try {
        got.before[p.name] = await run(p, q, true);
        got.after[p.name] = await run(p, q, false);
      } catch {
        delete got.before[p.name];
        delete got.after[p.name];
      }
    }
    const b = mergeAndRank(got.before, 20);
    const a = mergeAndRank(got.after, 20);
    merges.push({ q, before: b.map((r) => r.id), after: a.map((r) => r.id), sources: { before: b.filter((r) => r.sources.length > 1).length, after: a.filter((r) => r.sources.length > 1).length }, providers: Object.keys(got.after).length });
  }
  layer.uninstall();
}, 10 * 60_000);

afterAll(() => {
  if (MODE !== "replay" || queries.length === 0) return;
  const cols = [
    ["gate sample", tally(sample.before), tally(sample.after)],
    ["all recorded searches", tally(lists.before.flat()), tally(lists.after.flat())],
  ] as const;
  const row = (label: string, pick: (t: Tally) => number, n: (t: Tally) => number, pct = false) =>
    `${label.padEnd(44)}` + cols.map(([, b, a]) => `${(pct ? `${pick(b)} (${((100 * pick(b)) / n(b)).toFixed(1)}%)` : String(pick(b))).padStart(12)} ->${(pct ? `${pick(a)} (${((100 * pick(a)) / n(a)).toFixed(1)}%)` : String(pick(a))).padStart(10)}  `).join("");
  log("\n=== R2 PLAINTEXT: recorded Crossref records, before (SEARCH_PLAINTEXT=off) and after (the fix) ===");
  log(`${"".padEnd(44)}${cols.map(([name]) => name.padStart(24)).join("          ")}`);
  log(row("records", (t) => t.records, (t) => t.records));
  for (const f of ["venue", "title", "author"] as const) log(row(`${f} with an HTML entity`, (t) => t.entity[f], (t) => t.records, true));
  for (const f of ["title", "venue", "author"] as const) log(row(`${f} with control white space`, (t) => t.control[f], (t) => t.records, true));
  log(row("records with an entity anywhere", (t) => t.anyEntity, (t) => t.records, true));
  log(row("records with control white space anywhere", (t) => t.anyControl, (t) => t.records, true));
  const left = [...cols[1][2].leftovers.entries()];
  log(`entities left after cleaning, all searches: ${left.length ? left.map(([k, n]) => `${k} x${n}`).join(", ") : "none"}; looks like one and is not (NOT_ENTITIES, counted apart): ${[...cols[1][2].notEntities].map(([k, n]) => `${k} x${n}`).join(", ") || "none"}`);

  const changedSet = merges.filter((m) => [...m.before].sort().join("|") !== [...m.after].sort().join("|"));
  const changedOrder = merges.filter((m) => m.before.join("|") !== m.after.join("|"));
  const first = merges.filter((m) => m.before[0] !== m.after[0]);
  const top10 = merges.filter((m) => m.before.slice(0, 10).join("|") !== m.after.slice(0, 10).join("|"));
  const sum = (k: "before" | "after") => merges.reduce((s, m) => s + m[k].length, 0);
  const multi = (k: "before" | "after") => merges.reduce((s, m) => s + m.sources[k], 0);
  log(`\nthe five sources merged, ${merges.length} recorded searches (before the DOI and retraction checks)`);
  log(`  records listed in all searches: ${sum("before")} -> ${sum("after")} (fewer = a title now merges across sources or twins; more = a merge that depended on the raw text is gone)`);
  log(`  records found by two sources or more: ${multi("before")} -> ${multi("after")}`);
  log(`  searches with another set of records: ${changedSet.length}; with another order: ${changedOrder.length}; another top 10: ${top10.length}; another first place: ${first.length}`);
  for (const m of changedSet.slice(0, 12)) log(`  changed set  ${m.before.length} -> ${m.after.length} records  "${m.q.slice(0, 80)}"`);
  for (const m of first.slice(0, 12)) log(`  first place  ${m.before[0]} -> ${m.after[0]}  "${m.q.slice(0, 80)}"`);
});

describe.skipIf(MODE !== "replay")("R2 gate: provider text is plain text", () => {
  it("replayed the 200 recorded searches and the 200-record sample (an emptied replay would pass every gate below)", () => {
    expect(queries).toHaveLength(200);
    expect(sample.before).toHaveLength(200);
    expect(sample.after).toHaveLength(200);
    expect(lists.after.flat().length).toBeGreaterThan(3500);
    expect(merges).toHaveLength(200);
  });

  it("there was dirt to clean: the recordings do hold entities and control white space, so 0 after cleaning means something", () => {
    const all = tally(lists.before.flat());
    expect(all.entity.venue).toBeGreaterThan(50);
    expect(all.anyControl).toBeGreaterThan(10);
  });

  it("GATE: 0 HTML entities and 0 control white space in the 200 recorded records after cleaning", () => {
    const t = tally(sample.after);
    expect({ entity: t.anyEntity, control: t.anyControl }).toEqual({ entity: 0, control: 0 });
  });

  it("GATE, all 200 recorded searches: 0 HTML entities and 0 control white space after cleaning", () => {
    const t = tally(lists.after.flat());
    expect({ entity: t.anyEntity, control: t.anyControl, left: [...t.leftovers.keys()] }).toEqual({ entity: 0, control: 0, left: [] });
  });

  it("cleaning changes text and nothing else: the same records in the same order, with the same ids, years, counts and flags", () => {
    const other = (p: ProviderPaper) => ({ doi: p.doi, pmid: p.pmid, year: p.year, abstract: p.abstract, citationCount: p.citationCount, oaUrl: p.oaUrl, retracted: p.retracted, workType: p.workType, url: p.url });
    for (let i = 0; i < lists.before.length; i++) {
      const b = lists.before[i]!, a = lists.after[i]!;
      expect(a.map(other)).toEqual(b.map(other));
      a.forEach((p, k) => expect(p.authors.length).toBeLessThanOrEqual(b[k]!.authors.length)); // an author that is nothing but invisible characters is dropped
    }
  });
});
