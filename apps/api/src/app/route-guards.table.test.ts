import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PRIVACY_VERSION } from "@scholar/shared";
import { testD1 } from "../test-d1";
import { sha256Hex } from "../hash";

/**
 * The route-guard table (untangle F10): what every route of the API, as the Worker mounts it, answers to the requests a guard is there for. It was written from the code BEFORE the guards
 * moved into middleware (route-guards.table.json), and the same requests are made again here: a guard that is lost, added or moved shows as a changed cell.
 *
 * The routes are not listed by hand: they are walked from the mounted app (`app.routes`), so a new route has no row and fails until its row is added (and looked at).
 * Each route gets, on a database of its own for each request (a request may delete or change what the next one needs):
 *   cross     a request from another origin, nobody signed in, the production settings;
 *   crossDev  the same with ENABLE_DEV_ROUTES=1 (a development route answers 404 before anything else when it is not set);
 *   anon      from our own origin, nobody signed in (development settings, so a development route is reached);
 *   noAck     signed in, the privacy note NOT read, the rows named in the path are the person's;
 *   notOwned  signed in, the note read, the rows named in the path do not exist;
 *   big       (writes only) signed in, the note read, the rows the person's, a 2,000,000-byte body with its Content-Length;
 *   chunked   (writes only) the same body sent without a length, as a stream;
 *   bucket    which per-minute limiter the request was counted against (anon).
 * A cell is the status, the problem's type, title and detail for a refusal, "(empty)" for no body, "(stream)" for an event stream, and "[no-store]" when the answer says no-store.
 * Nothing reaches the network: fetch answers 503 to everything.
 */

vi.mock("cloudflare:workers", () => ({ DurableObject: class {}, WorkflowEntrypoint: class {}, WorkerEntrypoint: class {}, RpcTarget: class {} }));
vi.mock("cloudflare:workflows", () => ({ NonRetryableError: class extends Error {} }));

const { default: worker } = await import("../index");
const { app } = await import("./mount");

const TABLE_FILE = fileURLToPath(new URL("./route-guards.table.json", import.meta.url));
const ORIGIN = "http://localhost";
const TOKEN = "s".repeat(40);
const USER = "u1";
const DOC = "doc0000000000000000000001";
const NOTE = "note000000000000000000001";
const SCAN = "11111111-2222-4333-8444-555555555555";
const NO_SCAN = "00000000-0000-4000-8000-000000000000";
const BIG = 2_000_000;

type Probe = "cross" | "crossDev" | "anon" | "noAck" | "notOwned" | "big" | "chunked";
type Row = Partial<Record<Probe | "bucket", string>>;
const LIMITERS = ["SEARCH_LIMITER", "VERIFY_LIMITER", "ASK_LIMITER", "API_LIMITER"] as const;

async function freshDb(ack: boolean): Promise<D1Database> {
  const { db, sql } = testD1();
  sql.prepare("INSERT INTO users (id, email, role, privacy_ack) VALUES (?, ?, 'scholar', ?)").run(USER, "u1@example.org", ack ? PRIVACY_VERSION : null);
  sql.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))").run(await sha256Hex(TOKEN), USER);
  sql.prepare("INSERT INTO documents (id, user_id, title, filename, size_bytes, pages, status) VALUES (?, ?, 'A paper', 'a.pdf', 1000, 10, 'ready')").run(DOC, USER);
  sql.prepare("INSERT INTO doc_notes (id, doc_id, page, quote) VALUES (?, ?, 1, 'a quote of some length')").run(NOTE, DOC);
  sql.prepare("INSERT INTO litscans (id, user_id, topic, language, plan, state, est_tokens, expires_at) VALUES (?, ?, 'a topic', 'en', '[]', 'completed', 1, datetime('now', '+1 day'))").run(SCAN, USER);
  return db;
}

function fakeFiles() {
  const files = new Map<string, Uint8Array>();
  return {
    get: async (k: string) => (files.has(k) ? { body: new Blob([files.get(k)!]).stream(), size: files.get(k)!.byteLength } : null),
    head: async (k: string) => (files.has(k) ? { size: files.get(k)!.byteLength } : null),
    put: async (k: string, v: unknown) => void files.set(k, typeof v === "string" ? new TextEncoder().encode(v) : new Uint8Array(v as ArrayBuffer)),
    delete: async (k: string | string[]) => void (Array.isArray(k) ? k : [k]).forEach((x) => files.delete(x)),
    // a paper's deletion lists the pictures of its notes (phase 2.5)
    list: async (o: { prefix?: string }) => ({ objects: [...files.keys()].filter((k) => k.startsWith(o.prefix ?? "")).map((key) => ({ key, size: files.get(key)!.byteLength })), truncated: false }),
  };
}

function envFor(db: D1Database, dev: boolean, counted: string[]) {
  const limiter = (name: string) => ({ limit: async () => (counted.push(name), { success: true }) });
  return {
    DB: db,
    FILES: fakeFiles(),
    SENTRY_DSN: "https://public@o1.ingest.example/1",
    ...Object.fromEntries(LIMITERS.map((n) => [n, limiter(n)])),
    ...(dev ? { ENABLE_DEV_ROUTES: "1", QA_STUB: "1" } : {}),
  };
}

/** The path with its parameters filled: the rows the test made (`own`), or ids that name nothing (`none`). */
function pathOf(route: string, ids: "own" | "none"): string {
  const docs = route.startsWith("/api/v1/documents");
  const scans = route.startsWith("/api/v1/litscan");
  return route
    .replace(":nid", ids === "own" ? NOTE : "note-none")
    .replace(":id", docs ? (ids === "own" ? DOC : "doc-none") : scans ? (ids === "own" ? SCAN : NO_SCAN) : "x1")
    .replace(":token", "t".repeat(32))
    .replace(":provider", "nobody");
}

async function cell(res: Response): Promise<string> {
  const type = res.headers.get("content-type") ?? "";
  let out = String(res.status);
  if (type.includes("event-stream")) {
    await res.body?.cancel().catch(() => {});
    out += " (stream)";
  } else {
    const text = await res.text();
    if (!text) out += " (empty)";
    else if (type.includes("json")) {
      try {
        const j = JSON.parse(text) as { type?: unknown; title?: unknown; detail?: unknown };
        if (res.status >= 400 && j && typeof j === "object" && "type" in j) out += ` ${String(j.type)}: ${String(j.title)}${j.detail ? ` (${String(j.detail)})` : ""}`;
      } catch {
        out += " (not JSON)";
      }
    } else out += ` (${type.split(";")[0]})`;
  }
  if (res.headers.get("cache-control") === "no-store") out += " [no-store]";
  return out;
}

const ctx = { waitUntil: (p: Promise<unknown>) => void Promise.resolve(p).catch(() => {}), passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext;

async function request(method: string, path: string, o: { origin?: string; signedIn?: boolean; ack?: boolean; dev?: boolean; body?: "small" | "big" | "chunked" }): Promise<{ cell: string; bucket: string }> {
  const db = await freshDb(o.ack ?? false);
  const counted: string[] = [];
  const headers: Record<string, string> = { "content-type": "application/json", "cf-connecting-ip": "203.0.113.5" };
  if (o.origin) headers.origin = o.origin;
  if (o.signedIn) headers.cookie = `sid=${TOKEN}`;
  let body: BodyInit | undefined;
  if (method !== "GET" && method !== "HEAD") {
    if (o.body === "big") {
      body = "x".repeat(BIG);
      headers["content-length"] = String(BIG);
    }
    else if (o.body === "chunked") {
      const part = new TextEncoder().encode("x".repeat(BIG / 20));
      body = new ReadableStream({ start(ctl) { for (let i = 0; i < 20; i++) ctl.enqueue(part); ctl.close(); } });
    } else body = "{}";
  }
  const req = new Request(`${ORIGIN}${path}`, { method, headers, body, ...(o.body === "chunked" ? { duplex: "half" } : {}) } as RequestInit);
  const res = await worker.fetch!(req as never, envFor(db, o.dev ?? false, counted) as never, ctx);
  return { cell: await cell(res), bucket: counted.join(",") || "(none)" };
}

async function rowOf(method: string, route: string): Promise<Row> {
  const write = method !== "GET";
  const row: Row = {};
  row.cross = (await request(method, pathOf(route, "own"), { origin: "https://evil.example" })).cell;
  row.crossDev = (await request(method, pathOf(route, "own"), { origin: "https://evil.example", dev: true })).cell;
  const anon = await request(method, pathOf(route, "own"), { origin: ORIGIN, dev: true });
  row.anon = anon.cell;
  row.noAck = (await request(method, pathOf(route, "own"), { origin: ORIGIN, dev: true, signedIn: true })).cell;
  row.notOwned = (await request(method, pathOf(route, "none"), { origin: ORIGIN, dev: true, signedIn: true, ack: true })).cell;
  if (write) {
    row.big = (await request(method, pathOf(route, "own"), { origin: ORIGIN, dev: true, signedIn: true, ack: true, body: "big" })).cell;
    row.chunked = (await request(method, pathOf(route, "own"), { origin: ORIGIN, dev: true, signedIn: true, ack: true, body: "chunked" })).cell;
  }
  row.bucket = anon.bucket;
  return row;
}

/** Requests that name no route: they stay 404s whatever their origin (a guard must not answer for a route that does not exist). */
const NO_ROUTE: [string, string][] = [
  ["POST", "/api/v1/nothing-here"],
  ["POST", `/api/v1/documents/${DOC}/no/such/thing`],
  ["DELETE", "/api/v1/chat"],
  ["POST", "/api/v1/chat/"],
  ["OPTIONS", "/api/v1/chat"],
  ["PUT", "/api/v1/search"],
];

/** Every route of the mounted app, as "METHOD /path". */
const mountedRoutes = (): string[] => [...new Set(app.routes.filter((r) => r.method !== "ALL").map((r) => `${r.method} ${r.path}`))].sort();

let table: Record<string, Row>;
let computed: Record<string, Row>;

beforeAll(async () => {
  vi.stubGlobal("fetch", async () => new Response("", { status: 503 }));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  table = JSON.parse(readFileSync(TABLE_FILE, "utf8")) as Record<string, Row>;
  computed = {};
  for (const key of mountedRoutes()) {
    const [method, route] = key.split(" ") as [string, string];
    computed[key] = await rowOf(method, route);
  }
  for (const [method, path] of NO_ROUTE) {
    const cross = await request(method, path, { origin: "https://evil.example" });
    computed[`no route: ${method} ${path}`] = { cross: cross.cell, crossDev: (await request(method, path, { origin: "https://evil.example", dev: true })).cell, bucket: cross.bucket };
  }
}, 600_000);

afterAll(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the route-guard table (untangle F10)", () => {
  it("has a row for every mounted route and no row for a route that is gone", () => {
    const routes = Object.keys(computed).filter((k) => !k.startsWith("no route: "));
    expect(routes.length).toBeGreaterThan(80);
    const rows = Object.keys(table).filter((k) => !k.startsWith("no route: "));
    expect(routes.filter((k) => !(k in table)), "routes with no row: add the row, and read what it says").toEqual([]);
    expect(rows.filter((k) => !routes.includes(k)), "rows of routes that are gone: take them off").toEqual([]);
  });

  it("answers every route as the table says", () => {
    for (const key of Object.keys(table)) expect(computed[key], key).toEqual(table[key]);
  });
});
