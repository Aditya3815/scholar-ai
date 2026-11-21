import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PRIVACY_VERSION } from "@scholar/shared";
import { testD1 } from "./test-d1";
import { sha256Hex } from "./hash";

/**
 * Every refusal the API writes by hand instead of through `deny()` (docs/design/untangle.md, F9): the status, the headers a refusal carries and the body, byte for byte, as each one
 * answers today. Written before those replies move onto `deny()`, so the move is checked to change nothing a browser or a script can see. Each case reaches its reply through the
 * Worker as it is mounted (or, for the live room and the idempotency keys, through the function that writes it), with the failures it needs stood in.
 */

vi.mock("cloudflare:workers", () => ({ DurableObject: class {}, WorkflowEntrypoint: class {}, WorkerEntrypoint: class {}, RpcTarget: class {} }));
vi.mock("cloudflare:workflows", () => ({ NonRetryableError: class extends Error {} }));

/** Which stand-in failure is on for the next request. */
const fail = vi.hoisted(() => ({ list: false, reapply: false, erase: false, mcp: false, judge: "" as "" | "quota" | "none" }));

vi.mock("./admin/integrity", async (orig) => {
  const real = await orig<typeof import("./admin/integrity")>();
  return { ...real, listFiles: async (...a: Parameters<typeof real.listFiles>) => (fail.list ? Promise.reject(new Error("storage down")) : real.listFiles(...a)) };
});
vi.mock("./account/erase", async (orig) => {
  const real = await orig<typeof import("./account/erase")>();
  return {
    ...real,
    reapplyDeletions: async (...a: Parameters<typeof real.reapplyDeletions>) => (fail.reapply ? Promise.reject(new Error("db down")) : real.reapplyDeletions(...a)),
    eraseAccount: async (...a: Parameters<typeof real.eraseAccount>) => (fail.erase ? Promise.reject(new Error("db down")) : real.eraseAccount(...a)),
  };
});
vi.mock("./mcp/calls", async (orig) => {
  const real = await orig<typeof import("./mcp/calls")>();
  return { ...real, readMcpAdmin: async (...a: Parameters<typeof real.readMcpAdmin>) => (fail.mcp ? Promise.reject(new Error("boom")) : real.readMcpAdmin(...a)) };
});
vi.mock("./chat/support", async (orig) => {
  const real = await orig<typeof import("./chat/support")>();
  return {
    ...real,
    judgeAnswer: async (o: Parameters<typeof real.judgeAnswer>[0]) => {
      if (fail.judge === "quota") await o.judge({ system: "", user: "" } as never, {} as never).catch(() => {});
      return fail.judge ? undefined : real.judgeAnswer(o);
    },
  };
});
vi.mock("./platform/llm/profiles", async (orig) => {
  const real = await orig<typeof import("./platform/llm/profiles")>();
  const { QuotaError } = await import("./platform/llm/policy");
  const modelFor = (...a: unknown[]): unknown => (fail.judge === "quota" ? async () => Promise.reject(new QuotaError("used up")) : (real.modelFor as (...x: unknown[]) => unknown)(...a));
  return { ...real, modelFor: modelFor as unknown as typeof real.modelFor };
});

const { default: worker } = await import("./index");
const { joinRoom } = await import("./docs/live");
const { runIdempotent } = await import("./idempotency");

const ORIGIN = "http://localhost";
const ME = "s".repeat(40);
const ADMIN = "a".repeat(40);
const DOC = "doc0000000000000000000001";

async function freshDb(): Promise<D1Database> {
  const { db, sql } = testD1();
  const user = (id: string, email: string, role: string) => sql.prepare("INSERT INTO users (id, email, role, privacy_ack) VALUES (?, ?, ?, ?)").run(id, email, role, PRIVACY_VERSION);
  user("u1", "u1@example.org", "scholar");
  user("a1", "a1@example.org", "admin");
  user("a2", "a2@example.org", "admin");
  for (const [token, id] of [[ME, "u1"], [ADMIN, "a1"]] as const) sql.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))").run(await sha256Hex(token), id);
  sql.prepare("INSERT INTO documents (id, user_id, title, filename, size_bytes, pages, status) VALUES (?, 'u1', 'A paper', 'a.pdf', 1000, 10, 'ready')").run(DOC);
  return db;
}

const kv = () => {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => void m.set(k, v), delete: async (k: string) => void m.delete(k), list: async () => ({ keys: [], list_complete: true }) };
};

const ctx = { waitUntil: (p: Promise<unknown>) => void Promise.resolve(p).catch(() => {}), passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext;

/** The reply as a browser sees it: status, the headers a refusal may carry, and the body as sent. The request id of a 500 is random, so it is read as <id>. */
async function seen(res: Response): Promise<string> {
  const head = ["content-type", "retry-after", "cache-control"].map((h) => (res.headers.get(h) ? `${h}: ${res.headers.get(h)}` : "")).filter(Boolean).join("; ");
  const body = (await res.text()).replace(/"requestId":"[^"]*"/, '"requestId":"<id>"');
  return `${res.status} [${head}] ${body}`;
}

let db: D1Database;
async function call(method: string, path: string, o: { as?: "me" | "admin"; body?: unknown; env?: Record<string, unknown>; limited?: boolean } = {}): Promise<string> {
  const headers: Record<string, string> = { "content-type": "application/json", origin: ORIGIN, "cf-connecting-ip": "203.0.113.5" };
  if (o.as) headers.cookie = `sid=${o.as === "me" ? ME : ADMIN}`;
  const limiter = { limit: async () => ({ success: !o.limited }) };
  const env = { DB: db, SEARCH_LIMITER: limiter, VERIFY_LIMITER: limiter, ASK_LIMITER: limiter, API_LIMITER: limiter, ENABLE_DEV_ROUTES: "1", QA_STUB: "1", ...o.env };
  const req = new Request(`${ORIGIN}${path}`, { method, headers, body: o.body === undefined ? (method === "GET" ? undefined : "{}") : typeof o.body === "string" ? o.body : JSON.stringify(o.body) });
  return seen(await worker.fetch!(req as never, env as never, ctx));
}

beforeAll(() => {
  vi.stubGlobal("fetch", async () => new Response("", { status: 503 }));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterAll(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
beforeEach(async () => {
  db = await freshDb();
  Object.assign(fail, { list: false, reapply: false, erase: false, mcp: false, judge: "" });
});

describe("the account's refusals", () => {
  it("an old privacy text, and a deletion without its confirmation", async () => {
    expect(await call("POST", "/api/v1/account/privacy-ack", { as: "me", body: { version: "old" } })).toMatchInlineSnapshot(`"400 [content-type: application/json; cache-control: no-store] {"type":"outdated","title":"That text has changed","detail":"Reload the page and read the current text."}"`);
    expect(await call("DELETE", "/api/v1/account", { as: "me", body: {} })).toMatchInlineSnapshot(`"400 [content-type: application/json; cache-control: no-store] {"type":"confirmation_required","title":"Send {\\"confirm\\":\\"DELETE\\"}"}"`);
  });
});

describe("the admin's refusals", () => {
  it("the integrity check and the re-applied deletions when storage fails", async () => {
    fail.list = true;
    expect(await call("GET", "/api/v1/admin/integrity", { as: "admin", env: { FILES: { list: async () => Promise.reject(new Error("down")) } } })).toMatchInlineSnapshot(`"502 [content-type: application/json; cache-control: no-store] {"type":"check_failed","title":"The check could not run","detail":"Storage or the database did not answer. Try again."}"`);
    fail.reapply = true;
    expect(await call("POST", "/api/v1/admin/reapply-deletions", { as: "admin" })).toMatchInlineSnapshot(`"502 [content-type: application/json; cache-control: no-store] {"type":"reapply_failed","title":"Deletions could not be re-applied","detail":"Storage or the database did not answer. Nothing was half done that a second run cannot finish."}"`);
  });

  it("erasing an account: no confirmation, no address, nobody, oneself, an admin, a failure part way", async () => {
    const erase = (body: unknown) => call("POST", "/api/v1/admin/erase-account", { as: "admin", body });
    expect(await erase({ account: "u1@example.org" })).toMatchInlineSnapshot(`"400 [content-type: application/json; cache-control: no-store] {"type":"confirmation_required","title":"Send {\\"account\\": ..., \\"confirm\\": \\"ERASE\\"}"}"`);
    expect(await erase({ account: "not an address", confirm: "ERASE" })).toMatchInlineSnapshot(`"400 [content-type: application/json; cache-control: no-store] {"type":"invalid_account","title":"Give an e-mail address or an ORCID iD","detail":"For example name@university.edu or 0000-0002-1825-0097."}"`);
    expect(await erase({ account: "nobody@example.org", confirm: "ERASE" })).toMatchInlineSnapshot(`"404 [content-type: application/json; cache-control: no-store] {"type":"no_account","title":"No account has that address","detail":"Nothing was erased. Check the spelling, or whether the person signed in with ORCID only."}"`);
    expect(await erase({ account: "a1@example.org", confirm: "ERASE" })).toMatchInlineSnapshot(`"409 [content-type: application/json; cache-control: no-store] {"type":"own_account","title":"That is your own account","detail":"Use Settings and data to delete your own account."}"`);
    expect(await erase({ account: "a2@example.org", confirm: "ERASE" })).toMatchInlineSnapshot(`"409 [content-type: application/json; cache-control: no-store] {"type":"admin_account","title":"That account is an admin","detail":"Remove the admin role first (docs/runbook.md), so that an admin cannot be erased by mistake."}"`);
    fail.erase = true;
    expect(await erase({ account: "u1@example.org", confirm: "ERASE" })).toMatchInlineSnapshot(`"502 [content-type: application/json; cache-control: no-store] {"type":"erase_failed","title":"The account could not be erased","detail":"Something went wrong part way. Running the same request again finishes it."}"`);
  });
});

describe("the strict check's refusals", () => {
  const body = { text: "Graphene conducts heat well [1].", papers: [{ n: 1, title: "A paper", year: 2024, abstract: "Graphene conducts heat well." }], citations: [{ n: 1, sentenceNo: 1 }] };
  it("switched off, the allowance used, and the check not done", async () => {
    expect(await call("POST", "/api/v1/chat/tighten", { as: "me", body, env: { CHAT_JUDGE: "off" } })).toMatchInlineSnapshot(`"503 [content-type: application/json; cache-control: no-store] {"type":"unavailable","title":"The strict check is switched off","detail":"Try again later."}"`);
    fail.judge = "quota";
    expect(await call("POST", "/api/v1/chat/tighten", { as: "me", body })).toMatchInlineSnapshot(`"429 [content-type: application/json; cache-control: no-store] {"type":"quota","title":"Today's AI allowance is used up","detail":"The strict check uses about 5,000 tokens. It resets at 00:00 UTC."}"`);
    fail.judge = "none";
    expect(await call("POST", "/api/v1/chat/tighten", { as: "me", body })).toMatchInlineSnapshot(`"503 [content-type: application/json; cache-control: no-store] {"type":"unavailable","title":"The strict check could not be done","detail":"Try again in a moment."}"`);
  });
});

describe("a paper's refusals", () => {
  it("a drawing saved over one from another window", async () => {
    expect(await call("PUT", `/api/v1/documents/${DOC}/ink`, { as: "me", body: { strokes: [], rev: 0 } })).toMatchInlineSnapshot(`"200 [content-type: application/json; cache-control: no-store] {"rev":1}"`);
    expect(await call("PUT", `/api/v1/documents/${DOC}/ink`, { as: "me", body: { strokes: [], rev: 0 } })).toMatchInlineSnapshot(`"409 [content-type: application/json; cache-control: no-store] {"type":"conflict","title":"This paper was drawn on in another window","strokes":[],"rev":1}"`);
  });

  it("the live room: not bound, full, not answering", async () => {
    const room = (status: number) => ({ getByName: () => ({ fetch: async () => new Response(null, { status }) }) });
    const join = async (ns: unknown) => {
      const app = new Hono();
      app.get("/", (c) => joinRoom(c as never, { docId: DOC, user: { id: "u1", name: "U" }, role: "owner" as never, via: "owner", memberId: null }));
      return seen(await app.request("/", {}, { DB: db, PAPER_ROOM: ns }));
    };
    expect(await join(undefined)).toMatchInlineSnapshot(`"503 [content-type: application/json] {"type":"unavailable","title":"Live updates are not available here"}"`);
    expect(await join(room(429))).toMatchInlineSnapshot(`"429 [content-type: application/json] {"type":"rate_limited","title":"This paper has as many people open as it can hold"}"`);
    expect(await join(room(500))).toMatchInlineSnapshot(`"503 [content-type: application/json] {"type":"unavailable","title":"Live updates are not available now"}"`);
  });
});

describe("the references' refusals", () => {
  it("no reference, and one too long", async () => {
    expect(await call("POST", "/api/v1/references/verify", { body: {} })).toMatchInlineSnapshot(`"400 [content-type: application/json] {"type":"invalid_reference","title":"Invalid reference","detail":"Send { reference: string }."}"`);
    expect(await call("POST", "/api/v1/references/verify", { body: { reference: "x".repeat(5_000) } })).toMatchInlineSnapshot(`"413 [content-type: application/json] {"type":"invalid_reference","title":"Reference too long","detail":"A single reference can be at most 1000 characters. Split the list into separate entries."}"`);
  });
});

describe("the app's own replies", () => {
  it("sign-in with a provider that does not exist, a path that names nothing, an error nobody caught, too many requests", async () => {
    expect(await call("GET", "/api/v1/auth/nobody/start")).toMatchInlineSnapshot(`"404 [content-type: application/json; cache-control: no-store] {"type":"not_found","title":"Unknown or unconfigured provider"}"`);
    expect(await call("GET", "/api/v1/nothing-here")).toMatchInlineSnapshot(`"404 [content-type: application/json] {"type":"not_found","title":"Not found","detail":"/api/v1/nothing-here"}"`);
    fail.mcp = true;
    expect(await call("GET", "/api/v1/admin/mcp", { as: "admin" })).toMatchInlineSnapshot(`"500 [content-type: application/json; cache-control: no-store] {"type":"internal_error","title":"Internal error","requestId":"<id>"}"`);
    expect(await call("GET", "/api/v1/library", { as: "me", limited: true })).toMatchInlineSnapshot(`"429 [content-type: application/json; retry-after: 60] {"type":"rate_limited","title":"Too many requests","detail":"Please wait a minute and try again."}"`);
  });
});

describe("the development routes' refusals", () => {
  it("each route's own words (the plain 404 in production; the LLM tool's error, whose type is the error's name, stays its own)", async () => {
    expect(await call("GET", "/api/v1/dev/last-invite", { env: { ENABLE_DEV_ROUTES: undefined } })).toMatchInlineSnapshot(`"404 [content-type: application/json] {"type":"not_found","title":"Not found"}"`);
    expect(await call("GET", "/api/v1/dev/last-invite?email=nobody@example.org")).toMatchInlineSnapshot(`"404 [content-type: application/json] {"type":"not_found","title":"No invitation"}"`);
    expect(await call("POST", "/api/v1/dev/sql", { body: { sql: [] } })).toMatchInlineSnapshot(`"400 [content-type: application/json] {"type":"invalid","title":"Send {sql: [statement, ...]}"}"`);
    expect(await call("POST", "/api/v1/dev/cache", { body: { op: "nothing" } })).toMatchInlineSnapshot(`"400 [content-type: application/json] {"type":"invalid","title":"Send {op: set|get|getMany, key, value, ttl, keys}"}"`);
    expect(await call("POST", "/api/v1/dev/kv", { body: { op: "get", key: "x" } })).toMatchInlineSnapshot(`"400 [content-type: application/json] {"type":"invalid","title":"No KV namespace is bound here"}"`);
    expect(await call("POST", "/api/v1/dev/kv", { body: { op: "nothing" }, env: { CACHE: kv() } })).toMatchInlineSnapshot(`"400 [content-type: application/json] {"type":"invalid","title":"Send {op: get|put|delete|list, key (a name starting trending:v1), value, ttl}"}"`);
    expect(await call("POST", "/api/v1/dev/gate", { body: { name: "nothing" } })).toMatchInlineSnapshot(`"400 [content-type: application/json] {"type":"invalid","title":"name must be a lane"}"`);
    expect(await call("POST", "/api/v1/dev/make-admin")).toMatchInlineSnapshot(`"401 [content-type: application/json] {"type":"unauthorized","title":"Sign in first"}"`);
  });
});

describe("an Idempotency-Key's refusals", () => {
  const store = (o: { claim?: boolean; seen?: { fingerprint: string; status: number | null; body: string | null } | null } = {}) => ({
    claim: async () => o.claim ?? false,
    get: async () => o.seen ?? null,
    takeOver: async () => false,
    finish: async () => {},
    release: async () => {},
  });
  const work = async () => new Response("{}", { status: 201 });
  it("a key that is not valid, one used for another request, and one still being handled", async () => {
    const run = (s: ReturnType<typeof store>, key: string | null) => runIdempotent(s as never, { userId: "u1", route: "upload" } as never, key, "f", 0, work).then(seen);
    expect(await run(store(), null)).toMatchInlineSnapshot(`"400 [content-type: application/json] {"type":"invalid_idempotency_key","title":"That Idempotency-Key is not valid","detail":"Use 16 to 100 letters, digits, dots, dashes or underscores, for example a random UUID."}"`);
    expect(await run(store({ seen: { fingerprint: "other", status: null, body: null } }), "k".repeat(20))).toMatchInlineSnapshot(`"422 [content-type: application/json] {"type":"idempotency_key_reused","title":"That key was used for a different request","detail":"Use a new Idempotency-Key for a new request."}"`);
    expect(await run(store({ seen: { fingerprint: "f", status: null, body: null } }), "k".repeat(20))).toMatchInlineSnapshot(`"409 [content-type: application/json; retry-after: 1] {"type":"idempotency_in_progress","title":"The first request is still being handled","detail":"Wait a moment and try again."}"`);
    expect(await run(store({ seen: null }), "k".repeat(20))).toMatchInlineSnapshot(`"409 [content-type: application/json; retry-after: 1] {"type":"idempotency_in_progress","title":"The first request is still being handled","detail":"Wait a moment and try again."}"`);
  });
});
