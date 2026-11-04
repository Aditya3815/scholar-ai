import { describe, expect, it } from "vitest";
import ERROR_XML from "./fixtures/arxiv-error.xml?raw";
import { TRENDING_POOL_MAX_DAYS, isFresh, parseTrending, type TrendingPayload } from "@scholar/shared";
import { phraseKey, type Candidate } from "@scholar/shared/src/trending";
import type { SearchResponse } from "@scholar/shared";
import { fakeKv, type FakeKvOptions } from "./fake-kv";
import { BudgetError, SourceError } from "./sources";
import { STUB_CAPPED_PHRASES, STUB_HELD_PHRASE, STUB_PHRASES, STUB_RETRACTED_PHRASE, STUB_SUBFIELDS, makeStubTrending } from "./stub";
import { TRENDING_KEYS } from "./store";
import { TRENDING_LIMITS, runTrending, type TrendingLimits } from "./job";

/**
 * The job, end to end on stand-ins (stub.ts: eleven made-up topics in eleven subfields) and an in-memory KV, with a clock the stand-ins move by what a call would take (1.5 s for OpenAlex,
 * 0.5 s for arXiv, 4 s for a search), so the time budget of a run is tested too. 2 Nov 2026 is a Monday.
 */
const MONDAY = "2026-11-02T03:17:00Z";
const TUESDAY = "2026-11-03T03:17:00Z";
const NEXT_MONDAY = "2026-11-09T03:17:00Z";
const day = (iso: string) => iso.slice(0, 10);
/** The subfields the stand-ins know, and the batches a scan of them makes at 4 and at 2 to a batch. */
const N = STUB_SUBFIELDS.length;
const B4 = Math.ceil(N / 4);
const B2 = Math.ceil(N / 2);

type Answer = Response | null | undefined;
function world(over: { limits?: Partial<TrendingLimits>; subfields?: readonly number[]; search?: (q: string, scope: "all" | "india") => Promise<SearchResponse>; variable?: string; fail?: FakeKvOptions["fail"] } = {}) {
  let t = Date.parse(MONDAY);
  const kv = fakeKv({ now: () => t, ...(over.fail ? { fail: over.fail } : {}) });
  const arxivAt: number[] = [];
  const hooks: { fail: ((source: "openalex" | "arxiv", url: URL) => Answer) | null; scanDay: string } = { fail: null, scanDay: day(MONDAY) };
  const stub = makeStubTrending({
    asOf: () => hooks.scanDay,
    onCall: (source, url) => {
      if (source === "arxiv") arxivAt.push(t);
      t += source === "openalex" ? 1500 : source === "arxiv" ? 500 : 4000;
      void url;
    },
    intercept: (source, url) => hooks.fail?.(source, url),
  });
  const run = (iso: string, limits: Partial<TrendingLimits> = {}) => {
    t = Date.parse(iso);
    return runTrending(
      {
        kv: kv.kv,
        mailto: "ops@example.org",
        apiKey: "KEY",
        fetch: stub.fetch,
        search: over.search ?? stub.search,
        sleep: async (ms) => void (t += ms),
        clock: () => t,
        subfields: over.subfields ?? STUB_SUBFIELDS,
        variable: over.variable,
        limits: { batchSubfields: 4, ...over.limits, ...limits },
      },
      Date.parse(iso),
    );
  };
  const clear = () => {
    stub.calls.openalex.length = 0;
    stub.calls.arxiv.length = 0;
    stub.calls.searches.length = 0;
    arxivAt.length = 0;
  };
  const file = (): TrendingPayload | null => {
    const text = kv.read(TRENDING_KEYS.file);
    return text === null ? null : parseTrending(JSON.parse(text));
  };
  const pool = () => {
    const text = kv.read(TRENDING_KEYS.pool);
    return text === null ? null : (JSON.parse(text) as { poolAsOf: string; global: Candidate[]; india: Candidate[]; held: string[] });
  };
  const scan = () => {
    const text = kv.read(TRENDING_KEYS.scan);
    return text === null ? null : (JSON.parse(text) as { asOf: string; next: number; batches: number; calls: number; leaseUntil: number });
  };
  return { kv, stub, run, clear, file, pool, scan, arxivAt, hooks, now: () => t };
}
type World = ReturnType<typeof world>;

const cand = (text: string, fieldId: number, domainId: number, score: number, over: Partial<Candidate> = {}): Candidate => ({
  id: text.replace(/ /g, "-"), text, phrase: phraseKey(text), subfield: fieldId * 100 + 2, subfieldName: `Subfield of field ${fieldId}`, field: `Field number ${fieldId}`, fieldId,
  domain: `Domain ${domainId}`, domainId, policy: "allow", a: 300, b: 100, bEstimated: false, ratio: 1.1, score, total: 300, ...over,
});
/** 12 candidates that fill a list: four fields in each of the three domains, none of them in a field that arXiv covers. */
const TWELVE = (): Candidate[] => {
  const fields: [number, number][] = [[19, 3], [21, 3], [22, 3], [23, 3], [11, 1], [13, 1], [28, 1], [24, 1], [12, 2], [14, 2], [20, 2], [33, 2]];
  return fields.map(([f, d], i) => cand(`topic number ${String.fromCharCode(97 + i)}`, f, d, 2 - i * 0.01));
};
const seedPool = (w: World, global: Candidate[], india: Candidate[] = [], poolAsOf = "2026-11-02") =>
  w.kv.seed(TRENDING_KEYS.pool, JSON.stringify({ version: 1, poolAsOf, builtAt: `${poolAsOf}T03:30:00.000Z`, global, india, held: [] }));
const chipsOf = (p: TrendingPayload | null, g: "global" | "in" = "global") => (p ? p.groups[g].chips.map((c) => c.text) : []);

describe("the first run: a scan, a pool and a first file", () => {
  it("builds the pool from the open counts and publishes the file the page reads: nine phrases, each the keyword's own text, with its two counts", async () => {
    const w = world();
    const r = await w.run(MONDAY);
    const f = w.file()!;
    expect(f).not.toBeNull();
    expect(chipsOf(f).sort()).toEqual([...STUB_PHRASES].sort());
    expect(f).toMatchObject({ asOf: "2026-11-02", poolAsOf: "2026-11-02", disabled: false, generatedAt: new Date(f.generatedAt).toISOString() });
    expect(Date.parse(f.validUntil) - Date.parse(f.generatedAt)).toBe(48 * 3_600_000);
    expect(f.groups.global.chips.find((c) => c.text === "retrieval-augmented generation")).toEqual({ text: "retrieval-augmented generation", sinceYear: 2025, a: 452, b: 176, field: "Computer Science" });
    expect(f.groups.global.chips.find((c) => c.text === "altermagnetism")).toMatchObject({ a: 150, b: 22 }); // not in last year's 200: the exact count was asked for
    expect(isFresh(f, Date.parse(MONDAY) + 3_600_000)).toBe(true);
    expect(r.daily).toMatchObject({ published: true });
    expect(r.scan).toMatchObject({ completed: true, batches: B4 });
  });

  it("leaves out a phrase whose search finds a retracted paper (it is asked, and refused) and one in a held subfield (logged, never shown), and never searches the phrases the caps shut out", async () => {
    const w = world();
    const r = await w.run(MONDAY);
    expect(w.stub.calls.searches).toContainEqual({ q: STUB_RETRACTED_PHRASE, scope: "all" });
    expect(chipsOf(w.file())).not.toContain(STUB_RETRACTED_PHRASE);
    for (const capped of STUB_CAPPED_PHRASES) {
      expect(w.pool()!.global.map((c) => c.text)).toContain(capped); // in the pool ...
      expect(chipsOf(w.file())).not.toContain(capped); // ... not shown: four from the Physical Sciences are shown at most
      expect(w.stub.calls.searches.map((x) => x.q)).not.toContain(capped); // ... and not even searched
    }
    expect(chipsOf(w.file())).not.toContain(STUB_HELD_PHRASE);
    expect(chipsOf(w.file(), "in")).not.toContain(STUB_HELD_PHRASE);
    expect(r.scan!.held).toContain(STUB_HELD_PHRASE);
    expect(w.pool()!.global.map((c) => c.text)).not.toContain(STUB_HELD_PHRASE);
    expect(w.pool()!.held).toContain(STUB_HELD_PHRASE);
  });

  it("makes an India list too, from the Indian institutions' counts, searched in the Indian scope", async () => {
    const w = world();
    await w.run(MONDAY);
    const india = chipsOf(w.file(), "in");
    expect(india.length).toBeGreaterThan(0);
    for (const text of india) {
      expect(STUB_PHRASES).toContain(text);
      expect(w.stub.calls.searches).toContainEqual({ q: text, scope: "india" });
    }
    for (const text of chipsOf(w.file())) expect(w.stub.calls.searches).toContainEqual({ q: text, scope: "all" });
  });

  it("asks only OpenAlex, arXiv and its own search; every OpenAlex call carries the polite mailto and the key; arXiv calls are at least 3 seconds apart", async () => {
    const w = world();
    await w.run(MONDAY);
    expect(w.stub.calls.other).toEqual([]);
    expect(w.stub.calls.openalex.length).toBeGreaterThan(40);
    for (const u of w.stub.calls.openalex) {
      expect(u.searchParams.get("mailto")).toBe("ops@example.org");
      expect(u.searchParams.get("api_key")).toBe("KEY");
    }
    expect(w.arxivAt.length).toBe(6); // two phrases from computing and physics, three windows each
    expect(Math.min(...w.arxivAt.slice(1).map((x, i) => x - w.arxivAt[i]!))).toBeGreaterThanOrEqual(3000);
    expect(w.stub.calls.arxiv.every((u) => u.hostname === "export.arxiv.org")).toBe(true);
  });

  it("counts what it uses: every KV operation, and its calls against its budget", async () => {
    const w = world();
    const r = await w.run(MONDAY);
    expect(r.kvOps).toBe(w.kv.ops);
    expect(r.kvOps).toBeLessThan(60);
    expect(r.calls).toBeGreaterThanOrEqual(w.stub.calls.openalex.length + w.stub.calls.arxiv.length);
    expect(r.calls).toBeLessThan(TRENDING_LIMITS.runCalls);
    expect(r.ms).toBeGreaterThan(0);
    // the file is written once, with the 14-day life, and the switch is never touched
    const writes = w.kv.log.puts.filter((p) => p.key === TRENDING_KEYS.file);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.ttl).toBe(14 * 86_400);
    expect(w.kv.log.puts.some((p) => p.key === TRENDING_KEYS.off)).toBe(false);
    expect(w.kv.log.puts.every((p) => p.key.startsWith("trending:v1"))).toBe(true);
  });

  it("the owner's deny list keeps a phrase out of the pool and the file, however it is written (case, hyphens, spaces)", async () => {
    const w = world();
    w.kv.seed(TRENDING_KEYS.deny, JSON.stringify(["  AI-Literacy ", "Single Atom Catalysts"]));
    await w.run(MONDAY);
    expect(chipsOf(w.file())).not.toContain("AI literacy");
    expect(chipsOf(w.file())).toHaveLength(8);
    expect(w.pool()!.global.map((c) => c.text)).not.toContain("single-atom catalysts");
    expect(w.pool()!.global.map((c) => c.text)).toContain("solid-state batteries");
  });

  it("the deny list also holds the DAY'S file, not only the weekly pool: a phrase put in it after the pool was made is gone from the next run's file (and is counted in the run's result)", async () => {
    const w = world();
    await w.run(MONDAY);
    expect(chipsOf(w.file())).toContain("AI literacy");
    w.kv.seed(TRENDING_KEYS.deny, JSON.stringify([" ai literacy "]));
    w.clear();
    const r = await w.run(TUESDAY);
    expect(chipsOf(w.file())).not.toContain("AI literacy");
    expect(chipsOf(w.file(), "in")).not.toContain("AI literacy");
    expect(chipsOf(w.file())).toHaveLength(8);
    expect(w.stub.calls.searches.map((x) => x.q)).not.toContain("AI literacy"); // not even searched
    expect(r.daily).toMatchObject({ published: true, denied: 1 + (w.pool()!.india.some((c) => c.text === "AI literacy") ? 1 : 0) });
    expect(w.pool()!.global.map((c) => c.text)).toContain("AI literacy"); // the pool is the scan's, and is not rewritten by the day
  });

  it("matches a whole phrase, not a part of one: denying 'ai literacy' does not deny 'ai literacy in schools' (the runbook says to add each)", async () => {
    const w = world();
    seedPool(w, [...TWELVE().slice(0, 8), cand("ai literacy", 33, 2, 1.7), cand("ai literacy in schools", 14, 2, 1.69)]);
    w.kv.seed(TRENDING_KEYS.deny, JSON.stringify(["AI literacy"]));
    await w.run(TUESDAY);
    expect(chipsOf(w.file())).not.toContain("ai literacy");
    expect(chipsOf(w.file())).toContain("ai literacy in schools");
  });

  describe("a deny list that is there and cannot be used stops the run instead of denying nothing (the owner believes it is working)", () => {
    const bad: [string, string][] = [
      ["not JSON (what PowerShell makes of '[\"a phrase\"]')", "[a phrase]"],
      ["a JSON object", '{"phrase": true}'],
      ["a string", '"ai literacy"'],
      ["a list with something that is not a phrase", '["ai literacy", 7]'],
      ["null", "null"],
      ["more than 1,000 phrases", JSON.stringify(Array.from({ length: 1001 }, (_, i) => `phrase ${i}`))],
    ];
    for (const [what, value] of bad) {
      it(`${what}: the day's file is not made, the last file stays, and the error says what to do`, async () => {
        const w = world();
        await w.run(MONDAY);
        const old = w.kv.read(TRENDING_KEYS.file);
        w.kv.seed(TRENDING_KEYS.deny, value);
        w.clear();
        const err = await w.run(TUESDAY).catch((e) => e);
        expect(err).toBeInstanceOf(Error);
        expect(String(err.message)).toMatch(/deny list/);
        expect(String(err.message)).toMatch(/trending:v1:deny/);
        expect(w.kv.read(TRENDING_KEYS.file)).toBe(old);
        expect(w.stub.calls.searches).toHaveLength(0); // before any search is paid for
      });
    }

    it("a KV that cannot read the key is the same: the run fails and the file stays", async () => {
      let broken = false;
      const w = world({ fail: (op, key) => { if (broken && op === "get" && key === TRENDING_KEYS.deny) throw new Error("KV: 500"); } });
      await w.run(MONDAY);
      const old = w.kv.read(TRENDING_KEYS.file);
      broken = true;
      w.clear();
      await expect(w.run(TUESDAY)).rejects.toThrow(/KV: 500|deny list/);
      expect(w.kv.read(TRENDING_KEYS.file)).toBe(old);
      expect(w.stub.calls.searches).toHaveLength(0);
    });

    it("the weekly pool is not made from an unreadable list either: the scan's batches are kept, and the next run, with the list put right, finishes the pool without asking OpenAlex again", async () => {
      const w = world();
      w.kv.seed(TRENDING_KEYS.deny, "[a phrase]");
      await expect(w.run(MONDAY)).rejects.toThrow(/deny list/);
      expect(w.pool()).toBeNull();
      expect(w.scan()).toMatchObject({ asOf: "2026-11-02", next: B4, batches: B4, leaseUntil: 0 });
      expect(w.scan()!.next).toBe(w.scan()!.batches);
      w.kv.seed(TRENDING_KEYS.deny, "[]");
      w.hooks.scanDay = "2026-11-02";
      const scanCallsBefore = w.stub.calls.openalex.filter((u) => !String(u.searchParams.get("filter")).includes(",keywords.id:")).length;
      const r = await w.run(TUESDAY);
      expect(r.scan).toMatchObject({ completed: true });
      expect(w.pool()!.poolAsOf).toBe("2026-11-02");
      const scanCallsAfter = w.stub.calls.openalex.filter((u) => !String(u.searchParams.get("filter")).includes(",keywords.id:")).length;
      expect(scanCallsAfter).toBe(scanCallsBefore);
    });

    it("an empty value (or spaces) is no list at all, and so is a missing key or []", async () => {
      for (const value of [undefined, "", "  ", "[]"]) {
        const w = world();
        if (value !== undefined) w.kv.seed(TRENDING_KEYS.deny, value);
        await w.run(MONDAY);
        expect(chipsOf(w.file()), String(value)).toContain("AI literacy");
      }
    });
  });
});

describe("a scan that does not fit in one run", () => {
  const small = { wallMs: 40_000, batchMs: 15_000, finalizeMs: 20_000 };

  it("goes on in the next run from where it stopped, asks nothing twice, and finishes with the pool and the file", async () => {
    const w = world({ subfields: STUB_SUBFIELDS, limits: { batchSubfields: 2 } });
    const first = await w.run(MONDAY, small);
    expect(first.scan).toMatchObject({ completed: false, batches: B2 });
    expect(w.scan()).toMatchObject({ asOf: "2026-11-02", batches: B2, leaseUntil: 0 });
    const doneFirst = w.scan()!.next;
    expect(doneFirst).toBeGreaterThan(0);
    expect(doneFirst).toBeLessThan(B2);
    expect(w.pool()).toBeNull();
    expect(w.file()).toBeNull(); // nothing to show yet, and nothing is made up
    const asked = [...w.stub.calls.openalex.map((u) => u.href)];

    // a run a day, each with little time, until the pool and the file are there
    let runs = 1;
    while (w.file() === null && runs < 8) {
      runs++;
      w.hooks.scanDay = "2026-11-02";
      await w.run(`2026-11-0${runs + 1}T03:17:00Z`, small);
      if (w.pool() === null) expect(w.scan()!.next).toBeGreaterThan(doneFirst);
    }
    expect(runs).toBeGreaterThan(2);
    expect(w.pool()!.poolAsOf).toBe("2026-11-02"); // the day the scan began: its windows
    expect(chipsOf(w.file()).sort()).toEqual([...STUB_PHRASES].sort());
    // the scan's own calls were each made once (the pool's follow-up questions come after it, and ask about keywords, not subfields)
    const scanCalls = w.stub.calls.openalex.filter((u) => !String(u.searchParams.get("filter")).includes(",keywords.id:")).map((u) => u.href);
    expect(new Set(scanCalls).size).toBe(scanCalls.length);
    expect(asked.every((h) => scanCalls.includes(h))).toBe(true);
  });

  it("a run that has no time left for a batch starts none, and that is not a failure", async () => {
    const w = world();
    const r = await w.run(MONDAY, { wallMs: 1000, batchMs: 15_000 });
    expect(r.scan).toMatchObject({ completed: false });
    expect(w.stub.calls.openalex).toHaveLength(0);
  });

  it("two runs at once do not both scan: a run that finds the other's lease goes on to the daily work only", async () => {
    const w = world();
    seedPool(w, TWELVE());
    w.kv.seed(TRENDING_KEYS.scan, JSON.stringify({ version: 1, asOf: "2026-11-02", startedAt: Date.parse(MONDAY), next: 1, batches: B4, n: N, calls: 10, leaseUntil: Date.parse(TUESDAY) + 600_000 }));
    const r = await w.run(TUESDAY);
    expect(r.scan).toMatchObject({ skipped: "busy" });
    expect(w.stub.calls.openalex).toHaveLength(0);
    expect(r.daily).toMatchObject({ published: true });
  });

  it("a lease that has run out (the other run died) is taken over, and the scan goes on from its own day", async () => {
    const w = world();
    w.kv.seed(TRENDING_KEYS.scan, JSON.stringify({ version: 1, asOf: "2026-11-02", startedAt: Date.parse(MONDAY), next: 0, batches: B4, n: N, calls: 0, leaseUntil: Date.parse(TUESDAY) - 1 }));
    const r = await w.run(TUESDAY);
    expect(r.scan).toMatchObject({ asOf: "2026-11-02", completed: true });
  });

  it("a scan whose batches have gone from KV (they are kept 10 days) is begun again from today's windows", async () => {
    const w = world();
    w.kv.seed(TRENDING_KEYS.scan, JSON.stringify({ version: 1, asOf: "2026-11-02", startedAt: Date.parse(MONDAY), next: B4, batches: B4, n: N, calls: 10, leaseUntil: 0 }));
    w.hooks.scanDay = "2026-11-03";
    const r = await w.run(TUESDAY);
    expect(r.scan).toMatchObject({ asOf: "2026-11-03", completed: true });
    expect(w.pool()!.poolAsOf).toBe("2026-11-03");
  });

  it("a scan that has had five slow nights is still gone on with (a daily file that leaves little time must not make it start again for ever), and its pool is of the day it began", async () => {
    const small = { wallMs: 40_000, batchMs: 15_000, finalizeMs: 20_000 };
    const w = world({ subfields: STUB_SUBFIELDS, limits: { batchSubfields: 2 } });
    await w.run(MONDAY, small); // begins, does a batch or two
    expect(w.scan()).toMatchObject({ asOf: "2026-11-02", leaseUntil: 0 });
    expect(w.scan()!.next).toBeLessThan(B2);
    w.hooks.scanDay = "2026-11-02";
    await w.run("2026-11-07T03:17:00Z", { batchSubfields: 2 }); // five days later, with the time it needs
    expect(w.pool()!.poolAsOf).toBe("2026-11-02");
    expect(w.scan()).toMatchObject({ asOf: "2026-11-02", done: true });
  });

  it("a scan that is more than six days old is dropped and a new one begins", async () => {
    const w = world();
    w.kv.seed(TRENDING_KEYS.scan, JSON.stringify({ version: 1, asOf: "2026-10-26", startedAt: Date.parse("2026-10-26T03:17:00Z"), next: 1, batches: B4, n: N, calls: 10, leaseUntil: 0 }));
    const r = await w.run(MONDAY);
    expect(r.scan).toMatchObject({ asOf: "2026-11-02", completed: true });
    expect(w.pool()!.poolAsOf).toBe("2026-11-02");
  });

  it("a scan from another list of subfields (a deploy changed the table in between) is begun again, not mixed", async () => {
    const w = world();
    w.kv.seed(TRENDING_KEYS.scan, JSON.stringify({ version: 1, asOf: "2026-11-02", startedAt: Date.parse(MONDAY), next: 1, batches: 3, n: 99, calls: 10, leaseUntil: 0 }));
    const r = await w.run(MONDAY);
    expect(r.scan).toMatchObject({ completed: true });
    expect(w.stub.calls.openalex.length).toBeGreaterThan(40); // from the first batch
  });
});

describe("when it scans: weekly, on Monday, inside the daily run", () => {
  async function withPool() {
    const w = world();
    await w.run(MONDAY);
    w.clear();
    return w;
  }

  it("on any other day it asks OpenAlex nothing: the day's work is arXiv, the product's search and the file", async () => {
    const w = await withPool();
    const r = await w.run(TUESDAY);
    expect(w.stub.calls.openalex).toHaveLength(0);
    expect(w.stub.calls.arxiv).toHaveLength(6);
    expect(r.scan).toBeUndefined();
    expect(w.file()).toMatchObject({ asOf: "2026-11-03", poolAsOf: "2026-11-02" });
    expect(chipsOf(w.file()).sort()).toEqual([...STUB_PHRASES].sort());
  });

  it("on the next Monday, once the pool is a week old, a new scan is made, and the day's file is still made first, from the pool there is", async () => {
    const w = await withPool();
    w.hooks.scanDay = "2026-11-09";
    const r = await w.run(NEXT_MONDAY);
    expect(w.stub.calls.openalex.length).toBeGreaterThan(40);
    expect(r.scan).toMatchObject({ asOf: "2026-11-09", completed: true });
    expect(w.pool()!.poolAsOf).toBe("2026-11-09");
    expect(w.file()).toMatchObject({ asOf: "2026-11-09", poolAsOf: "2026-11-02" });
    // the next day's file is made from the new pool
    w.hooks.scanDay = "2026-11-09";
    await w.run("2026-11-10T03:17:00Z");
    expect(w.file()).toMatchObject({ asOf: "2026-11-10", poolAsOf: "2026-11-09" });
  });

  it("a second run on the Monday of a pool made that day does not scan again", async () => {
    const w = await withPool();
    await w.run("2026-11-02T09:00:00Z");
    expect(w.stub.calls.openalex).toHaveLength(0);
  });

  it("a week with no Monday run (it failed, or the schedule skipped it) is made up the next day: a pool 7 days old is scanned again on a Tuesday", async () => {
    const w = await withPool();
    w.hooks.scanDay = "2026-11-10";
    const r = await w.run("2026-11-10T03:17:00Z");
    expect(r.scan).toMatchObject({ asOf: "2026-11-10", completed: true });
  });

  it("a scan that fails leaves the day's file made, fails the run, and is continued the next day from its own windows", async () => {
    const w = await withPool();
    w.hooks.scanDay = "2026-11-09";
    let n = 0;
    w.hooks.fail = (source) => (source === "openalex" && ++n >= 5 ? new Response("down", { status: 503 }) : null);
    await expect(w.run(NEXT_MONDAY)).rejects.toMatchObject({ source: "openalex", kind: "http", status: 503 });
    expect(w.file()).toMatchObject({ asOf: "2026-11-09", poolAsOf: "2026-11-02" }); // the daily part came first and is kept
    expect(w.pool()!.poolAsOf).toBe("2026-11-02"); // the old pool is untouched
    expect(w.scan()).toMatchObject({ asOf: "2026-11-09", leaseUntil: 0 });
    w.hooks.fail = null;
    w.clear();
    const r = await w.run("2026-11-10T03:17:00Z");
    expect(r.scan).toMatchObject({ asOf: "2026-11-09", completed: true });
    expect(w.pool()!.poolAsOf).toBe("2026-11-09");
  });

});

describe("a weekly pool that is not renewed is said loudly, before the list goes", () => {
  const slim = { wallMs: 60_000, batchMs: 45_000 }; // the day's file takes about 50 seconds here, and a scan is not begun with what is left

  it("a pool 10 days old at the end of a run (its scan has not finished) fails the heartbeat with the days, although the day's file was made from it", async () => {
    const w = world();
    seedPool(w, TWELVE(), [], "2026-10-24"); // 10 days before the 3rd
    w.kv.seed(TRENDING_KEYS.file, "OLD FILE");
    w.hooks.scanDay = "2026-11-03";
    const err = await w.run(TUESDAY, slim).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String(err.message)).toMatch(/pool is 10 days old/);
    expect(String(err.message)).toMatch(/hidden when it is 14 days old/);
    expect(w.file()).toMatchObject({ asOf: "2026-11-03", poolAsOf: "2026-10-24" }); // the file was made first, and stands
  });

  it("9 days old is not yet said (the scan of this week may be half way)", async () => {
    const w = world();
    seedPool(w, TWELVE(), [], "2026-10-25");
    w.hooks.scanDay = "2026-11-03";
    const r = await w.run(TUESDAY, slim);
    expect(r.daily).toMatchObject({ published: true });
    expect(r.scan).toMatchObject({ completed: false });
  });

  it("a run that makes the new pool is not said to have an old one", async () => {
    const w = world();
    seedPool(w, TWELVE(), [], "2026-10-24");
    w.hooks.scanDay = "2026-11-03";
    const r = await w.run(TUESDAY);
    expect(r.scan).toMatchObject({ completed: true });
    expect(w.pool()!.poolAsOf).toBe("2026-11-03");
  });

  it("no pool at all is the first run, not a pool that is late", async () => {
    const w = world();
    const r = await w.run(MONDAY, { wallMs: 1000, batchMs: 15_000 });
    expect(r.scan).toMatchObject({ completed: false });
  });
});

describe("the pool that is too small", () => {
  it("is refused with a clear error, and the pool and the file that were there stay; the scan is not made again the same day", async () => {
    const w = world({ subfields: [1702, 3304, 1110] });
    seedPool(w, TWELVE(), [], "2026-10-26");
    const poolBefore = w.kv.read(TRENDING_KEYS.pool);
    w.hooks.scanDay = "2026-11-02";
    await expect(w.run(MONDAY)).rejects.toThrow(/pool.*too small|too small.*pool/i);
    expect(w.kv.read(TRENDING_KEYS.pool)).toBe(poolBefore);
    expect(w.scan()).toMatchObject({ asOf: "2026-11-02", done: true });
    w.clear();
    await w.run("2026-11-02T09:00:00Z"); // the same day again: the daily part only
    expect(w.stub.calls.openalex).toHaveLength(0);
  });
});

describe("the daily file", () => {
  it("is not made from fewer than 8 phrases: the run fails, and the last file stays exactly as it was", async () => {
    const w = world();
    seedPool(w, TWELVE().slice(0, 6));
    const old = JSON.stringify({ version: 1, asOf: "2026-11-02", generatedAt: "2026-11-02T03:17:00.000Z", validUntil: "2026-11-04T03:17:00.000Z", poolAsOf: "2026-11-02", disabled: false, groups: { global: { chips: [] }, in: { chips: [] } } });
    w.kv.seed(TRENDING_KEYS.file, old);
    await expect(w.run(TUESDAY)).rejects.toThrow(/only 6 phrases/);
    expect(w.kv.read(TRENDING_KEYS.file)).toBe(old);
    expect(w.kv.log.puts.some((p) => p.key === TRENDING_KEYS.file)).toBe(false);
  });

  it("is not made from phrases the product's own search cannot back: if too many fail the check, the run fails and the last file stays", async () => {
    const thin = async (q: string): Promise<SearchResponse> => ({ query: q, results: [], providers: { openalex: { ok: true, count: 0, ms: 1, cached: false } }, doiCheck: { ok: true, count: 0, ms: 0, cached: false }, retractionCheck: { ok: true, count: 0, ms: 0, cached: false }, tookMs: 1 });
    const w = world({ search: thin });
    seedPool(w, TWELVE());
    w.kv.seed(TRENDING_KEYS.file, "OLD FILE");
    await expect(w.run(TUESDAY)).rejects.toThrow(/only 0 phrases/);
    expect(w.kv.read(TRENDING_KEYS.file)).toBe("OLD FILE");
  });

  it("a phrase whose search could not check for retracted papers (retractionCheck.ok false) is not shown tonight, and is counted as such; the other phrases are", async () => {
    const inner = makeStubTrending({ asOf: () => day(MONDAY) });
    const crossrefDown = (bad: Set<string>) => async (q: string, scope: "all" | "india"): Promise<SearchResponse> => {
      const r = await inner.search(q, scope);
      return bad.has(q) ? { ...r, retractionCheck: { ok: false, count: 0, ms: 5, cached: false, error: "HTTP 429" } } : r;
    };
    const w = world({ search: crossrefDown(new Set(["AI literacy"])) });
    const r = await w.run(MONDAY);
    expect(chipsOf(w.file())).not.toContain("AI literacy");
    expect(chipsOf(w.file())).toHaveLength(8);
    expect(r.daily).toMatchObject({ published: true, rejected: { unchecked: 1 } });
  });

  it("when the check cannot answer for any phrase (Crossref is down for the night) nothing is written and the last file stays", async () => {
    const inner = makeStubTrending({ asOf: () => day(MONDAY) });
    const down = async (q: string, scope: "all" | "india"): Promise<SearchResponse> => ({ ...(await inner.search(q, scope)), retractionCheck: { ok: false, count: 0, ms: 5, cached: false, error: "HTTP 503" } });
    const w = world({ search: down });
    seedPool(w, TWELVE());
    w.kv.seed(TRENDING_KEYS.file, "OLD FILE");
    await expect(w.run(TUESDAY)).rejects.toThrow(/only 0 phrases/);
    expect(w.kv.read(TRENDING_KEYS.file)).toBe("OLD FILE");
  });

  it("a search that no source answered is an error of the run, not 'no results'", async () => {
    const down = async (q: string): Promise<SearchResponse> => ({ query: q, results: [], providers: { openalex: { ok: false, count: 0, ms: 1, cached: false, error: "HTTP 500" }, s2: { ok: false, count: 0, ms: 1, cached: false, error: "timeout" } }, doiCheck: { ok: true, count: 0, ms: 0, cached: false }, retractionCheck: { ok: true, count: 0, ms: 0, cached: false }, tookMs: 1 });
    const w = world({ search: down });
    seedPool(w, TWELVE());
    w.kv.seed(TRENDING_KEYS.file, "OLD FILE");
    await expect(w.run(TUESDAY)).rejects.toThrow(/no source answered/);
    expect(w.kv.read(TRENDING_KEYS.file)).toBe("OLD FILE");
  });

  describe("arXiv failing", () => {
    /** The stand-ins' pool: two of its nine phrases are from computing and physics, so arXiv is asked about two (and the same two again for India, which is not asked again tonight). */
    const arxivPhrases = (w: World) => w.pool()!.global.filter((c) => c.fieldId === 17 || c.fieldId === 31).map((c) => c.text);

    it("one arXiv request that fails (an Error entry under HTTP 200) costs that phrase its place for the night, not the whole file: the file is made from the others, and the heartbeat is good", async () => {
      const w = world();
      await w.run(MONDAY);
      expect(chipsOf(w.file())).toHaveLength(9);
      let n = 0;
      w.hooks.fail = (source) => (source === "arxiv" && ++n === 1 ? new Response(ERROR_XML, { status: 200 }) : null);
      w.clear();
      const r = await w.run(TUESDAY);
      expect(w.file()).toMatchObject({ asOf: "2026-11-03" }); // a new file, written tonight
      const gone = STUB_PHRASES.filter((p) => !chipsOf(w.file()).includes(p));
      expect(gone).toHaveLength(1);
      expect(arxivPhrases(w)).toContain(gone[0]); // the phrase whose arXiv count could not be had
      expect(chipsOf(w.file()).length).toBeGreaterThanOrEqual(8); // (a phrase the domain cap had shut out takes its place)
      expect(chipsOf(w.file())).toEqual(expect.not.arrayContaining([gone[0]!]));
      expect(r.daily).toMatchObject({ published: true });
      expect(r.daily!.rejected!.unconfirmed).toBeGreaterThanOrEqual(1);
      expect(w.stub.calls.arxiv.length).toBe(1 + 3); // the failed one (nothing is asked again for it tonight, not even for India), and the other phrase's three
    });

    it("an arXiv server error (HTTP 500, after its one retry) is the same: that phrase only", async () => {
      const w = world();
      await w.run(MONDAY);
      let n = 0;
      w.hooks.fail = (source) => (source === "arxiv" && ++n <= 2 ? new Response("overloaded", { status: 500 }) : null); // the request and its retry
      w.clear();
      const r = await w.run(TUESDAY);
      expect(chipsOf(w.file()).length).toBeGreaterThanOrEqual(8);
      expect(w.file()).toMatchObject({ asOf: "2026-11-03" });
      expect(r.daily).toMatchObject({ published: true });
      expect(r.daily!.rejected!.unconfirmed).toBeGreaterThanOrEqual(1);
    });

    it("three phrases in a row that arXiv cannot answer is an outage, not a hiccup: the run fails with arXiv's own error and the last file stays", async () => {
      const w = world();
      seedPool(w, [cand("computing topic a", 17, 3, 2.5), cand("computing topic b", 17, 3, 2.4), cand("computing topic c", 17, 3, 2.3), cand("computing topic d", 17, 3, 2.2), ...TWELVE()]);
      w.kv.seed(TRENDING_KEYS.file, "OLD FILE");
      w.hooks.fail = (source) => (source === "arxiv" ? new Response(ERROR_XML, { status: 200 }) : null);
      const err = await w.run(TUESDAY).catch((e) => e);
      expect(err).toBeInstanceOf(SourceError);
      expect(err).toMatchObject({ source: "arxiv", kind: "error_entry" });
      expect(w.kv.read(TRENDING_KEYS.file)).toBe("OLD FILE");
      expect(w.stub.calls.arxiv).toHaveLength(3); // three phrases tried, one request each (an Error entry is not retried), and no fourth
    });

    it("an arXiv answer in between resets the count: two failures, an answer, two failures is four hiccups, not an outage", async () => {
      const w = world();
      // one phrase a field (17 computing, 26 mathematics, 31 physics): alpha and bravo fail, charlie answers and is shown, then delta and echo (the same fields, now taken... they are asked only if the field is empty)
      seedPool(w, [cand("alpha computing", 17, 3, 2.5), cand("bravo mathematics", 26, 3, 2.4), cand("charlie physics", 31, 3, 2.3), cand("delta computing", 17, 3, 2.2), cand("echo mathematics", 26, 3, 2.1), ...TWELVE()]);
      const failing = ["alpha computing", "bravo mathematics", "delta computing", "echo mathematics"];
      w.hooks.fail = (source, url) => (source === "arxiv" && failing.some((p) => (url.searchParams.get("search_query") ?? "").includes(p)) ? new Response(ERROR_XML, { status: 200 }) : null);
      const r = await w.run(TUESDAY);
      expect(chipsOf(w.file())).toContain("charlie physics");
      expect(chipsOf(w.file())).not.toContain("alpha computing");
      expect(w.stub.calls.arxiv.map((u) => /all:"([^"]+)"/.exec(u.searchParams.get("search_query") ?? "")![1])).toEqual(["alpha computing", "bravo mathematics", "charlie physics", "charlie physics", "charlie physics", "delta computing", "echo mathematics"]);
      expect(r.daily).toMatchObject({ published: true });
      expect(r.daily!.rejected!.unconfirmed).toBe(4);
    });

    it("a failure that is not arXiv's (the call budget, the hard stop) is not turned into a rejected phrase", async () => {
      const w = world();
      seedPool(w, [cand("computing topic a", 17, 3, 2.5), ...TWELVE()]);
      w.kv.seed(TRENDING_KEYS.file, "OLD FILE");
      const err = await w.run(TUESDAY, { runCalls: 2 }).catch((e) => e);
      expect(err).toBeInstanceOf(BudgetError);
      expect(w.kv.read(TRENDING_KEYS.file)).toBe("OLD FILE");
    });
  });

  it("stops, with an error and the last file left, when the searches take longer than a scheduled run may last", async () => {
    const w = world();
    seedPool(w, TWELVE());
    w.kv.seed(TRENDING_KEYS.file, "OLD FILE");
    await expect(w.run(TUESDAY, { hardStopMs: 10_000 })).rejects.toThrow(/ran out of time/); // a search takes 4 seconds here
    expect(w.stub.calls.searches.length).toBeLessThan(12);
    expect(w.kv.read(TRENDING_KEYS.file)).toBe("OLD FILE");
  });

  it("asks the search only for what it needs: with more candidates than the list holds, the ones the caps shut out are never searched", async () => {
    const w = world();
    seedPool(w, [...TWELVE(), cand("thirteenth topic", 19, 3, 1.55), cand("fourteenth topic", 21, 3, 1.5)]);
    await w.run(TUESDAY);
    expect(chipsOf(w.file())).toHaveLength(12);
    expect(w.stub.calls.searches).toHaveLength(12);
    expect(w.stub.calls.openalex).toHaveLength(0);
  });

  it("keeps what was shown last time unless something scores 1.25 times higher (the last file's phrases are read back from KV)", async () => {
    const stay = cand("stay topic", 33, 2, 1.6);
    const twelveWithout = TWELVE().filter((c) => c.fieldId !== 33);
    for (const [rivalScore, expected] of [[1.9, "stay topic"], [2.1, "rival topic"]] as const) {
      const w = world();
      seedPool(w, [...twelveWithout, stay, cand("rival topic", 33, 2, rivalScore)]);
      w.kv.seed(TRENDING_KEYS.file, JSON.stringify({ version: 1, asOf: "2026-11-02", generatedAt: "2026-11-02T03:17:00.000Z", validUntil: "2026-11-04T03:17:00.000Z", poolAsOf: "2026-11-02", disabled: false, groups: { global: { chips: [{ text: "stay topic", sinceYear: 2025, a: 300, b: 100, field: "Field number 33" }] }, in: { chips: [] } } }));
      await w.run(TUESDAY);
      expect(chipsOf(w.file()), `rival ${rivalScore}`).toContain(expected);
      expect(chipsOf(w.file()), `rival ${rivalScore}`).not.toContain(expected === "stay topic" ? "rival topic" : "stay topic");
    }
  });

  it("never publishes a phrase twice or more than 12, in the order the page can use, and what it writes the page's own reader accepts unchanged", async () => {
    const w = world();
    seedPool(w, TWELVE());
    await w.run(TUESDAY);
    const text = w.kv.read(TRENDING_KEYS.file)!;
    const f = parseTrending(JSON.parse(text))!;
    expect(f).not.toBeNull();
    expect(JSON.parse(text)).toEqual(f);
    expect(f.groups.global.chips).toHaveLength(12);
    expect(new Set(chipsOf(f).map((x) => x.toLowerCase())).size).toBe(12);
  });

  it("does not make a file from a pool older than the page would accept (14 days): it writes nothing and says why (the pool is late); once a new pool exists the file is made from it", async () => {
    const w = world();
    seedPool(w, TWELVE(), [], "2026-10-15"); // 19 days before the 3rd
    w.kv.seed(TRENDING_KEYS.file, "OLD FILE");
    w.hooks.scanDay = "2026-11-03";
    await expect(w.run(TUESDAY, { wallMs: 20_000 })).rejects.toThrow(/pool is 19 days old/); // no time for a scan today
    expect(w.kv.read(TRENDING_KEYS.file)).toBe("OLD FILE");
    expect(TRENDING_POOL_MAX_DAYS).toBe(14);
    const next = await w.run(TUESDAY); // with the time, the scan is made, and the file after it
    expect(next.scan).toMatchObject({ asOf: "2026-11-03", completed: true });
    expect(w.file()).toMatchObject({ asOf: "2026-11-03", poolAsOf: "2026-11-03" });
  });
});

describe("the switches", () => {
  it("the variable TRENDING=off stops the job: no call, no read, no write", async () => {
    for (const variable of ["off", " OFF "]) {
      const w = world({ variable });
      const r = await w.run(MONDAY);
      expect(r).toMatchObject({ skipped: "off" });
      expect(w.stub.calls.openalex).toHaveLength(0);
      expect(w.stub.calls.arxiv).toHaveLength(0);
      expect(w.stub.calls.searches).toHaveLength(0);
      expect(w.kv.ops).toBe(0);
    }
  });

  it("the variable TRENDING=dark (the step after the launch state) does NOT stop the job: the list is made so the owner can read it, and the route hides it (routes.test.ts)", async () => {
    for (const variable of ["dark", " DARK ", "on", ""]) {
      const w = world({ variable });
      const r = await w.run(MONDAY);
      expect(r.skipped, variable).toBeUndefined();
      expect(chipsOf(w.file()).length, variable).toBeGreaterThanOrEqual(8);
    }
  });

  it("the KV flag trending:v1:off does not stop the job: the list is still made (that is how the owner reads it before it is shown), and the route hides it", async () => {
    const w = world();
    w.kv.seed(TRENDING_KEYS.off, "1");
    await w.run(MONDAY);
    expect(chipsOf(w.file()).length).toBeGreaterThanOrEqual(8);
    expect(w.kv.read(TRENDING_KEYS.off)).toBe("1");
  });
});

describe("the budget", () => {
  it("a run with too few calls left for a batch starts none: it goes on in the next run, and that is not a failure", async () => {
    const w = world();
    const r = await w.run(MONDAY, { runCalls: 12 });
    expect(r.scan).toMatchObject({ completed: false });
    expect(w.stub.calls.openalex).toHaveLength(0);
  });

  it("the daily part that would make more calls than the run may stops with a clear error before the call that would go over, and the last file stays", async () => {
    const w = world();
    seedPool(w, TWELVE());
    w.kv.seed(TRENDING_KEYS.file, "OLD FILE");
    const err = await w.run(TUESDAY, { runCalls: 60 }).catch((e) => e); // a search is counted as 25 calls
    expect(err).toBeInstanceOf(BudgetError);
    expect(w.stub.calls.searches.length).toBeLessThanOrEqual(2);
    expect(w.kv.read(TRENDING_KEYS.file)).toBe("OLD FILE");
  });

  it("a weekly scan that would go over its calls stops with a clear error, and no pool is made from half of it", async () => {
    const w = world();
    const err = await w.run(MONDAY, { scanCalls: 30 }).catch((e) => e);
    expect(err).toBeInstanceOf(BudgetError);
    expect(w.pool()).toBeNull();
  });

  it("the whole default scan of the 243 subfields is counted before it is run: its calls fit the weekly and the per-run limits with room", () => {
    // 243 subfields, two windows each for everyone (486) and for India's 153 allowed ones, B only where A is big enough (at most 306), the checks of 160 candidates (2 each for everyone, 1 for India),
    // the exact baselines (55): about 1,200 calls, against what a Paid Worker may make in one invocation (10,000) and the limits here
    const worst = 243 * 2 + 153 * 2 + 120 * 2 + 50 + 40 + 15;
    expect(worst).toBeLessThan(TRENDING_LIMITS.scanCalls);
    expect(TRENDING_LIMITS.scanCalls).toBeLessThan(TRENDING_LIMITS.runCalls);
    expect(TRENDING_LIMITS.runCalls).toBeLessThan(10_000 / 4); // other jobs share the invocation's 10,000
    expect(TRENDING_LIMITS.wallMs).toBeLessThan(15 * 60_000 - 3 * 60_000);
  });
});
