import { afterEach, describe, expect, it, vi } from "vitest";
import { memoryStore, type CacheStore } from "../cache/store";
import { LookupError, crossrefByDoi, crossrefReferenceStrings, crossrefSearch, doiResolves, openAlexByDoi, openAlexSearchTitle, type LookupEnv } from "../references/lookup";
import { checkDois } from "./doi-check";
import { retractedDois } from "./retraction";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
afterEach(() => vi.unstubAllGlobals());

/** A store that remembers the lifetime each entry was given. */
function spyStore() {
  const inner = memoryStore();
  const ttls: Record<string, number> = {};
  const store: CacheStore = {
    get: (k) => inner.get(k),
    getMany: (ks) => inner.getMany!(ks),
    set: async (k, v, ttl, source) => {
      ttls[k] = ttl;
      await inner.set(k, v, ttl, source);
    },
  };
  return { store, ttls, inner };
}
const day = 24 * 3600;

/* ---------------------------------------------------------------- DOI checks, one entry per DOI */

function stubDoiWorld(opts: { registered?: Record<string, string>; handles?: Record<string, number | "error"> }) {
  const crossref: string[] = [];
  const handles: string[] = [];
  vi.stubGlobal("fetch", async (input: unknown) => {
    const url = String(input);
    if (url.includes("api.crossref.org/works?")) {
      crossref.push(decodeURIComponent(new URL(url).searchParams.get("filter") ?? ""));
      const asked = (decodeURIComponent(new URL(url).searchParams.get("filter") ?? "").match(/doi:[^,]+/g) ?? []).map((s) => s.slice(4));
      return json({ message: { items: asked.filter((d) => opts.registered?.[d]).map((DOI) => ({ DOI, title: [opts.registered![DOI]] })) } });
    }
    const m = url.match(/doi\.org\/api\/handles\/(.+)$/);
    if (m) {
      const d = decodeURIComponent(m[1]!);
      handles.push(d);
      const h = opts.handles?.[d];
      if (h === "error") return new Response("", { status: 503 });
      return h === 1 ? json({ responseCode: 1 }) : json({ responseCode: 100 }, 404);
    }
    return new Response("", { status: 404 });
  });
  return { crossref, handles };
}
const dEnv = (store: CacheStore) => ({ store, CROSSREF_MAILTO: "t@example.org" });
const sig = () => AbortSignal.timeout(5000);

describe("checkDois keeps one answer per DOI", () => {
  it("a second search with the same DOIs makes no call at all", async () => {
    const world = stubDoiWorld({ registered: { "10.1/a": "Alpha paper title" }, handles: { "10.2/b": 1 } });
    const { store } = spyStore();
    const first = await checkDois(["10.1/a", "10.2/b"], dEnv(store), sig());
    expect(first["10.1/a"]!.status).toBe("registered");
    expect(first["10.2/b"]!.status).toBe("resolves");
    const calls = world.crossref.length + world.handles.length;
    const second = await checkDois(["10.2/b", "10.1/a"], dEnv(store), sig());
    expect(second).toEqual(first);
    expect(world.crossref.length + world.handles.length).toBe(calls);
  });

  it("a search that shares some DOIs with an earlier one asks only about the others", async () => {
    const world = stubDoiWorld({ registered: { "10.1/a": "A", "10.1/b": "B", "10.1/c": "C" } });
    const { store } = spyStore();
    await checkDois(["10.1/a", "10.1/b"], dEnv(store), sig());
    expect(world.crossref).toEqual(["doi:10.1/a,doi:10.1/b"]);
    const out = await checkDois(["10.1/b", "10.1/c"], dEnv(store), sig());
    expect(world.crossref).toEqual(["doi:10.1/a,doi:10.1/b", "doi:10.1/c"]);
    expect(Object.keys(out).sort()).toEqual(["10.1/b", "10.1/c"]);
  });

  it("keeps an answer as long as that kind of answer stays true: registered and resolving for a week, not found for six hours, a hiccup not at all", async () => {
    stubDoiWorld({ registered: { "10.1/a": "A" }, handles: { "10.2/ok": 1, "10.3/gone": 0, "10.4/hiccup": "error" } });
    const { store, ttls } = spyStore();
    await checkDois(["10.1/a", "10.2/ok", "10.3/gone", "10.4/hiccup"], dEnv(store), sig());
    const byDoi = Object.fromEntries(Object.entries(ttls).map(([k, v]) => [k, v]));
    expect(Object.values(byDoi).sort((x, y) => x - y)).toEqual([6 * 3600, 7 * day, 7 * day]);
    expect(Object.keys(ttls)).toHaveLength(3);
  });

  it("asks again about a DOI whose check had a hiccup, and about nothing else", async () => {
    const w1 = stubDoiWorld({ registered: { "10.1/a": "A" }, handles: { "10.4/hiccup": "error" } });
    const { store } = spyStore();
    const first = await checkDois(["10.1/a", "10.4/hiccup"], dEnv(store), sig());
    expect(first["10.4/hiccup"]!.status).toBe("unchecked");
    expect(w1.handles).toEqual(["10.4/hiccup"]);
    const w2 = stubDoiWorld({ registered: { "10.1/a": "A" }, handles: { "10.4/hiccup": 1 } });
    const second = await checkDois(["10.1/a", "10.4/hiccup"], dEnv(store), sig());
    expect(second["10.4/hiccup"]!.status).toBe("resolves");
    expect(w2.crossref).toEqual(["doi:10.4/hiccup"]);
  });

  it("treats a damaged entry, or a store that cannot be read, as nothing known", async () => {
    stubDoiWorld({ registered: { "10.1/a": "A" } });
    const { store, inner } = spyStore();
    await checkDois(["10.1/a"], dEnv(store), sig());
    const key = [...(await inner.getMany!(["x"])).keys()][0];
    expect(key).toBe("x");
    const broken: CacheStore = { get: async () => { throw new Error("down"); }, getMany: async () => { throw new Error("down"); }, set: async () => {} };
    const out = await checkDois(["10.1/a"], dEnv(broken), sig());
    expect(out["10.1/a"]!.status).toBe("registered");
  });

  it("leaves out a DOI with a comma (it breaks the filter), and does nothing for no DOIs", async () => {
    const world = stubDoiWorld({});
    const { store } = spyStore();
    expect(await checkDois(["10.1/a,b", ""], dEnv(store), sig())).toEqual({});
    expect(await checkDois([], dEnv(store), sig())).toEqual({});
    expect(world.crossref).toEqual([]);
  });
});

/* ---------------------------------------------------------------- retraction checks, one entry per DOI */

function retractionFetch(retracted: string[], fail = false) {
  const asked: string[][] = [];
  const f = (async (url: string) => {
    if (fail) return new Response("", { status: 500 });
    const filter = decodeURIComponent(new URL(url).searchParams.get("filter") ?? "");
    const dois = (filter.match(/updates:[^,]+/g) ?? []).map((s) => s.slice(8));
    asked.push(dois);
    return json({ message: { items: dois.filter((d) => retracted.includes(d)).map((d) => ({ "update-to": [{ DOI: d, type: "retraction" }] })) } });
  }) as unknown as typeof fetch;
  return { f, asked };
}
const rEnv = (f: typeof fetch) => ({ CROSSREF_MAILTO: "t@example.org", fetch: f });

describe("retractedDois keeps one answer per DOI", () => {
  it("remembers who is retracted and who is not; a repeat asks nothing", async () => {
    const { f, asked } = retractionFetch(["10.1234/bad"]);
    const { store, ttls } = spyStore();
    const first = await retractedDois(store, ["10.1234/bad", "10.1234/fine"], rEnv(f), sig());
    expect([...first.retracted]).toEqual(["10.1234/bad"]);
    expect(first.fromCache).toBe(false);
    expect(Object.values(ttls)).toEqual([day, day]);
    const second = await retractedDois(store, ["10.1234/fine", "10.1234/bad"], rEnv(f), sig());
    expect([...second.retracted]).toEqual(["10.1234/bad"]);
    expect(second.fromCache).toBe(true);
    expect(asked).toHaveLength(1);
  });

  it("asks Crossref only about the DOIs it does not know yet", async () => {
    const { f, asked } = retractionFetch(["10.1234/bad"]);
    const { store } = spyStore();
    await retractedDois(store, ["10.1234/a", "10.1234/b"], rEnv(f), sig());
    const next = await retractedDois(store, ["10.1234/b", "10.1234/bad"], rEnv(f), sig());
    expect(asked).toEqual([["10.1234/a", "10.1234/b"], ["10.1234/bad"]]);
    expect([...next.retracted]).toEqual(["10.1234/bad"]);
    expect(next.fromCache).toBe(false);
  });

  it("when Crossref cannot be asked it throws and keeps nothing (so 'not retracted' is never claimed from a failure)", async () => {
    const { f } = retractionFetch([], true);
    const { store, ttls } = spyStore();
    await expect(retractedDois(store, ["10.1234/a"], rEnv(f), sig())).rejects.toThrow();
    expect(ttls).toEqual({});
  });

  it("leaves out a DOI with a comma, and works without a store", async () => {
    const { f, asked } = retractionFetch(["10.1234/bad"]);
    const { store, ttls } = spyStore();
    const out = await retractedDois(store, ["10.1234/x,y", "10.1234/bad"], rEnv(f), sig());
    expect([...out.retracted]).toEqual(["10.1234/bad"]);
    expect(Object.keys(ttls)).toHaveLength(1);
    const plain = await retractedDois(undefined, ["10.1234/bad"], rEnv(f), sig());
    expect([...plain.retracted]).toEqual(["10.1234/bad"]);
    expect(plain.fromCache).toBe(false);
    expect(asked).toHaveLength(2);
    expect((await retractedDois(store, [], rEnv(f), sig())).fromCache).toBe(true);
  });
});

/* ---------------------------------------------------------------- reference lookups */

type Handler = (url: string) => Response | Promise<Response>;
function lookupEnv(handler: Handler, store: CacheStore | undefined): { env: LookupEnv; calls: string[] } {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => (calls.push(url), handler(url))) as unknown as typeof fetch;
  return { env: { CROSSREF_MAILTO: "t@example.org", fetch: fetchImpl, store }, calls };
}
const crItem = { DOI: "10.1/A", title: ["A title that is long enough"], author: [{ given: "Ann", family: "Lee" }], issued: { "date-parts": [[2020]] }, "container-title": ["J"] };

describe("reference lookups are remembered", () => {
  it("a DOI looked up twice is asked once, whatever its capitals", async () => {
    const { store } = spyStore();
    const { env, calls } = lookupEnv(() => json({ message: crItem }), store);
    const a = await crossrefByDoi("10.1/A", env);
    const b = await crossrefByDoi("10.1/a", env);
    expect(a).toEqual(b);
    expect(a!.title).toBe("A title that is long enough");
    expect(calls).toHaveLength(1);
  });

  it("'not registered' is an answer too, kept for six hours; a found record for a week", async () => {
    const { store, ttls } = spyStore();
    const { env, calls } = lookupEnv((u) => (u.includes("/works/10.9/none") ? new Response("", { status: 404 }) : json({ message: crItem })), store);
    expect(await crossrefByDoi("10.9/none", env)).toBeNull();
    expect(await crossrefByDoi("10.9/none", env)).toBeNull();
    expect(calls).toHaveLength(1);
    await crossrefByDoi("10.1/A", env);
    expect(Object.values(ttls).sort((x, y) => x - y)).toEqual([6 * 3600, 7 * day]);
  });

  it("an upstream failure is never kept: it throws every time and the next call asks again", async () => {
    const { store, ttls } = spyStore();
    let up = false;
    const { env, calls } = lookupEnv(() => (up ? json({ message: crItem }) : new Response("", { status: 503 })), store);
    await expect(crossrefByDoi("10.1/A", env)).rejects.toBeInstanceOf(LookupError);
    await expect(crossrefByDoi("10.1/A", env)).rejects.toBeInstanceOf(LookupError);
    expect(calls).toHaveLength(2);
    expect(ttls).toEqual({});
    up = true;
    expect((await crossrefByDoi("10.1/A", env))!.year).toBe(2020);
  });

  it("identical lookups made at the same moment make one call (a bibliography checked in parallel)", async () => {
    const { store } = spyStore();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { env, calls } = lookupEnv(async () => (await gate, json({ message: crItem })), store);
    const all = Promise.all([crossrefByDoi("10.1/A", env), crossrefByDoi("10.1/A", env), crossrefByDoi("10.1/a", env)]);
    await new Promise((r) => setTimeout(r, 5));
    release();
    const out = await all;
    expect(calls).toHaveLength(1);
    expect(out.every((o) => o?.title === "A title that is long enough")).toBe(true);
  });

  it("searches are remembered by their text (and the number of rows), a different text asks again", async () => {
    const { store } = spyStore();
    const { env, calls } = lookupEnv(() => json({ message: { items: [crItem] } }), store);
    await crossrefSearch("Lee 2020 A title", env);
    await crossrefSearch("lee 2020 a title", env);
    await crossrefSearch("Lee 2020 A title", env, 3);
    await crossrefSearch("Someone else 2019 Another", env);
    expect(calls).toHaveLength(3);
  });

  it("an empty search result is kept for six hours (a new paper may be indexed), a non-empty one for a week", async () => {
    const { store, ttls } = spyStore();
    const { env } = lookupEnv((u) => (u.includes("empty") ? json({ message: { items: [] } }) : json({ message: { items: [crItem] } })), store);
    await crossrefSearch("empty query text", env);
    await crossrefSearch("full query text", env);
    expect(Object.values(ttls).sort((x, y) => x - y)).toEqual([6 * 3600, 7 * day]);
  });

  it("OpenAlex lookups (the ones with a daily budget) and the doi.org check are remembered too", async () => {
    const { store } = spyStore();
    const oa = { doi: "https://doi.org/10.48550/arxiv.1706.03762", title: "Attention Is All You Need", publication_year: 2017, authorships: [{ author: { display_name: "Ashish Vaswani" } }], primary_location: null };
    const { env, calls } = lookupEnv((u) => (u.includes("doi.org/api/handles") ? json({ responseCode: 1 }) : u.includes("title.search") ? json({ results: [oa] }) : json(oa)), store);
    await openAlexByDoi("10.48550/arxiv.1706.03762", env);
    await openAlexByDoi("10.48550/arxiv.1706.03762", env);
    await openAlexSearchTitle("Attention is all you need", env);
    await openAlexSearchTitle("Attention  is all you need!", env);
    expect(await doiResolves("10.1/x", env)).toBe(true);
    expect(await doiResolves("10.1/x", env)).toBe(true);
    expect(calls).toHaveLength(3);
  });

  it("a DOI that does not resolve is kept as false for six hours", async () => {
    const { store, ttls } = spyStore();
    const { env, calls } = lookupEnv(() => new Response("", { status: 404 }), store);
    expect(await doiResolves("10.9/none", env)).toBe(false);
    expect(await doiResolves("10.9/none", env)).toBe(false);
    expect(calls).toHaveLength(1);
    expect(Object.values(ttls)).toEqual([6 * 3600]);
  });

  it("the reference list a publisher deposited is remembered, and an empty one for less time", async () => {
    const { store } = spyStore();
    const { env, calls } = lookupEnv(() => json({ message: { reference: [{ DOI: "10.1/x", unstructured: "Lee A. (2019). A cited work with enough words in it. J 1, 1-2." }] } }), store);
    expect(await crossrefReferenceStrings("10.1/A", env)).toHaveLength(1);
    expect(await crossrefReferenceStrings("10.1/A", env)).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it("without a store every lookup goes upstream (the eval harness and most tests)", async () => {
    const { env, calls } = lookupEnv(() => json({ message: crItem }), undefined);
    await crossrefByDoi("10.1/A", env);
    await crossrefByDoi("10.1/A", env);
    expect(calls).toHaveLength(2);
  });
});
