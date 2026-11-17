import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { NOTEBOOK_LIMITS } from "@scholar/shared";
import { testD1 } from "../test-d1";
import { createSession } from "../auth/session";
import type { HonoEnv } from "../platform/env";
import { deleteDocument, documentRoutes } from "./routes";
import { sameOriginWrites } from "../platform/http/guards";

/**
 * The Notebook's four routes (docs/design/paper-reader.md, 19.3) on a real SQLite with every migration, through the documents router as the Worker mounts it: who may ask (READER off,
 * dark and on; signed in; their own paper; same origin), create, replace, a stale revision, the last-write-wins PATCH, every limit, a bad block, delete and Undo, and the rows going with the paper.
 */

const BASE = "http://localhost";
async function setup(vars: Record<string, string> = { READER: "on" }) {
  const { db, sql } = testD1();
  sql.prepare("INSERT INTO users (id, email) VALUES ('u-1', 'a@example.org'), ('u-2', 'b@example.org')").run();
  sql.prepare("INSERT INTO documents (id, user_id, title, filename, size_bytes, pages, status) VALUES ('d1', 'u-1', 'Paper', 'p.pdf', 10, 3, 'ready'), ('d2', 'u-2', 'Theirs', 't.pdf', 10, 3, 'ready')").run();
  const app = new Hono<HonoEnv>();
  // the origin check is the app's, for every write (app/mount.ts), not the router's
  app.use("/api/*", sameOriginWrites({ skip: {}, devFirst: [] }));
  app.route("/api/v1/documents", documentRoutes);
  const env = { DB: db, ...vars } as unknown as HonoEnv["Bindings"];
  const tokens = { "u-1": await createSession(db, "u-1", undefined), "u-2": await createSession(db, "u-2", undefined) };
  const call = async (method: string, path: string, opts: { body?: unknown; raw?: string; as?: "u-1" | "u-2" | null; origin?: string | null } = {}) => {
    const who = opts.as === undefined ? "u-1" : opts.as;
    const headers: Record<string, string> = {};
    if (who) headers.cookie = `sid=${tokens[who]}`;
    const origin = opts.origin === undefined ? BASE : opts.origin;
    if (origin) headers.origin = origin;
    const body = opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body));
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await app.request(`${BASE}/api/v1/documents${path}`, { method, headers, body }, env);
    const text = await res.text();
    return { status: res.status, json: text ? (JSON.parse(text) as Record<string, any>) : null };
  };
  return { call, sql, db };
}

const text = (id: string, md = "words") => ({ id, kind: "text", md });
const quote = (id: string, over: Record<string, unknown> = {}) => ({ id, kind: "quote", noteId: "n1", page: 2, quote: "a passage", color: "yellow", ...over });
const PAGE = "/d1/notebook/pages";

describe("who may use the Notebook's routes", () => {
  it("READER off (unset, off, or anything else): every route is 404 for everyone, signed in or not, as before it existed", async () => {
    for (const vars of [{}, { READER: "off" }, { READER: "shadow" }, { READER: "yes" }] as Record<string, string>[]) {
      const { call } = await setup(vars);
      expect((await call("GET", "/d1/notebook")).status).toBe(404);
      expect((await call("GET", "/d1/notebook", { as: null })).status).toBe(404);
      expect((await call("PUT", `${PAGE}/p1`, { body: { blocks: [] } })).status).toBe(404);
      expect((await call("PATCH", `${PAGE}/p1`, { body: { title: "x" } })).status).toBe(404);
      // a write from no page of ours is refused by the app's origin check (app/mount.ts) before any route is asked, as every other write is
      expect((await call("DELETE", `${PAGE}/p1`, { origin: null })).status).toBe(403);
    }
  });

  it("dark: only the accounts of READER_BETA_USERS; on: everyone", async () => {
    const dark = await setup({ READER: "dark", READER_BETA_USERS: "u-2" });
    expect((await dark.call("GET", "/d1/notebook")).status).toBe(404);
    expect((await dark.call("GET", "/d2/notebook", { as: "u-2" })).status).toBe(200);
    const on = await setup();
    expect((await on.call("GET", "/d1/notebook")).json).toEqual({ pages: [] });
  });

  it("signed in, from our own pages, and only on one's own paper", async () => {
    const { call } = await setup();
    expect((await call("GET", "/d1/notebook", { as: null })).status).toBe(401);
    expect((await call("PUT", `${PAGE}/p1`, { body: { blocks: [] }, origin: "http://evil.example" })).status).toBe(403);
    expect((await call("PUT", `${PAGE}/p1`, { body: { blocks: [] }, origin: null })).status).toBe(403);
    expect((await call("GET", "/d2/notebook")).status).toBe(404);
    expect((await call("PUT", "/d2/notebook/pages/p1", { body: { blocks: [] } })).status).toBe(404);
    expect((await call("GET", "/nope/notebook")).status).toBe(404);
    // a page of someone else's paper cannot be read, changed or deleted through one's own paper either
    expect((await call("PUT", "/d2/notebook/pages/theirs", { body: { blocks: [] }, as: "u-2" })).status).toBe(201);
    expect((await call("PATCH", `${PAGE}/theirs`, { body: { title: "mine" } })).status).toBe(404);
    expect((await call("DELETE", `${PAGE}/theirs`)).status).toBe(404);
    expect((await call("GET", "/d1/notebook")).json).toEqual({ pages: [] });
  });
});

describe("a page: made, replaced, a stale revision, renamed, deleted and brought back", () => {
  it("PUT with no revision makes the page (201), cleaned, at the end; GET lists the pages in order", async () => {
    const { call } = await setup();
    const a = await call("PUT", `${PAGE}/p1`, { body: { title: "  Methods \n notes ", style: "ruled", blocks: [text("t1", "# Hi\r\nthere"), quote("q1", { quote: " a \n passage " })] } });
    expect(a.status).toBe(201);
    expect(a.json!.page).toMatchObject({ id: "p1", title: "Methods notes", style: "ruled", position: 1, rev: 1, blocks: [{ id: "t1", kind: "text", md: "# Hi\nthere" }, { id: "q1", quote: "a passage" }] });
    expect(typeof a.json!.page.updatedAt).toBe("number");
    const b = await call("PUT", `${PAGE}/p2`, { body: { rev: 0, blocks: [] } });
    expect(b.json!.page).toMatchObject({ title: "", style: "plain", position: 2, rev: 1 });
    await call("PUT", `${PAGE}/p0`, { body: { blocks: [], position: 0.5 } });
    expect((await call("GET", "/d1/notebook")).json!.pages.map((p: { id: string }) => p.id)).toEqual(["p0", "p1", "p2"]);
  });

  it("PUT with the revision it started from replaces the blocks only (the title is PATCH's), and the revision moves on", async () => {
    const { call } = await setup();
    await call("PUT", `${PAGE}/p1`, { body: { title: "Kept", blocks: [text("t1")] } });
    const r = await call("PUT", `${PAGE}/p1`, { body: { rev: 1, title: "Ignored", blocks: [text("t1", "changed"), text("t2")] } });
    expect(r.status).toBe(200);
    expect(r.json!.page).toMatchObject({ title: "Kept", rev: 2, blocks: [{ md: "changed" }, { id: "t2" }] });
  });

  it("a stale revision gets 409 with the server's page, and nothing changes; making a page that is there already does too", async () => {
    const { call } = await setup();
    await call("PUT", `${PAGE}/p1`, { body: { blocks: [text("t1")] } });
    await call("PUT", `${PAGE}/p1`, { body: { rev: 1, blocks: [text("t1", "from window A")] } });
    const stale = await call("PUT", `${PAGE}/p1`, { body: { rev: 1, blocks: [text("t1", "from window B")] } });
    expect(stale.status).toBe(409);
    expect(stale.json).toMatchObject({ type: "conflict", page: { rev: 2, blocks: [{ md: "from window A" }] } });
    const again = await call("PUT", `${PAGE}/p1`, { body: { blocks: [text("x")] } });
    expect(again.status).toBe(409);
    expect(again.json!.page.rev).toBe(2);
    expect((await call("GET", "/d1/notebook")).json!.pages[0].blocks[0].md).toBe("from window A");
  });

  it("PATCH needs no revision: title, style and place, last write wins, and the blocks' revision does not move", async () => {
    const { call } = await setup();
    await call("PUT", `${PAGE}/p1`, { body: { blocks: [text("t1")] } });
    const r = await call("PATCH", `${PAGE}/p1`, { body: { title: "Results", style: "grid", position: 7.25 } });
    expect(r.status).toBe(200);
    expect(r.json!.page).toMatchObject({ title: "Results", style: "grid", position: 7.25, rev: 1 });
    // typing in another window that started from rev 1 is not refused because of the rename
    expect((await call("PUT", `${PAGE}/p1`, { body: { rev: 1, blocks: [text("t1", "typed")] } })).status).toBe(200);
    expect((await call("PATCH", `${PAGE}/p1`, { body: { style: "lined" } })).status).toBe(400);
    expect((await call("PATCH", `${PAGE}/p1`, { body: { position: "1" } })).status).toBe(400);
    expect((await call("PATCH", `${PAGE}/p1`, { body: { title: 5 } })).status).toBe(400);
    expect((await call("PATCH", `${PAGE}/p1`, { body: {} })).status).toBe(400);
    expect((await call("PATCH", `${PAGE}/p1`, { raw: "not json" })).status).toBe(400);
    expect((await call("PATCH", `${PAGE}/missing`, { body: { title: "x" } })).status).toBe(404);
  });

  it("DELETE answers 204 once; Undo puts the page back with PUT and no revision, blocks and all", async () => {
    const { call } = await setup();
    const made = (await call("PUT", `${PAGE}/p1`, { body: { title: "Gone soon", style: "dotted", position: 3, blocks: [text("t1"), quote("q1")] } })).json!.page;
    expect((await call("DELETE", `${PAGE}/p1`)).status).toBe(204);
    expect((await call("DELETE", `${PAGE}/p1`)).status).toBe(404);
    expect((await call("PUT", `${PAGE}/p1`, { body: { rev: 1, blocks: [] } })).status).toBe(404);
    const back = await call("PUT", `${PAGE}/p1`, { body: { title: made.title, style: made.style, position: made.position, blocks: made.blocks } });
    expect(back.status).toBe(201);
    expect(back.json!.page).toMatchObject({ title: "Gone soon", style: "dotted", position: 3, blocks: made.blocks });
  });
});

describe("every limit and every bad block", () => {
  it("a bad block is 400 with what is wrong; a capture and a sketch are taken (phase 2.5), an answer is refused", async () => {
    const { call } = await setup();
    const bad = async (blocks: unknown) => call("PUT", `${PAGE}/p1`, { body: { blocks } });
    expect((await bad("x")).status).toBe(400);
    expect((await bad([{ id: "a", kind: "image" }])).status).toBe(400);
    expect((await bad([quote("q", { page: 4 })])).json).toMatchObject({ type: "invalid_notebook", detail: "a quote's page is not in this paper" });
    expect((await bad([{ id: "c", kind: "capture", page: 1, x: 0, y: 0, w: 0.5, h: 0.5 }])).status).toBe(400); // no caption, no size
    expect((await bad([{ id: "c", kind: "capture", page: 9, x: 0, y: 0, w: 0.5, h: 0.5, caption: "", size: "m" }])).status).toBe(400); // not a page of this paper
    expect((await bad([{ id: "s", kind: "sketch", height: 240, strokes: [{ id: "k", tool: "pen", color: "ink", w: 0.004, pts: [2, 0, 0.5] }] }])).status).toBe(400);
    const good = await call("PUT", `${PAGE}/p2`, { body: { blocks: [{ id: "c", kind: "capture", page: 1, x: 0.1, y: 0.1, w: 0.5, h: 0.3, caption: "Fig. 1", size: "m" }, { id: "s", kind: "sketch", height: 240, strokes: [{ id: "k", tool: "pen", color: "ink", w: 0.004, pts: [0.1, 0.1, 0.5, 0.4, 0.3, 0.5] }] }] } });
    expect(good.status).toBe(201);
    expect((await bad([{ id: "a", kind: "answer", agent: "Explain", text: "x", pages: [1] }])).status).toBe(400);
    expect((await call("PUT", `${PAGE}/p1`, { body: { rev: -1, blocks: [] } })).status).toBe(400);
    expect((await call("PUT", `${PAGE}/p1`, { body: { rev: "1", blocks: [] } })).status).toBe(400);
    expect((await call("PUT", `${PAGE}/p1`, { body: { style: "lined", blocks: [] } })).status).toBe(400);
    expect((await call("PUT", `${PAGE}/bad%20id`, { body: { blocks: [] } })).status).toBe(400);
    expect((await call("PUT", `${PAGE}/p1`, { raw: "{nope" })).status).toBe(400);
    expect(((await call("GET", "/d1/notebook")).json as { pages: { id: string }[] }).pages.map((p) => p.id)).toEqual(["p2"]);
  });

  it("413: 201 blocks, a page over 128 KB, a body over the limit, the 51st page, a paper over 2 MB", async () => {
    const { call, sql } = await setup();
    const blocks = (n: number, md = "x") => Array.from({ length: n }, (_, i) => text(`b${i}`, md));
    expect((await call("PUT", `${PAGE}/p1`, { body: { blocks: blocks(201) } })).status).toBe(413);
    expect((await call("PUT", `${PAGE}/p1`, { body: { blocks: blocks(17, "z".repeat(8000)) } })).status).toBe(413);
    expect((await call("PUT", `${PAGE}/p1`, { raw: JSON.stringify({ blocks: [text("t", "y".repeat(140_000))] }) })).status).toBe(413);
    for (let i = 0; i < NOTEBOOK_LIMITS.pages; i++) expect((await call("PUT", `${PAGE}/n${i}`, { body: { blocks: [] } })).status).toBe(201);
    const full = await call("PUT", `${PAGE}/one-more`, { body: { blocks: [] } });
    expect(full.status).toBe(413);
    expect(full.json!.type).toBe("notebook_full");
    // a paper's pages together: 2 MB (sixteen text blocks of 7,900 characters is about 127 KB a page; 17 such pages pass two megabytes)
    sql.prepare("DELETE FROM doc_notebook_pages").run();
    const fat = blocks(16, "w".repeat(7900));
    let refused = 0;
    for (let i = 0; i < 18; i++) if ((await call("PUT", `${PAGE}/f${i}`, { body: { blocks: fat } })).status === 413) refused++;
    expect(refused).toBeGreaterThan(0);
    const bytes = (sql.prepare("SELECT SUM(LENGTH(CAST(blocks AS BLOB))) AS n FROM doc_notebook_pages").get() as { n: number }).n;
    expect(bytes).toBeLessThanOrEqual(NOTEBOOK_LIMITS.paperBytes);
  });
});

describe("the rows go with the paper", () => {
  it("deleting the paper deletes its pages of notes, and only its own", async () => {
    const { call, sql, db } = await setup();
    await call("PUT", `${PAGE}/p1`, { body: { blocks: [text("t1")] } });
    await call("PUT", "/d2/notebook/pages/p1", { body: { blocks: [text("t1")] }, as: "u-2" });
    const files = { delete: async () => {} } as unknown as R2Bucket;
    await deleteDocument({ DB: db, FILES: files }, "u-1", "d1");
    const left = sql.prepare("SELECT doc_id FROM doc_notebook_pages").all() as { doc_id: string }[];
    expect(left.map((r) => r.doc_id)).toEqual(["d2"]);
  });
});
