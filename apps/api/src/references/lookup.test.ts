import { afterEach, describe, expect, it, vi } from "vitest";
import { memoryStore, type CacheStore } from "../cache/store";
import { LookupError, crossrefByDoi, crossrefReferenceStrings, crossrefSearch, doiResolves, openAlexByDoi, openAlexSearchTitle, type LookupEnv } from "./lookup";

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
