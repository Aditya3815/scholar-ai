import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cleanAutoMessage, needsContext } from "@scholar/shared";
import { readHistory } from "./history";
import { chatRoutes } from "./routes";
// the labelled follow-ups, and their scoring: scripts that the real-model eval runs (scripts/router-eval.mjs --followup); pinned here without a model
// @ts-expect-error a script, not a typed module
import { CLASSES, HOLDOUT, HOLDOUT2, LANGS, TUNED } from "../../scripts/router-followup-cases.mjs";
// @ts-expect-error a script, not a typed module
import { evaluate, formatReport, scoreCase, searchedText, summarize, table, wilson } from "../../scripts/lib/followup-score.mjs";

type Want = { intent: string | string[]; yearFrom?: number | number[]; yearTo?: number | number[]; answerLanguage?: string; mustContain?: (string | string[])[]; mustNotContain?: string[] };
type Case = { id: string; lang: string; cls: string; history: unknown[]; message: string; want: Want };
const ALL: Case[] = [...TUNED, ...HOLDOUT, ...HOLDOUT2];
const list = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const LIMITS = { intent: 0.85, intentHinglish: 0.8, intentHindi: 0.8, falseSamePapers: 0.05, valid: 0.9, content: 0.8, ask: 0.8, yearWords: 0.9, bleed: 0.05, years: 0.85, falseYear: 0.1, language: 0.9, translated: 0.9, tokens: 2200 };
const isLatin = (w: string) => /^[ -~]+$/.test(w);

describe("the follow-up cases", () => {
  it("are labelled and in two lists: the tuned one and the hold-out one, with distinct ids", () => {
    expect(TUNED.length).toBeGreaterThanOrEqual(50);
    expect(HOLDOUT.length).toBeGreaterThanOrEqual(30);
    expect(new Set(ALL.map((c) => c.id)).size).toBe(ALL.length);
    for (const set of [TUNED, HOLDOUT] as Case[][]) {
      for (const cls of CLASSES) expect(set.some((c) => c.cls === cls), `class ${cls}`).toBe(true);
      for (const lang of LANGS) expect(set.filter((c) => c.lang === lang).length, `language ${lang}`).toBeGreaterThanOrEqual(8);
    }
  });

  it("every case is well formed: a message, its turns as the server would accept them, an intent, and words to look for", () => {
    for (const c of ALL) {
      expect(CLASSES, c.id).toContain(c.cls);
      expect(LANGS, c.id).toContain(c.lang);
      expect(cleanAutoMessage(c.message), c.id).not.toBeNull();
      const h = readHistory(c.history);
      expect(h.ok, `${c.id}: ${h.ok ? "" : h.detail}`).toBe(true);
      if (h.ok) {
        // the server keeps every entry of a case: nothing here is cut, so what is measured is what was written
        expect(h.history.entries.length, c.id).toBe(c.history.length);
        expect(h.history.dropped, c.id).toBe(0);
      }
      for (const i of list(c.want.intent)) expect(["new", "refine", "same_papers"], c.id).toContain(i);
      expect(c.history.length, c.id).toBeGreaterThan(0);
      if (c.cls === "topic_switch") expect(list(c.want.mustNotContain).length, c.id).toBeGreaterThan(0);
    }
  });

  it("a topic switch forbids words that the earlier turns really have (else the negative would measure nothing), and the new topic's own words are not among them", () => {
    for (const c of ALL.filter((x) => x.cls === "topic_switch")) {
      const turns = JSON.stringify(c.history).toLowerCase();
      const forbidden = list(c.want.mustNotContain).map((w) => w.toLowerCase());
      expect(forbidden.some((w) => turns.includes(w)), c.id).toBe(true);
      for (const alts of list(c.want.mustContain)) for (const w of list(alts)) expect(forbidden.some((f) => w.toLowerCase().includes(f) || f.includes(w.toLowerCase())), `${c.id}: ${w}`).toBe(false);
      expect(list(c.want.intent), c.id).toEqual(["new"]);
    }
  });

  it("a follow-up of the tuned list is one that cannot stand alone (the rules hand it to the model); in the hold-out list a few natural ones are not, and that share is part of the honest number", () => {
    const leans = (c: Case) => ["refine", "same_papers", "restyle", "year_filter"].includes(c.cls);
    for (const c of (TUNED as Case[]).filter(leans)) expect(needsContext(c.message), `${c.id}: ${c.message}`).toBe(true);
    const hold = (HOLDOUT as Case[]).filter(leans);
    const reached = hold.filter((c) => needsContext(c.message)).length / hold.length;
    expect(reached).toBeGreaterThanOrEqual(0.8);
  });

  it("the hold-out is other subjects and other words than the tuned list", () => {
    const topics = (set: Case[]) => new Set(set.flatMap((c) => c.history.filter((e) => (e as { role: string }).role === "user").map((e) => (e as { text: string }).text)));
    for (const t of topics([...HOLDOUT, ...HOLDOUT2] as Case[])) expect(topics(TUNED).has(t), t).toBe(false);
    expect(new Set((HOLDOUT as Case[]).map((c) => c.message)).size).toBe(HOLDOUT.length);
    const tuned = new Set((TUNED as Case[]).map((c) => c.message.toLowerCase()));
    for (const c of [...HOLDOUT, ...HOLDOUT2] as Case[]) expect(tuned.has(c.message.toLowerCase()), c.message).toBe(false);
  });

  it("has year cases with a range, with one year, and with none named, in every language", () => {
    // (the first hold-out lost its Hinglish case with a range when the rule was tuned on it and the case moved to the tuned list: the tuned list has all of them)
    for (const lang of LANGS) {
      const years = (TUNED as Case[]).filter((c) => c.cls === "year_filter" && c.lang === lang);
      expect(years.some((c) => c.want.yearFrom !== undefined || c.want.yearTo !== undefined), lang).toBe(true);
      expect(years.some((c) => c.want.yearFrom === undefined && c.want.yearTo === undefined), `${lang}: a message that names no year`).toBe(true);
    }
    for (const lang of LANGS) {
      const years = (HOLDOUT as Case[]).filter((c) => c.cls === "year_filter" && c.lang === lang);
      expect(years.some((c) => c.want.yearFrom === undefined && c.want.yearTo === undefined), `hold-out, ${lang}: a message that names no year`).toBe(true);
    }
  });
});

/** The answer that is exactly right for a case, as the development route would give it. */
function right(c: Case) {
  // English words where a case allows them: what the router is asked for is the words that go to the (English) indexes
  const words = list(c.want.mustContain).map((alts) => list(alts).find(isLatin) ?? list(alts)[0]).join(" ");
  const intent = list(c.want.intent)[0];
  const from = list(c.want.yearFrom)[0];
  const to = list(c.want.yearTo)[0];
  const asked = !(c.cls === "new_search" && !needsContext(c.message));
  return {
    mode: "search", how: asked ? "model" : "rules", confidence: 0.9, language: "en", ...(words ? { searchQuery: words } : {}),
    followUp: asked ? { intent, question: words || c.message, rewrote: true, fellBack: false, ...(from === undefined ? {} : { yearFrom: from }), ...(to === undefined ? {} : { yearTo: to }), ...(c.want.answerLanguage ? { answerLanguage: c.want.answerLanguage } : {}), check: "ok" } : null,
    usage: { calls: asked ? 1 : 0, tokensIn: 1200, tokensOut: 150 },
  };
}

describe("the scoring", () => {
  it("an answer that is exactly right scores right on every line, and every gate passes", () => {
    const rows = ALL.map((c) => scoreCase(c, right(c)));
    for (const r of rows) expect(r.error, r.id).toBeUndefined();
    expect(rows.every((r: { intentOk: boolean }) => r.intentOk)).toBe(true);
    expect(rows.filter((r: { bleed: boolean | null }) => r.bleed === true)).toEqual([]);
    expect(rows.filter((r: { years: boolean | null }) => r.years === false)).toEqual([]);
    expect(rows.filter((r: { content: boolean | null }) => r.content === false)).toEqual([]);
    const { lines } = evaluate(rows, LIMITS);
    expect(lines.length).toBeGreaterThanOrEqual(9);
    expect(lines.filter((l: { pass: boolean }) => !l.pass)).toEqual([]);
  });

  it("a made-up wrong answer is scored wrong: the wrong intent, the same papers when they were not meant, the old topic carried along, a year range from nowhere, a word missing, a language not read, a question thrown away", () => {
    const pick = (id: string) => ALL.find((c) => c.id === id)!;
    const refine = pick("en-refine-1");
    const topic = pick("en-topic-1");
    const year = pick("en-year-1");
    const restyle = pick("en-restyle-3");
    const base = (c: Case) => right(c);
    // the wrong intent, and the costly one: the same papers
    expect(scoreCase(refine, { ...base(refine), followUp: { ...base(refine).followUp, intent: "new" } }).intentOk).toBe(false);
    const same = scoreCase(refine, { ...base(refine), followUp: { ...base(refine).followUp, intent: "same_papers" } });
    expect(same.intentOk).toBe(false);
    expect(summarize([same]).falseSamePapers).toEqual({ value: 1, n: 1 });
    expect(summarize([scoreCase(restyle, base(restyle))]).falseSamePapers).toBeNull(); // a case that wants the same papers is not in that rate
    // the old topic comes along
    const bled = scoreCase(topic, { ...base(topic), searchQuery: "CRISPR off-target effects yoga blood pressure", followUp: { ...base(topic).followUp, question: "CRISPR off-target effects yoga" } });
    expect(bled.bleed).toBe(true);
    expect(scoreCase(topic, base(topic)).bleed).toBe(false);
    expect(scoreCase(topic, { ...base(topic), followUp: { ...base(topic).followUp, check: "bleed" }, searchQuery: undefined }).modelBleed).toBe(true);
    // the old topic carried by the same papers' own anchor counts too
    expect(scoreCase(topic, { ...base(topic), followUp: { ...base(topic).followUp, intent: "same_papers" }, searchQuery: "yoga blood pressure" }).bleed).toBe(true);
    // years: a range from nowhere, the wrong one, none
    const none = pick("en-year-5");
    expect(scoreCase(none, { ...base(none), followUp: { ...base(none).followUp, yearFrom: 2023 } }).falseYear).toBe(true);
    expect(scoreCase(none, base(none)).falseYear).toBe(false);
    expect(scoreCase(year, { ...base(year), followUp: { ...base(year).followUp, yearFrom: 2010 } }).years).toBe(false);
    expect(scoreCase(year, { ...base(year), followUp: { ...base(year).followUp, yearFrom: undefined } }).years).toBe(false);
    expect(scoreCase(year, base(year)).years).toBe(true);
    const between = pick("en-year-3");
    expect(scoreCase(between, { ...base(between), followUp: { ...base(between).followUp, yearTo: undefined } }).years).toBe(false);
    // a word the case needs is missing; the search is only the message when the model was not asked
    expect(scoreCase(refine, { ...base(refine), searchQuery: "blood pressure", followUp: { ...base(refine).followUp, question: "blood pressure" } }).content).toBe(false);
    expect(searchedText({ followUp: null }, "just the message")).toBe("just the message");
    // a language that was not read; a question that the server threw away
    expect(scoreCase(restyle, { ...base(restyle), followUp: { ...base(restyle).followUp, answerLanguage: undefined } }).language).toBe(false);
    expect(scoreCase(restyle, { ...base(restyle), followUp: { ...base(restyle).followUp, fellBack: true, check: "numbers" } }).valid).toBe(false);
    // an error is an error, counted apart
    const failed = scoreCase(refine, { error: "HTTP 500" });
    expect(failed.error).toBe("HTTP 500");
    expect(summarize([failed, scoreCase(refine, base(refine))]).errors).toBe(1);
    expect(summarize([failed, scoreCase(refine, base(refine))]).intent).toEqual({ value: 1, n: 1 });
  });

  it("a Hindi or Hinglish message that was searched as written (no English search words) is not counted as translated, though the raw message satisfies the words the case needs", () => {
    const pick = (id: string) => ALL.find((c) => c.id === id)!;
    const hi = pick("hi-new-1");
    const usage = { calls: 1, tokensIn: 1200, tokensOut: 150 };
    // the model was not asked, or its English words were dropped (bleed): the Hindi message itself is what is searched
    const asWritten = scoreCase(hi, { mode: "search", how: "model", confidence: 0.9, language: "hi", followUp: { intent: "new", question: hi.message, rewrote: false, fellBack: false, check: "bleed" }, usage });
    const notAsked = scoreCase(hi, { mode: "search", how: "rules", confidence: 1, language: "hi", followUp: null, usage: { calls: 0 } });
    for (const row of [asWritten, notAsked]) {
      expect(row.content, "the raw Devanagari satisfies the content check (that line is blind to it)").toBe(true);
      expect(row.translated, "...so a line of its own has to see it").toBe(false);
    }
    expect(summarize([asWritten, notAsked]).translated).toEqual({ value: 0, n: 2 });
    // English search words are translated; words that are mostly Devanagari are not; mixed words count by their letters
    expect(scoreCase(hi, right(hi)).translated).toBe(true);
    expect(scoreCase(hi, { ...right(hi), searchQuery: "मधुमेह exercise" }).translated).toBe(false);
    expect(scoreCase(hi, { ...right(hi), searchQuery: "exercise diabetes मधुमेह" }).translated).toBe(false);
    expect(scoreCase(hi, { ...right(hi), searchQuery: "exercise effect on type 2 diabetes in India", followUp: { ...right(hi).followUp, searchQuery: undefined } }).translated).toBe(true);
    // the words may be on the follow-up only
    expect(scoreCase(hi, { ...right(hi), searchQuery: undefined, followUp: { ...right(hi).followUp, searchQuery: "exercise diabetes" } }).translated).toBe(true);
    // not in the number: an English message, and a message that only asks about the papers on the screen (nothing is searched for it)
    expect(scoreCase(pick("en-refine-1"), right(pick("en-refine-1"))).translated).toBeNull();
    expect(scoreCase(pick("hi-same-1"), right(pick("hi-same-1"))).translated).toBeNull();
    expect(scoreCase(pick("hi-restyle-1"), right(pick("hi-restyle-1"))).translated).toBeNull();
    // every Hindi and Hinglish case that searches is in it, and the right answers all pass
    const rows = ALL.map((c) => scoreCase(c, right(c)));
    const searching = ALL.filter((c) => c.lang !== "en" && !(list(c.want.intent).length === 1 && list(c.want.intent)[0] === "same_papers"));
    expect(summarize(rows).translated).toEqual({ value: 1, n: searching.length });
    expect(searching.length).toBeGreaterThan(25);
    // a set whose searches are all written as they came fails its own gate, by name
    const raw = ALL.map((c) => scoreCase(c, { ...right(c), searchQuery: undefined, followUp: right(c).followUp && { ...right(c).followUp, searchQuery: undefined, question: c.message } }));
    expect(evaluate(raw, LIMITS).lines.filter((l: { pass: boolean }) => !l.pass).map((l: { name: string }) => l.name)).toContain("searched in English (Hindi, Hinglish)");
  });

  it("the interval that is printed beside a share: a Wilson interval at 95%, wide when there are few cases", () => {
    expect(wilson(0, 0)).toBeNull();
    const none = wilson(0, 12);
    expect(none.low).toBeCloseTo(0, 10);
    expect(none.high).toBeCloseTo(0.2425, 3); // 3.84 / (12 + 3.84): 12 clean answers cannot show that a rate is under 5%
    const half = wilson(5, 10);
    expect(half.low).toBeCloseTo(0.2366, 3);
    expect(half.high).toBeCloseTo(0.7634, 3);
    const all = wilson(97, 97);
    expect(all.high).toBeCloseTo(1, 10);
    expect(all.low).toBeCloseTo(0.9619, 3);
    expect(wilson(50, 100).high - wilson(50, 100).low).toBeLessThan(half.high - half.low);
  });

  it("a set that is all wrong fails the gates it is about", () => {
    const wrong = ALL.map((c) => {
      const r = right(c);
      return scoreCase(c, {
        ...r,
        searchQuery: `${c.want.mustNotContain?.[0] ?? "zzz"} nothing`,
        followUp: r.followUp && { ...r.followUp, intent: list(c.want.intent).includes("same_papers") ? "new" : "same_papers", question: "zzz", yearFrom: 1999, yearTo: undefined, answerLanguage: undefined, fellBack: true, check: "numbers" },
        usage: { calls: 1, tokensIn: 5000, tokensOut: 800 },
      });
    });
    const failed = evaluate(wrong, LIMITS).lines.filter((l: { pass: boolean }) => !l.pass).map((l: { name: string }) => l.name);
    for (const name of ["intent", "false same papers", "standalone question valid", "topic bleed", "year range right", "language asked for read", "tokens per asked message"]) expect(failed, name).toContain(name);
  });

  it("the tables name every class and every language that has a case, with the numbers in columns", () => {
    const rows = ALL.map((c) => scoreCase(c, right(c)));
    const byClass = table(rows, CLASSES, "class");
    expect(byClass[0]).toMatch(/^class\s+n\s+intent\s+words\s+years\s+lang\s+bleed\s+valid\s+tokens$/);
    expect(byClass).toHaveLength(1 + CLASSES.length);
    expect(table(rows, LANGS, "language")).toHaveLength(1 + LANGS.length);
    expect(byClass.find((l: string) => l.startsWith("topic_switch"))).toMatch(/\s0%\s/); // the bleed rate of the right answers
  });
});

describe("the printout of a run", () => {
  const report = (rows: unknown[], show = true) => formatReport({ rows, cases: ALL, limits: LIMITS, classes: CLASSES, langs: LANGS, set: "all", seconds: 12.4, show });

  it("for right answers: every gate is ok, the tables are there, nothing is listed as wrong, and nothing fails a --gate", () => {
    const r = report(ALL.map((c) => scoreCase(c, right(c))));
    expect(r.failed).toEqual([]);
    expect(r.text).toContain(`router follow-up eval (all): ${ALL.length} messages in 12 s`);
    expect(r.text).toMatch(/ok +intent +\d+\.\d%/);
    expect(r.text).not.toMatch(/FAIL|wrong \(/);
    expect(r.text).toMatch(/class\s+n\s+intent/);
    expect(r.text).toMatch(/language\s+n\s+intent/);
    expect(r.text).toMatch(/tokens per asked message\s+1350 \(limit 2200\)/);
    // every share says how many messages it is made of, and how far a number from so few can be trusted
    expect(r.text).toMatch(new RegExp(`ok +intent +[0-9.]+%  [(]limit 85[.]0%[)], ${ALL.length} of ${ALL.length} messages, 95% interval 9[0-9]% to 100%`));
    expect(r.text).toMatch(/ok +topic bleed +0[.]0%  [(]limit at most 5[.]0%[)], 0 of [0-9]+ messages, 95% interval 0% to [0-9]+%/);
    expect(r.text).toMatch(/ok +searched in English [(]Hindi, Hinglish[)] +100[.]0%/);
  });

  it("for wrong answers: the gates that are past their limit are named, and every wrong case is listed with what it got", () => {
    const wrong = ALL.map((c) => scoreCase(c, { ...right(c), searchQuery: "zzz", followUp: { intent: "same_papers", question: "zzz", rewrote: true, fellBack: true, check: "numbers" }, usage: { calls: 1, tokensIn: 5000, tokensOut: 800 } }));
    const r = report([...wrong, scoreCase(ALL[0], { error: "HTTP 500" })]);
    expect(r.failed).toEqual(expect.arrayContaining(["intent", "false same papers", "standalone question valid", "tokens per asked message"]));
    expect(r.text).toMatch(/FAIL intent/);
    expect(r.text).toMatch(/wrong \(\d+\):/);
    expect(r.text).toContain('[en/refine] en-refine-1: intent same_papers, ');
    expect(r.text).toContain('question thrown away (numbers): "and in children?"');
    expect(r.text).toMatch(/ERROR HTTP 500/);
    expect(report(wrong, false).text).not.toMatch(/wrong \(/);
  });
});

describe("every case goes through the real route, with the stand-in for the model (a dry run of the eval's calls, no model)", () => {
  const sessionRow = { id: "user-1", name: "Test", email: "t@example.org", orcid: null, avatar_url: null, role: "scholar", privacy_ack: null, stale: 0, providers: "google" };
  const db = { prepare: () => ({ bind: () => ({ first: async () => sessionRow, run: async () => ({}), all: async () => ({ results: [] }) }) }) };
  const ask = async (c: Case) => {
    const body = { message: c.message, history: c.history };
    const res = await chatRoutes.request("http://localhost/route", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", cookie: `sid=${"t".repeat(40)}` }, body: JSON.stringify(body) }, { DB: db, ENABLE_DEV_ROUTES: "1", QA_STUB: "1", CROSSREF_MAILTO: "t@example.org" });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };

  it("is accepted (200, with `followUp` and `usage`) for all of them, and is scored without error", async () => {
    const rows = [];
    for (const c of ALL) {
      const r = await ask(c);
      expect(r.status, `${c.id}: ${JSON.stringify(r.json)}`).toBe(200);
      expect(r.json, c.id).toHaveProperty("followUp");
      expect(r.json, c.id).toHaveProperty("usage");
      rows.push(scoreCase(c, r.json));
    }
    expect(rows.filter((r: { error?: string }) => r.error)).toEqual([]);
    // (the stand-in is crude: this says the numbers come out, not that they are good)
    const s = summarize(rows);
    expect(s.n).toBe(ALL.length);
    expect(s.intent?.n).toBe(ALL.length);
  });
});

describe("the scoring sees what the writer is asked, and the years in the search words", () => {
  const pick = (id: string) => ALL.find((c) => c.id === id)!;
  it("a refinement the model left as it was ('and in children?') is a writer asked words that mean nothing alone, unless the search words go with it", () => {
    const c = pick("en-refine-1");
    const base = right(c);
    const bare = scoreCase(c, { ...base, followUp: { ...base.followUp, question: "and in children?", rewrote: false } });
    expect(bare.content).toBe(true); // the search words have the topic: the old line could not see the writer's question at all
    expect(bare.ask).toBe(false);
    const withAsk = scoreCase(c, { ...base, followUp: { ...base.followUp, question: "and in children?", rewrote: false, ask: "yoga blood pressure children — and in children?" } });
    expect(withAsk.ask).toBe(true);
    expect(scoreCase(c, base).ask).toBe(true);
    expect(summarize([bare, withAsk]).ask).toEqual({ value: 0.5, n: 2 });
  });
  it("year words in the English search words are scored wrong when the range was applied, and not looked at when it was not", () => {
    const y = pick("en-year-1");
    const by = right(y);
    expect(scoreCase(y, by).yearWords).toBe(true);
    expect(scoreCase(y, { ...by, searchQuery: "yoga papers after 2020" }).yearWords).toBe(false);
    expect(scoreCase(y, { ...by, searchQuery: "yoga 2020" }).yearWords).toBe(false);
    expect(scoreCase(y, { ...by, searchQuery: "yoga papers after 2020", followUp: { ...by.followUp, yearFrom: undefined } }).yearWords).toBeNull();
    expect(scoreCase(pick("en-refine-1"), right(pick("en-refine-1"))).yearWords).toBeNull();
  });
  it("both are gates", () => {
    const rows = ALL.map((c) => scoreCase(c, right(c)));
    const names = evaluate(rows, LIMITS).lines.map((l: { name: string }) => l.name);
    expect(names).toContain("what the writer is asked has the words");
    expect(names).toContain("year words kept out of the search words");
  });
});

describe("the evaluation script stops when nobody is signed in (the engineer's run printed a plausible failing score, 70.6%, from an eval in which every answer was a visitor's)", () => {
  const script = readFileSync(fileURLToPath(new URL("../../scripts/router-eval.mjs", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
  it("both client factories sign in through one function that checks the privacy acknowledgement and exits, and no bare acknowledgement is left", () => {
    expect(script).toMatch(/async function signedIn\(/);
    expect(script.match(/await signedIn\(/g)?.length).toBe(2);
    expect(script).not.toMatch(/^\s*await A\.ack\(\);/m);
    expect(script).toMatch(/process\.exit\(2\)/);
  });
  it("its header says how to start the worker so that the fake sign-in comes back to it (the custom domain of wrangler.jsonc sends it to the live site)", () => {
    expect(script).toMatch(/--local-upstream localhost:8788/);
    expect(script).toMatch(/routes/);
  });
});
