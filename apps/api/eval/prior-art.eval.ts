// Prior-art recall: does Idea Check find the papers a paper itself builds on?
//   npm run eval                                  replay recorded responses (offline, seconds)
//   EVAL_MODE=record npx vitest run -c vitest.eval.config.ts eval/prior-art.eval.ts     re-record (about 10 minutes, uses OpenAlex credit)
// Each of 40 recent papers (20 with an Indian author) stands in for a researcher's idea: its abstract is the "meaning" search and its
// title the one keyword search. The paper itself is hidden from the results. Ground truth is the list of references that paper cites
// (resolved to DOIs by OpenAlex). Measured: how many of those references are among the closest 30 papers Idea Check returns.
// NOT measured here: the AI step that writes the plan (a person's idea is not as clean as an abstract) and the meaning re-rank, which needs
// the embedding model; both are checked by hand and in the live run (scripts/idea-live.mjs). So this is the retrieval's floor, not the whole product.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { memoryStore } from "../src/cache/store";
import { runIdeaSearch } from "../src/idea/search";
import { tokenize } from "../src/references/match";
import { FetchLayer, type Mode } from "./lib/fetch-layer";

/* Gates: set a little below the first recording (22 Oct 2026: hit rate 85%, three or more found 48%, mean recall 7.4%), so a real drop fails the build and ordinary data drift does not. */
const GATES = {
  /** Share of papers for which at least one of their references was found. */
  hitRate: 0.8,
  /** Average share of a paper's references found. */
  meanRecall: 0.06,
};

const MODE = (process.env.EVAL_MODE ?? "replay") as Mode;
const HERE = fileURLToPath(new URL(".", import.meta.url));
type Ref = { doi: string; title: string };
type Item = { group: "india" | "global"; doi: string; title: string; year: number; abstract: string; refs: Ref[] };
const items = JSON.parse(readFileSync(HERE + "data/prior_art.json", "utf8")) as Item[];

const FIXTURES = HERE + "fixtures-prior-art.json.gz";
/** Until the first recording exists (it needs a valid OpenAlex key: the meaning search refuses calls without one) this eval is skipped in replay. */
const SKIP = MODE === "replay" && !existsSync(FIXTURES);
const layer = new FetchLayer(SKIP ? "live" : MODE, FIXTURES);
const env = {
  store: memoryStore(),
  OPENALEX_API_KEY: process.env.OPENALEX_API_KEY ?? "eval",
  S2_API_KEY: process.env.S2_API_KEY ?? "eval",
  NCBI_API_KEY: "eval",
  CROSSREF_MAILTO: process.env.CROSSREF_MAILTO ?? "eval@example.org",
};

const words = (s: string) => new Set(tokenize(s));
const sameTitle = (a: string, b: string) => {
  const A = words(a), B = words(b);
  const i = [...A].filter((t) => B.has(t)).length;
  const u = new Set([...A, ...B]).size;
  return u > 0 && i / u >= 0.85;
};

type Row = { group: Item["group"]; title: string; refs: number; found: number; kept: number; failedSearches: number };
const rows: Row[] = [];

beforeAll(async () => {
  if (SKIP) return;
  layer.install();
  for (const it of items) {
    const out = await runIdeaSearch({ env, embed: null, req: { semanticQuery: it.abstract, keywordQueries: [it.title.slice(0, 100)] }, retryPauseMs: 0 });
    const papers = out.papers.filter((p) => p.doi !== it.doi && !sameTitle(p.title, it.title));
    const found = it.refs.filter((r) => papers.some((p) => p.doi === r.doi || sameTitle(p.title, r.title))).length;
    rows.push({ group: it.group, title: it.title, refs: it.refs.length, found, kept: papers.length, failedSearches: out.searched.filter((s) => !s.ok).length });
  }
}, 60 * 60 * 1000);

afterAll(() => {
  if (SKIP) return;
  layer.save();
  layer.uninstall();
});

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const stats = (rs: Row[]) => ({ n: rs.length, hit: mean(rs.map((r) => (r.found > 0 ? 1 : 0))), recall: mean(rs.map((r) => r.found / r.refs)), atLeast3: mean(rs.map((r) => (r.found >= 3 ? 1 : 0))) });

describe.skipIf(SKIP)("prior-art recall", () => {
  it("reports and gates", () => {
    const all = stats(rows);
    const lines = [
      "\n=== PRIOR-ART RECALL (does Idea Check find what a paper builds on?) ===",
      `papers                                    ${all.n}  (${rows.filter((r) => r.group === "india").length} with an Indian author)`,
      `at least one reference found              ${pct(all.hit)}`,
      `three or more references found            ${pct(all.atLeast3)}`,
      `mean share of a paper's references found  ${pct(all.recall)}   (india ${pct(stats(rows.filter((r) => r.group === "india")).recall)}, global ${pct(stats(rows.filter((r) => r.group === "global")).recall)})`,
      `searches that failed                      ${rows.reduce((n, r) => n + r.failedSearches, 0)} of ${rows.length * 3}`,
      "--- papers where nothing was found ---",
      ...rows.filter((r) => r.found === 0).map((r) => `  [${r.group}] ${r.title.slice(0, 90)} (${r.refs} refs)`),
    ];
    process.stdout.write(lines.join("\n") + "\n");
    if (MODE === "replay") expect(layer.missing.slice(0, 3), "re-record the prior-art fixtures if the search code changed on purpose").toEqual([]);
    expect(all.hit, "share of papers with at least one reference found").toBeGreaterThanOrEqual(GATES.hitRate);
    expect(all.recall, "mean share of references found").toBeGreaterThanOrEqual(GATES.meanRecall);
  });
});
