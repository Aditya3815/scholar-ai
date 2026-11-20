import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PRIVACY_VERSION, roleAtLeast, type ShareRole } from "@scholar/shared";
import { testD1 } from "../test-d1";
import { sha256Hex } from "../hash";

/**
 * The shared cells of the route-guard table (docs/design/paper-share.md, 6 and 9): with SHARE and READER on, every route of one paper, as the Worker mounts it, asked by each kind of
 * person. Each route states the role it needs (NEED, below, written from the plan: a route with no line fails, so a new one is looked at); the gate lets a person through exactly when
 * their role is at least that. "Through" means the answer is not one of the gate's refusals: a 401, the gate's 403 (forbidden, with one of its titles) or its 404 (the paper is not
 * theirs to see). What the route then says (200, 400 for an empty body, ...) is the route's own business.
 */

vi.mock("cloudflare:workers", () => ({ DurableObject: class {}, WorkflowEntrypoint: class {}, WorkerEntrypoint: class {}, RpcTarget: class {} }));
vi.mock("cloudflare:workflows", () => ({ NonRetryableError: class extends Error {} }));

const { default: worker } = await import("../index");
const { app } = await import("../app/mount");

const ORIGIN = "http://localhost";
const DOC = "d0000000000000000000000a";
const NOTE = "n0000000000000000000000a";
const LINK = "L".repeat(43);

/** The role each route needs. */
const NEED: Record<string, ShareRole> = {
  "GET /api/v1/documents/:id": "viewer",
  "GET /api/v1/documents/:id/file": "viewer",
  "GET /api/v1/documents/:id/cover": "viewer",
  "GET /api/v1/documents/:id/notes": "viewer",
  "GET /api/v1/documents/:id/ink": "viewer",
  "GET /api/v1/documents/:id/notebook": "viewer",
  "GET /api/v1/share/papers/:id/comments": "viewer",
  "POST /api/v1/documents/:id/ask": "commenter",
  "POST /api/v1/documents/:id/ask-highlights": "commenter",
  "POST /api/v1/share/papers/:id/comments": "commenter",
  "PATCH /api/v1/share/papers/:id/comments/:cid": "commenter",
  "DELETE /api/v1/share/papers/:id/comments/:cid": "commenter",
  "POST /api/v1/documents/:id/notes": "editor",
  "PATCH /api/v1/documents/:id/notes/:nid": "editor",
  "DELETE /api/v1/documents/:id/notes/:nid": "editor",
  "PUT /api/v1/documents/:id/notebook/pages/:pageId": "editor",
  "PUT /api/v1/documents/:id/notebook/pages/:pageId/ink": "editor",
  "PATCH /api/v1/documents/:id/notebook/pages/:pageId": "editor",
  "DELETE /api/v1/documents/:id/notebook/pages/:pageId": "editor",
  "GET /api/v1/documents/:id/notebook/images/:blockId": "viewer",
  "PUT /api/v1/documents/:id/notebook/images/:blockId": "editor",
  "PATCH /api/v1/documents/:id": "owner",
  "DELETE /api/v1/documents/:id": "owner",
  "PUT /api/v1/documents/:id/cover": "owner",
  "PUT /api/v1/documents/:id/info": "owner",
  "PUT /api/v1/documents/:id/meta": "owner",
  "PUT /api/v1/documents/:id/ink": "owner",
  "POST /api/v1/documents/:id/progress": "owner",
  "POST /api/v1/documents/:id/pages": "owner",
  "POST /api/v1/documents/:id/finish": "owner",
  "POST /api/v1/documents/:id/scan": "owner",
  "GET /api/v1/documents/:id/scan": "owner",
  "GET /api/v1/documents/:id/scan/text": "owner",
  "POST /api/v1/documents/:id/ocr": "owner",
  "GET /api/v1/share/papers/:id": "owner",
  "PUT /api/v1/share/papers/:id": "owner",
  "DELETE /api/v1/share/papers/:id": "owner",
  "POST /api/v1/share/papers/:id/link": "owner",
  "POST /api/v1/share/papers/:id/members": "owner",
  "PATCH /api/v1/share/papers/:id/members/:mid": "owner",
  "DELETE /api/v1/share/papers/:id/members/:mid": "owner",
  "POST /api/v1/share/papers/:id/members/:mid/resend": "owner",
};

type Who = { name: string; role: ShareRole | null; session?: string; link?: true };
const WHO: Who[] = [
  { name: "owner", role: "owner", session: "s-owner" },
  { name: "editor (named)", role: "editor", session: "s-ed" },
  { name: "commenter (named)", role: "commenter", session: "s-co" },
  { name: "viewer (named)", role: "viewer", session: "s-vi" },
  { name: "signed in with the Commenter link", role: "commenter", session: "s-st", link: true },
  { name: "not signed in, with the Commenter link", role: "viewer", link: true },
  { name: "signed in, not named, no link", role: null, session: "s-st" },
  { name: "not signed in, no link", role: null },
];

async function freshDb(): Promise<D1Database> {
  const { db, sql } = testD1();
  const users: [string, string, string][] = [["owner", "owner@example.org", "s-owner"], ["ed", "ed@example.org", "s-ed"], ["co", "co@example.org", "s-co"], ["vi", "vi@example.org", "s-vi"], ["st", "st@example.org", "s-st"]];
  for (const [id, email, session] of users) {
    sql.prepare("INSERT INTO users (id, email, email_verified, name, role, privacy_ack) VALUES (?, ?, 1, ?, 'scholar', ?)").run(id, email, id, PRIVACY_VERSION);
    sql.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))").run(await sha256Hex(session.padEnd(40, "x")), id);
  }
  sql.prepare("INSERT INTO documents (id, user_id, title, filename, size_bytes, pages, status, has_cover, scanned) VALUES (?, 'owner', 'A paper', 'a.pdf', 1000, 10, 'ready', 1, 1)").run(DOC);
  sql.prepare("INSERT INTO doc_notes (id, doc_id, page, quote) VALUES (?, ?, 1, 'a quote of some length')").run(NOTE, DOC);
  sql.prepare(`INSERT INTO doc_notebook_pages (doc_id, id, title, position, blocks) VALUES (?, 'p1', 'Notes', 1, '[{"id":"b1","kind":"text","md":"hello"}]')`).run(DOC);
  for (const [id, email, user, role] of [["m-ed", "ed@example.org", "ed", "editor"], ["m-co", "co@example.org", "co", "commenter"], ["m-vi", "vi@example.org", "vi", "viewer"]]) {
    sql.prepare("INSERT INTO doc_members (doc_id, email, id, user_id, role) VALUES (?, ?, ?, ?, ?)").run(DOC, email, id, user, role);
  }
  sql.prepare("INSERT INTO doc_shares (doc_id, link_mode, link_role, token_hash, expires_at) VALUES (?, 'anyone', 'commenter', ?, datetime('now', '+1 day'))").run(DOC, await sha256Hex(LINK));
  // every comment is the commenter's, so its author may change it
  sql.prepare("INSERT INTO doc_comments (id, doc_id, anchor, user_id, body) VALUES ('c1', ?, ?, 'co', 'a comment')").run(DOC, `note:${NOTE}`);
  return db;
}

function fakeFiles() {
  const pdf = new TextEncoder().encode("%PDF-1.4 a paper");
  const cover = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  return {
    get: async (k: string) => (k.endsWith(".pdf") ? { body: new Blob([pdf]).stream(), size: pdf.byteLength } : k.endsWith(".cover.jpg") ? { body: new Blob([cover]).stream(), size: cover.byteLength } : null),
    head: async () => null,
    put: async () => {},
    delete: async () => {},
  };
}

const limiter = { limit: async () => ({ success: true }) };
const env = (db: D1Database) => ({ DB: db, FILES: fakeFiles(), SHARE: "on", READER: "on", ENABLE_DEV_ROUTES: "1", QA_STUB: "1", SEARCH_LIMITER: limiter, VERIFY_LIMITER: limiter, ASK_LIMITER: limiter, API_LIMITER: limiter });
const ctx = { waitUntil: (p: Promise<unknown>) => void Promise.resolve(p).catch(() => {}), passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext;

const pathOf = (route: string) => route.replace(":id", DOC).replace(":nid", NOTE).replace(":pageId", "p1").replace(":mid", "m-vi").replace(":cid", "c1").replace(":blockId", "b1");
const bodyOf = (route: string) =>
  route.endsWith("/comments") ? { anchor: `note:${NOTE}`, body: "a word" } : route.endsWith("/members") ? { email: "new@example.org", role: "viewer" } : route.includes("/comments/") ? { body: "edited" } : route.includes("/members/") ? { role: "commenter" } : {};

const GATE_403 = new Set(["You cannot open this paper", "Your access to this paper is to view it", "Your access to this paper does not let you change it", "Only the paper's owner can do this"]);
async function ask(method: string, route: string, who: Who, body?: unknown): Promise<{ status: number; through: boolean; said: string }> {
  const headers: Record<string, string> = { "content-type": "application/json", origin: ORIGIN, "cf-connecting-ip": "203.0.113.9" };
  const cookies: string[] = [];
  if (who.session) cookies.push(`sid=${who.session.padEnd(40, "x")}`);
  if (who.link) cookies.push(`shr_${DOC}=${LINK}`);
  if (cookies.length) headers.cookie = cookies.join("; ");
  const sent = method === "GET" ? undefined : JSON.stringify(body ?? bodyOf(route));
  const res = await worker.fetch!(new Request(`${ORIGIN}${pathOf(route)}`, { method, headers, body: sent }) as never, env(await freshDb()) as never, ctx);
  const text = res.headers.get("content-type")?.includes("json") ? await res.text() : (await res.body?.cancel().catch(() => {}), "");
  let j: { type?: string; title?: string } = {};
  try {
    j = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  const refused = res.status === 401 || (res.status === 403 && j.type === "forbidden" && GATE_403.has(j.title ?? "")) || (res.status === 404 && ["Paper not found", "Not found", "No cover"].includes(j.title ?? ""));
  return { status: res.status, through: !refused, said: `${res.status} ${j.type ?? ""}: ${j.title ?? ""}` };
}

const paperRoutes = (): string[] =>
  [...new Set(app.routes.filter((r) => r.method !== "ALL" && (r.path.startsWith("/api/v1/documents/:id") || r.path.startsWith("/api/v1/share/papers/:id"))).map((r) => `${r.method} ${r.path}`))].sort();

/**
 * The agents of the Paper Reader (docs/design/paper-reader.md, 24) are modes of the two question routes: Explain and Critique need what a question needs (Commenter: on the asker's own allowance,
 * never kept in the owner's history), the Note-taker writes the notes and needs an Editor. A body for each, so the route reaches its own role check.
 */
const MODES: { name: string; route: string; body: unknown; need: ShareRole }[] = [
  { name: "Explain", route: "/api/v1/documents/:id/ask", body: { mode: "explain", question: "what is a quote" }, need: "commenter" },
  { name: "Critique", route: "/api/v1/documents/:id/ask", body: { mode: "critique" }, need: "commenter" },
  { name: "Note-taker", route: "/api/v1/documents/:id/ask-highlights", body: { mode: "notes" }, need: "editor" },
];
const modeResults: Record<string, Record<string, { status: number; through: boolean; said: string }>> = {};
const results: Record<string, Record<string, { status: number; through: boolean; said: string }>> = {};
beforeAll(async () => {
  vi.stubGlobal("fetch", async () => new Response("", { status: 503 }));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  for (const key of paperRoutes()) {
    const [method, route] = key.split(" ") as [string, string];
    results[key] = {};
    for (const who of WHO) results[key]![who.name] = await ask(method, route, who);
  }
  for (const m of MODES) {
    modeResults[m.name] = {};
    for (const who of WHO) modeResults[m.name]![who.name] = await ask("POST", m.route, who, m.body);
  }
}, 600_000);
afterAll(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("every paper route, asked by each kind of person, with SHARE and READER on", () => {
  it("states the role it needs (a new route gets a line here, and is looked at)", () => {
    expect(paperRoutes().filter((k) => !(k in NEED))).toEqual([]);
    expect(Object.keys(NEED).filter((k) => !paperRoutes().includes(k))).toEqual([]);
  });

  it("lets a person through exactly when their role is at least the one it needs", () => {
    const wrong: string[] = [];
    for (const [key, row] of Object.entries(results)) {
      for (const who of WHO) {
        const want = roleAtLeast(who.role, NEED[key]!);
        const got = row[who.name]!;
        if (got.through !== want) wrong.push(`${key} for ${who.name}: ${want ? "should pass" : "should be refused"}, got ${got.said}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("refuses with the right words: 401 to nobody signed in without a link, 404 to a stranger, 403 to a lower role", () => {
    for (const [key, row] of Object.entries(results)) {
      expect(row["not signed in, no link"]!.status, key).toBe(401);
      expect(row["signed in, not named, no link"]!.status, key).toBe(404);
      if (NEED[key] === "owner") expect(row["editor (named)"]!.said, key).toBe("403 forbidden: Only the paper's owner can do this");
      if (NEED[key] === "editor") expect(row["commenter (named)"]!.said, key).toBe("403 forbidden: Your access to this paper does not let you change it");
      if (NEED[key] === "commenter") expect(row["viewer (named)"]!.said, key).toBe("403 forbidden: Your access to this paper is to view it");
    }
  });

  it("the agents: Explain and Critique for a Commenter and up, the Note-taker for an Editor and up; a Viewer has none", () => {
    const wrong: string[] = [];
    for (const m of MODES) {
      for (const who of WHO) {
        const got = modeResults[m.name]![who.name]!;
        const want = roleAtLeast(who.role, m.need);
        // the Note-taker's own refusal is the gate's words for a lower role
        const refused = !got.through || (got.status === 403 && got.said === "403 forbidden: Your access to this paper does not let you change it");
        if (refused === want) wrong.push(`${m.name} for ${who.name}: ${want ? "should pass" : "should be refused"}, got ${got.said}`);
      }
    }
    expect(wrong).toEqual([]);
    expect(modeResults["Note-taker"]!["commenter (named)"]!.said).toBe("403 forbidden: Your access to this paper does not let you change it");
    expect(modeResults["Explain"]!["viewer (named)"]!.said).toBe("403 forbidden: Your access to this paper is to view it");
    // they answer (the stand-in model): Explain's idea and the Note-taker's draft from the one highlight
    expect(modeResults["Explain"]!["commenter (named)"]!.status).toBe(200);
    expect(modeResults["Critique"]!["editor (named)"]!.status).toBe(200);
    expect(modeResults["Note-taker"]!["editor (named)"]!.status).toBe(200);
  });

  it("someone the paper is shared with gets the paper without the owner's questions, place, tags or drawing", async () => {
    expect(results["GET /api/v1/documents/:id"]!["viewer (named)"]!.status).toBe(200);
    expect(results["GET /api/v1/documents/:id/ink"]!["editor (named)"]!.status).toBe(200);
  });
});
