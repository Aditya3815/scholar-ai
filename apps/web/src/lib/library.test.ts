import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Paper } from "@scholar/shared";
import { storage, target } from "../test/fake-storage";

/**
 * A paper saved before B5 (docs/design/untangle.md, decision 16) keeps working: a title with no Latin letter or digit used to fold to "" and the paper was saved under `t:|<year>`; the search now
 * gives it `t:<its own key>|<year>`. The entry stays as it was saved (on this device and on the server), still shows Saved against the paper, and is removed by the id the server keeps.
 */

const auth = vi.hoisted(() => ({ user: null as { id: string } | null, listener: null as null | (() => void) }));
vi.mock("./auth", () => ({ getAuthState: () => ({ status: "ready", user: auth.user, providers: [] }), subscribeAuth: (l: () => void) => ((auth.listener = l), () => {}) }));
vi.mock("./notice", () => ({ showNotice: () => {} }));
vi.mock("react", () => ({ useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get() }));

const HINDI = "भारत में जल संकट";
const paper = (id: string, title: string): Paper => ({ id, doi: null, pmid: null, title, authors: [], year: 2021, venue: null, abstract: null, citationCount: null, oaUrl: null, retracted: false, retractionSources: [], sources: ["openalex"], score: 1 });

const g = globalThis as unknown as Record<string, unknown>;
let local: ReturnType<typeof storage>;
let calls: { url: string; method: string }[];

async function load(saved: Paper[]) {
  vi.resetModules();
  local = storage();
  local.setItem("scholar.library.v1", JSON.stringify(saved.map((p) => ({ ...p, savedAt: 1 }))));
  g.localStorage = local;
  g.document = Object.assign(target(), { visibilityState: "visible" });
  g.window = target();
  calls = [];
  g.fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET" });
    return new Response("{}", { status: 200 });
  };
  return import("./library");
}

describe("a paper saved under the id every such title of its year shared (B5)", () => {
  beforeEach(() => {
    auth.user = null;
  });

  it("stands for the paper its own title names now, and a paper saved since keeps its id", async () => {
    const lib = await load([paper("t:|2021", HINDI), paper("doi:10.1/x", "A")]);
    const [old, other] = lib.useLibrary();
    expect(lib.savedIdOf(old!)).toBe(`t:${HINDI}|2021`);
    expect(lib.savedIdOf(other!)).toBe("doi:10.1/x");
  });

  it("shows Saved against the paper as the search names it now, and against itself in the library", async () => {
    const lib = await load([paper("t:|2021", HINDI)]);
    const fresh = paper(`t:भारत में जल संकट|2021`, HINDI);
    expect(lib.savedEntry(lib.useLibrary(), fresh)?.id).toBe("t:|2021");
    expect(lib.savedEntry(lib.useLibrary(), lib.useLibrary()[0]!)?.id).toBe("t:|2021");
    expect(lib.savedEntry(lib.useLibrary(), paper("t:अन्य शीर्षक|2021", "अन्य शीर्षक"))).toBeUndefined();
  });

  it("is removed by the id it was saved under: on this device, and on the server for a signed-in person", async () => {
    let lib = await load([paper("t:|2021", HINDI)]);
    lib.toggleSaved(paper(`t:भारत में जल संकट|2021`, HINDI));
    expect(lib.useLibrary()).toEqual([]);

    lib = await load([]);
    g.fetch = async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET" });
      return new Response(JSON.stringify({ items: [{ ...paper("t:|2021", HINDI), savedAt: 1 }], alerts: [] }), { status: 200 });
    };
    auth.user = { id: "u1" };
    auth.listener!(); // the person signs in: the account's list is read
    await vi.waitFor(() => expect(lib.useLibrary().map((p) => p.id)).toEqual(["t:|2021"]));
    lib.toggleSaved(paper(`t:भारत में जल संकट|2021`, HINDI));
    expect(lib.useLibrary()).toEqual([]);
    await vi.waitFor(() => expect(calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual([`/api/v1/library/${encodeURIComponent("t:|2021")}`]));
  });
});
