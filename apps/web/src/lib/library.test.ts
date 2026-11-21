import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Paper } from "@scholar/shared";
import { storage, target } from "../test/fake-storage";

/**
 * A paper saved before B5 (docs/design/untangle.md, decision 16) keeps working: a title with no Latin letter or digit used to fold to "" and the paper was saved under `t:|<year>`; the search now
 * gives it `t:<its own key>|<year>`. The entry stays as it was saved (on this device and on the server), still shows Saved against the paper, and is removed by the id the server keeps.
 */

const auth = vi.hoisted(() => ({ user: null as { id: string } | null, listener: null as null | (() => void) }));
vi.mock("./auth", () => ({ getAuthState: () => ({ status: "ready", user: auth.user, providers: [] }), subscribeAuth: (l: () => void) => ((auth.listener = l), () => {}) }));
const notices = vi.hoisted(() => [] as string[]);
vi.mock("./notice", () => ({ showNotice: (t: string) => void notices.push(t) }));
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

/** The library's requests and the words of their failures, as they were before the one browser client (docs/design/untangle.md, F9). */
describe("the account's library on the server", () => {
  type Seen = { url: string; method: string; headers: Record<string, string>; body: unknown; credentials: RequestCredentials | undefined };
  let seen: Seen[];
  let answer: (url: string, method: string) => Response | Promise<Response>;
  const signIn = async (saved: Paper[] = []) => {
    const lib = await load(saved);
    seen = [];
    g.fetch = async (url: string, init: RequestInit = {}) => {
      seen.push({ url, method: init.method ?? "GET", headers: Object.fromEntries(new Headers(init.headers).entries()), body: init.body ? JSON.parse(String(init.body)) : null, credentials: init.credentials });
      return answer(url, init.method ?? "GET");
    };
    notices.length = 0;
    auth.user = { id: "u1" };
    auth.listener!();
    return lib;
  };
  const listOf = (items: Paper[]) => new Response(JSON.stringify({ items: items.map((p) => ({ ...p, savedAt: 1 })), alerts: [{ paperId: "doi:10.1/a", kind: "retracted" }] }), { status: 200 });

  it("signing in reads the list, moves the papers of this device into it and reads it again", async () => {
    answer = (url) => (url === "/api/v1/library" ? listOf([paper("doi:10.1/a", "A")]) : new Response("{}", { status: 200 }));
    const lib = await signIn([paper("doi:10.1/b", "B")]);
    await vi.waitFor(() => expect(seen).toHaveLength(3));
    expect(seen.map(({ url, method, headers, credentials }) => ({ url, method, headers, credentials }))).toEqual([
      { url: "/api/v1/library", method: "GET", headers: {}, credentials: "same-origin" },
      { url: "/api/v1/library/import", method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin" },
      { url: "/api/v1/library", method: "GET", headers: {}, credentials: "same-origin" },
    ]);
    expect((seen[1]!.body as { items: { id: string }[] }).items.map((p) => p.id)).toEqual(["doi:10.1/b"]);
    await vi.waitFor(() => expect(lib.useLibraryAlerts()).toHaveLength(1));
  });

  it("the words when the list cannot be read, or the device's papers cannot be moved", async () => {
    answer = () => new Response("x", { status: 500 });
    await signIn();
    await vi.waitFor(() => expect(notices).toEqual(["We could not load your library. It will retry on your next visit."]));
    answer = (url) => (url === "/api/v1/library" ? listOf([]) : new Response("x", { status: 503 }));
    await signIn([paper("doi:10.1/b", "B")]);
    await vi.waitFor(() => expect(notices).toEqual(["We could not move the papers saved on this device into your account. They are still here; try again later."]));
  });

  it("save and remove: PUT and DELETE by id; a full library (409) and any other failure have their own words, and the change is undone", async () => {
    answer = (url) => (url === "/api/v1/library" ? listOf([]) : new Response("{}", { status: 200 }));
    const lib = await signIn();
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    const p = paper("doi:10.1/c", "C");
    lib.toggleSaved(p);
    await vi.waitFor(() => expect(seen).toHaveLength(2));
    expect(seen[1]).toEqual({ url: `/api/v1/library/${encodeURIComponent("doi:10.1/c")}`, method: "PUT", headers: { "content-type": "application/json" }, body: p, credentials: "same-origin" });
    lib.toggleSaved(p);
    await vi.waitFor(() => expect(seen).toHaveLength(3));
    expect(seen[2]).toEqual({ url: `/api/v1/library/${encodeURIComponent("doi:10.1/c")}`, method: "DELETE", headers: {}, body: null, credentials: "same-origin" });
    answer = () => new Response(JSON.stringify({ type: "library_full", title: "x" }), { status: 409 });
    lib.toggleSaved(p);
    await vi.waitFor(() => expect(notices).toEqual(["Your library is full (2,000 papers)."]));
    expect(lib.useLibrary()).toEqual([]);
    answer = () => Promise.reject(new TypeError("Failed to fetch"));
    lib.toggleSaved(p);
    await vi.waitFor(() => expect(notices.at(-1)).toBe("That change could not be saved. Please check your connection and try again."));
    answer = () => new Response("x", { status: 500 });
    lib.toggleSaved(p);
    await vi.waitFor(() => expect(notices).toHaveLength(3));
    expect(notices.at(-1)).toBe("That change could not be saved. Please check your connection and try again.");
  });

  it("a notice seen: POST /alerts/seen with the papers (or none for all); a failure puts it back and says so", async () => {
    answer = (url) => (url === "/api/v1/library" ? listOf([]) : new Response("{}", { status: 200 }));
    const lib = await signIn();
    await vi.waitFor(() => expect(lib.useLibraryAlerts()).toHaveLength(1));
    answer = () => new Response("x", { status: 500 });
    lib.dismissAlerts();
    expect(lib.useLibraryAlerts()).toEqual([]);
    await vi.waitFor(() => expect(notices).toEqual(["That could not be saved. Please check your connection and try again."]));
    expect(seen[1]).toEqual({ url: "/api/v1/library/alerts/seen", method: "POST", headers: { "content-type": "application/json" }, body: {}, credentials: "same-origin" });
    expect(lib.useLibraryAlerts()).toHaveLength(1);
    answer = () => new Response("{}", { status: 200 });
    lib.dismissAlerts(["doi:10.1/a"]);
    await vi.waitFor(() => expect(seen).toHaveLength(3));
    expect(seen[2]!.body).toEqual({ paperIds: ["doi:10.1/a"] });
    expect(lib.useLibraryAlerts()).toEqual([]);
  });
});
