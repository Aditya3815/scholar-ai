// R9 (docs/design/intent-and-state.md, 4.9 and 8.5): the relevance tiers measured on the recorded lists of the repository. Offline: it replays the recorded provider answers of the citation eval (fixtures.json.gz) through the
// real search code, exactly as eval.eval.ts does, so `npm run eval` runs it on every push.
//
// WHAT IS MEASURED, AND ON WHAT
//   The 20 G6 landmark queries (data/topical.json: the query, and the DOI or title of the famous paper that must be in the list), the 100 G5 known items and the 60 held-out known items (the query is the paper's own title,
//   cut at its colon): for each list, whether the page may judge it at all (the trust rule: 1 to 6 content stems), and where the ONE paper known to be right stands (strong, medium or weak), how many papers of the list are in each
//   tier, and how often the list would say "no close match" while that paper is in it.
// WHAT CANNOT BE MEASURED HERE (and is not claimed): the plan's gates need human-labelled lists (the weak tier holds at most 5% of relevant papers, the strong tier at most 10% irrelevant, confident-wrong lists 0, "no close
//   match" shown while a relevant paper was in the list on at most 5%): there are no labels of papers in the repository, only the one paper each of these queries was built to find. So the numbers below are about THAT paper only, and
//   they are read on RECORDINGS THAT HOLD NO ABSTRACT (eval/lib/trim.mjs drops them from every provider answer): the rule here sees the title alone, where the product sees the title and the abstract. A relevant paper that is only
//   medium on its title may be strong on its abstract, so the share of strong landmarks below is a LOWER bound; and the strong tier cannot be shown to hold few irrelevant papers from a list nobody labelled. The sealed hold-out
//   and the human labels (E3) are what the gate is read on.
// THE RULE WAS NOT TUNED ON THESE LISTS: tiers.ts and its stub-title list were written from the plan, and nothing in them was changed after this file first ran. This is the first and only reading of them on these lists.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { memoryStore } from "../src/cache/store";
import { tokenize } from "../src/references/match";
import { runSearch } from "../src/search";
import { MAX_TIER_STEMS, isStubRecord, listState, tiererFor, type Tier } from "../src/understand/tiers";
import { wilson } from "./lib/metrics";
import { FetchLayer } from "./lib/fetch-layer";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const read = <T>(f: string) => JSON.parse(readFileSync(HERE + "data/" + f, "utf8")) as T;
type Known = { doi: string; title: string };
type Topical = { q: string; title?: string; expect: string[] };
const papers = read<Known[]>("papers.json");
const held = read<Known[]>("heldout_papers.json");
const topical = read<Topical[]>("topical.json");

const env = { OPENALEX_API_KEY: "eval", NCBI_API_KEY: "eval", S2_API_KEY: "eval", CROSSREF_MAILTO: "eval@example.org" };
const layer = new FetchLayer("replay", HERE + "fixtures.json.gz");

const wordSet = (s: string) => new Set(tokenize(s));
const samePaper = (a: string, b: string) => {
  const A = wordSet(a), B = wordSet(b);
  const i = [...A].filter((t) => B.has(t)).length;
  const u = new Set([...A, ...B]).size;
  return u ? i / u >= 0.8 : false;
};
const mainTitle = (t: string) => {
  const head = t.split(":")[0]!.trim();
  return head.split(/\s+/).length >= 3 ? head : t;
};

type Row = { set: string; q: string; judged: boolean; stems: number; rank: number; tier: Tier | null; counts: { strong: number; medium: number; weak: number; total: number } | null; state: string | null; stubs: number };
const rows: Row[] = [];

async function measure(set: string, q: string, isTarget: (doi: string | null, title: string) => boolean): Promise<Row> {
  const r = await runSearch({ ...env, store: memoryStore() }, q, 20);
  const tierer = tiererFor(q);
  const at = r.results.findIndex((p) => isTarget(p.doi, p.title));
  const row: Row = {
    set, q, judged: tierer !== null, stems: tierer?.stems ?? 0, rank: at + 1,
    tier: tierer && at >= 0 ? tierer.tier(r.results[at]!) : null,
    counts: tierer ? tierer.counts(r.results) : null,
    state: tierer ? listState(tierer.counts(r.results)) : null,
    stubs: r.results.filter((p) => isStubRecord(p.title)).length,
  };
  rows.push(row);
  return row;
}

beforeAll(async () => {
  layer.install();
  for (const t of topical) await measure("G6 landmark", t.q, (doi, title) => (doi !== null && t.expect.includes(doi)) || (!!t.title && samePaper(title, t.title)));
  for (const p of papers) await measure("G5 known item", mainTitle(p.title), (doi, title) => doi === p.doi || samePaper(title, p.title));
  for (const p of held) await measure("held-out known item", mainTitle(p.title), (doi, title) => doi === p.doi || samePaper(title, p.title));
});
afterAll(() => {
  layer.uninstall();
  const out: string[] = ["", "R9 relevance tiers on the recorded lists (titles only: the recordings hold no abstract)"];
  for (const set of ["G6 landmark", "G5 known item", "held-out known item"]) {
    const mine = rows.filter((r) => r.set === set);
    const judged = mine.filter((r) => r.judged);
    const found = judged.filter((r) => r.rank > 0);
    const tally = (t: Tier) => found.filter((r) => r.tier === t).length;
    const strongInList = found.length;
    const noClose = found.filter((r) => r.state === "none").length;
    const w = (k: number, n: number) => (n === 0 ? "n/a" : `${k}/${n} = ${(100 * k / n).toFixed(1)}% (Wilson 95%: ${(100 * wilson(k, n).low).toFixed(1)} to ${(100 * wilson(k, n).high).toFixed(1)})`);
    out.push(
      `  ${set}: ${mine.length} lists; judged (1 to ${MAX_TIER_STEMS} content stems) ${w(judged.length, mine.length)}; the known paper is in the list of ${w(found.length, judged.length)}`,
      `    where the known paper stands, of the judged lists that hold it: strong ${w(tally("strong"), strongInList)}; medium ${w(tally("medium"), strongInList)}; weak ${w(tally("weak"), strongInList)}`,
      `    "no close match" would be said while the known paper is in the list: ${w(noClose, strongInList)}`,
      `    lists with no strong paper at all (judged): ${w(judged.filter((r) => r.state === "none").length, judged.length)}; with one or two: ${w(judged.filter((r) => r.state === "few").length, judged.length)}; stub records in any list: ${mine.reduce((s, r) => s + r.stubs, 0)}`,
    );
  }
  // the 20 G6 queries one by one, so that each abstention and each landmark that is not strong can be read (and none is hidden in a rate)
  out.push("  the 20 G6 queries, one by one (content stems; judged or not; where the landmark stands):");
  for (const r of rows.filter((x) => x.set === "G6 landmark")) {
    out.push(`    ${r.judged ? `${r.stems} stems | landmark ${r.rank > 0 ? `at ${r.rank}, ${r.tier}` : "not in the list"} | strong ${r.counts!.strong}, medium ${r.counts!.medium}, weak ${r.counts!.weak}` : "not judged"} | ${r.q}`);
  }
  process.stdout.write(out.join("\n") + "\n");
});

describe("the tiers on the recorded lists (what can be read without labels)", () => {
  it("every list was recorded and read (nothing is missing from the replay)", () => {
    expect(layer.missing).toEqual([]);
    expect(rows).toHaveLength(topical.length + papers.length + held.length);
    expect(rows.filter((r) => r.set === "G6 landmark")).toHaveLength(20);
  });

  it("the counts of a list add up, and a list is judged only under the trust rule", () => {
    for (const r of rows) {
      if (!r.judged) {
        expect(r.counts, r.q).toBeNull();
        continue;
      }
      expect(r.stems, r.q).toBeGreaterThanOrEqual(1);
      expect(r.stems, r.q).toBeLessThanOrEqual(MAX_TIER_STEMS);
      expect(r.counts!.strong + r.counts!.medium + r.counts!.weak, r.q).toBe(r.counts!.total);
    }
  });

  it("the same recordings give the same tiers twice (it is pure)", async () => {
    const again: Row[] = [];
    for (const r of rows.slice(0, 20)) again.push(await measure(r.set, r.q, () => false));
    for (const [i, a] of again.entries()) {
      expect(a.counts, a.q).toEqual(rows[i]!.counts);
      expect(a.state, a.q).toBe(rows[i]!.state);
    }
    rows.length -= 20;
  });
});
