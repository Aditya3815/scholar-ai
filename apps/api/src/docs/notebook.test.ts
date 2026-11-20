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

/** R2 in memory: put, get, delete (one key or many), list by prefix (one page). */
function memoryR2() {
  const objects = new Map<string, { bytes: Uint8Array; type?: string }>();
  const bucket = {
    objects,
    put: async (key: string, body: Uint8Array, o?: { httpMetadata?: { contentType?: string } }) => void objects.set(key, { bytes: new Uint8Array(body), type: o?.httpMetadata?.contentType }),
    get: async (key: string) => {
      const o = objects.get(key);
      return o ? { body: new Blob([o.bytes]).stream(), size: o.bytes.length, httpMetadata: { contentType: o.type } } : null;
    },
    delete: async (k: string | string[]) => void (Array.isArray(k) ? k : [k]).forEach((x) => objects.delete(x)),
    list: async (o: { prefix?: string; limit?: number }) => ({
      objects: [...objects.entries()].filter(([k]) => k.startsWith(o.prefix ?? "")).slice(0, o.limit ?? 1000).map(([key, v]) => ({ key, size: v.bytes.length, httpMetadata: { contentType: v.type } })),
      truncated: false,
    }),
  };
  return bucket as unknown as R2Bucket & { objects: typeof objects };
}
async function setup(vars: Record<string, string> = { READER: "on" }) {
  const { db, sql } = testD1();
  sql.prepare("INSERT INTO users (id, email) VALUES ('u-1', 'a@example.org'), ('u-2', 'b@example.org')").run();
  sql.prepare("INSERT INTO documents (id, user_id, title, filename, size_bytes, pages, status) VALUES ('d1', 'u-1', 'Paper', 'p.pdf', 10, 3, 'ready'), ('d2', 'u-2', 'Theirs', 't.pdf', 10, 3, 'ready')").run();
  const app = new Hono<HonoEnv>();
  // the origin check is the app's, for every write (app/mount.ts), not the router's
  app.use("/api/*", sameOriginWrites({ skip: {}, devFirst: [] }));
  app.route("/api/v1/documents", documentRoutes);
  const files = memoryR2();
  const env = { DB: db, FILES: files, ...vars } as unknown as HonoEnv["Bindings"];
  const tokens = { "u-1": await createSession(db, "u-1", undefined), "u-2": await createSession(db, "u-2", undefined) };
  const call = async (method: string, path: string, opts: { body?: unknown; raw?: string; bytes?: Uint8Array; as?: "u-1" | "u-2" | null; origin?: string | null } = {}) => {
    const who = opts.as === undefined ? "u-1" : opts.as;
    const headers: Record<string, string> = {};
    if (who) headers.cookie = `sid=${tokens[who]}`;
    const origin = opts.origin === undefined ? BASE : opts.origin;
    if (origin) headers.origin = origin;
    const body: BodyInit | undefined = opts.bytes ?? opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body));
    if (opts.bytes) headers["content-type"] = "application/octet-stream";
    else if (body !== undefined) headers["content-type"] = "application/json";
    const res = await app.request(`${BASE}/api/v1/documents${path}`, { method, headers, body }, env);
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("json") && res.status === 200) return { status: res.status, json: null, bytes: new Uint8Array(await res.arrayBuffer()), headers: res.headers };
    const text = await res.text();
    return { status: res.status, json: text ? (JSON.parse(text) as Record<string, any>) : null, headers: res.headers };
  };
  return { call, sql, db, files };
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
  it("a bad block is 400 with what is wrong; a capture and a sketch are taken (phase 2.5), and an agent's answer (phase 3)", async () => {
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
    // the planned "answer" kind is "agent" since phase 3: the old shape is not a kind
    expect((await bad([{ id: "a", kind: "answer", agent: "Explain", text: "x", pages: [1] }])).status).toBe(400);
    expect((await bad([{ id: "a", kind: "agent", agent: "explain", ask: "x", md: "It means (p. 9).", pages: [9], at: 1 }])).json).toMatchObject({ detail: "an answer's pages are not in this paper" });
    const agent = await call("PUT", `${PAGE}/p3`, { body: { blocks: [{ id: "a", kind: "agent", agent: "critique", ask: "", md: "- **Thin evidence.** x (p. 1)", pages: [1], at: 1 }] } });
    expect(agent.status).toBe(201);
    expect((await call("DELETE", `${PAGE}/p3`)).status).toBe(204);
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
    await deleteDocument({ DB: db, FILES: memoryR2() }, "u-1", "d1");
    const left = sql.prepare("SELECT doc_id FROM doc_notebook_pages").all() as { doc_id: string }[];
    expect(left.map((r) => r.doc_id)).toEqual(["d2"]);
  });
});

describe("pictures in the notes (paper-reader.md 22)", () => {
  const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const png = (w: number, h: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), 0x49, 0x48, 0x44, 0x52, ...be32(w), ...be32(h), 8, 6, 0, 0, 0, ...new Array(40).fill(7)]);
  const img = (id: string) => ({ id, kind: "image", w: 64, h: 48, type: "image/png", alt: "A diagram" });
  const IMG = "/d1/notebook/images";

  it("a picture is kept for its owner only: its kind read from its bytes, served with its type, 404 for anyone else and with READER off", async () => {
    const { call, files } = await setup();
    const put = await call("PUT", `${IMG}/i1`, { bytes: png(64, 48) });
    expect(put.status).toBe(201);
    expect(put.json).toEqual({ w: 64, h: 48, type: "image/png" });
    expect([...files.objects.keys()]).toEqual(["docs/u-1/d1/notebook/i1"]);
    const got = await call("GET", `${IMG}/i1`);
    expect(got.status).toBe(200);
    expect(got.headers.get("content-type")).toBe("image/png");
    expect(got.headers.get("x-content-type-options")).toBe("nosniff");
    expect(got.bytes!.length).toBe(png(64, 48).length);
    expect((await call("GET", `${IMG}/i1`, { as: "u-2" })).status).toBe(404);
    expect((await call("GET", `${IMG}/i1`, { as: null })).status).toBe(401);
    expect((await call("PUT", `${IMG}/i2`, { bytes: png(10, 10), origin: "https://evil.example" })).status).toBe(403);
    const off = await setup({});
    expect((await off.call("PUT", `${IMG}/i1`, { bytes: png(10, 10) })).status).toBe(404);
  });

  it("refuses what is not a picture, too big, too large a side, or still holds camera data", async () => {
    const { call, files } = await setup();
    const svg = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>");
    expect((await call("PUT", `${IMG}/i1`, { bytes: svg })).status).toBe(400);
    expect((await call("PUT", `${IMG}/i1`, { bytes: png(2001, 10) })).status).toBe(400);
    const big = new Uint8Array(2 * 1024 * 1024 + 10);
    big.set(png(10, 10));
    expect((await call("PUT", `${IMG}/i1`, { bytes: big })).status).toBe(413);
    const exif = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 8, 0x45, 0x78, 0x69, 0x66, 0, 0, 0xff, 0xc0, 0, 17, 8, 0, 10, 0, 10, 3, ...new Array(20).fill(0)]);
    expect((await call("PUT", `${IMG}/i1`, { bytes: exif })).json!.detail).toMatch(/EXIF/);
    expect((await call("PUT", `${IMG}/bad%20id`, { bytes: png(10, 10) })).status).toBe(400);
    expect(files.objects.size).toBe(0);
  });

  it("a file no block holds is deleted ten minutes later, on the next write; Undo within them keeps it; the paper takes them all", async () => {
    const { call, files, sql, db } = await setup();
    await call("PUT", `${IMG}/i1`, { bytes: png(64, 48) });
    await call("PUT", `${IMG}/i2`, { bytes: png(64, 48) });
    const gone = () => (sql.prepare("SELECT block_id FROM doc_notebook_image_gone ORDER BY block_id").all() as { block_id: string }[]).map((r) => r.block_id);
    expect(gone()).toEqual(["i1", "i2"]); // uploaded, not yet in a page
    const p = await call("PUT", `${PAGE}/p1`, { body: { blocks: [img("i1"), img("i2")] } });
    expect(p.status).toBe(201);
    expect(gone()).toEqual([]);
    // i2 taken out of the page: noted, kept for ten minutes
    await call("PUT", `${PAGE}/p1`, { body: { rev: 1, blocks: [img("i1")] } });
    expect(gone()).toEqual(["i2"]);
    expect(files.objects.has("docs/u-1/d1/notebook/i2")).toBe(true);
    // Undo: back in the page, kept
    await call("PUT", `${PAGE}/p1`, { body: { rev: 2, blocks: [img("i1"), img("i2")] } });
    expect(gone()).toEqual([]);
    // taken out again, and ten minutes pass: the next write deletes the file
    await call("PUT", `${PAGE}/p1`, { body: { rev: 3, blocks: [img("i1")] } });
    sql.prepare("UPDATE doc_notebook_image_gone SET since = since - 11 * 60 * 1000").run();
    await call("PUT", `${PAGE}/p1`, { body: { rev: 4, blocks: [img("i1"), text("t")] } });
    expect(files.objects.has("docs/u-1/d1/notebook/i2")).toBe(false);
    expect(files.objects.has("docs/u-1/d1/notebook/i1")).toBe(true);
    // a page deleted: its pictures wait too; the paper's deletion takes every file at once
    expect((await call("DELETE", `${PAGE}/p1`)).status).toBe(204);
    expect(gone()).toEqual(["i1"]);
    await deleteDocument({ DB: db, FILES: files }, "u-1", "d1");
    expect(files.objects.size).toBe(0);
    expect(gone()).toEqual([]);
  });
});
