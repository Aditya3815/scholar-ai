import { describe, expect, it } from "vitest";
import { compareInventory, listDocuments, listFiles, type DocRow, type Obj } from "./integrity";

const NOW = Date.parse("2026-10-22T12:00:00Z");
const OLD = NOW - 3 * 3_600_000;
const FRESH = NOW - 60_000;
const obj = (key: string, uploadedMs = OLD): Obj => ({ key, uploadedMs });
const row = (id: string, over: Partial<DocRow> = {}): DocRow => ({ id, user_id: "u1", has_cover: 0, createdMs: OLD, ...over });
const run = (objects: Obj[], rows: DocRow[], over: { graceMinutes?: number; truncated?: boolean } = {}) => compareInventory(objects, rows, { now: NOW, graceMinutes: 15, ...over });

describe("compareInventory", () => {
  it("finds nothing wrong when every paper has its file (and cover) and every file has its paper", () => {
    const r = run([obj("docs/u1/aaaaaaaa1.pdf"), obj("docs/u1/aaaaaaaa1.cover.jpg"), obj("docs/u2/bbbbbbbb2.pdf")], [row("aaaaaaaa1", { has_cover: 1 }), row("bbbbbbbb2", { user_id: "u2" })]);
    expect(r).toMatchObject({ files: 3, documents: 2, missingFiles: 0, missingCovers: 0, orphanFiles: 0, unrecognised: 0, truncated: false });
  });

  it("reports a paper whose PDF is gone, with the short id only", () => {
    const r = run([], [row("abcdefgh-1234-5678")]);
    expect(r.missingFiles).toBe(1);
    expect(r.samples.missingFiles).toEqual(["abcdefgh"]);
    expect(JSON.stringify(r)).not.toContain("u1");
  });

  it("reports a cover that is recorded but missing, and does not ask for a cover a paper never had", () => {
    const r = run([obj("docs/u1/p1.pdf"), obj("docs/u1/p2.pdf")], [row("p1", { has_cover: 1 }), row("p2", { has_cover: 0 })]);
    expect(r).toMatchObject({ missingFiles: 0, missingCovers: 1 });
    expect(r.samples.missingCovers).toEqual(["p1"]);
  });

  it("reports a stored file nobody points to, whether it is a PDF or a cover", () => {
    const r = run([obj("docs/ghost/zzzzzzzz9.pdf"), obj("docs/ghost/yyyyyyyy8.cover.jpg")], []);
    expect(r.orphanFiles).toBe(2);
    expect(r.samples.orphanFiles.sort()).toEqual(["yyyyyyyy", "zzzzzzzz"]);
  });

  it("matches files to papers by owner AND id: the same id under another owner is an orphan, and the paper's own file is missing", () => {
    const r = run([obj("docs/u2/p1.pdf")], [row("p1", { user_id: "u1" })]);
    expect(r).toMatchObject({ missingFiles: 1, orphanFiles: 1 });
  });

  it("does not judge what is younger than the grace: an upload or a delete may be in progress", () => {
    const r = run([obj("docs/u1/new-file.pdf", FRESH)], [row("new-row", { createdMs: FRESH })]);
    expect(r).toMatchObject({ missingFiles: 0, orphanFiles: 0 });
    const strict = run([obj("docs/u1/new-file.pdf", FRESH)], [row("new-row", { createdMs: FRESH })], { graceMinutes: 0 });
    expect(strict).toMatchObject({ missingFiles: 1, orphanFiles: 1 });
  });

  it("does not judge a record whose creation time cannot be read", () => {
    expect(run([], [row("p1", { createdMs: NaN })]).missingFiles).toBe(0);
  });

  it("counts keys it does not recognise, and does not call them orphans", () => {
    const r = run([obj("docs/u1/readme.txt"), obj("docs/loose.pdf"), obj("docs/u1/sub/dir/a.pdf"), obj("docs/u1/.pdf")], []);
    expect(r.unrecognised).toBeGreaterThanOrEqual(3);
    expect(r.orphanFiles).toBe(0);
  });

  it("keeps only ten samples however many problems there are, but counts them all", () => {
    const rows = Array.from({ length: 25 }, (_, i) => row(`doc-${String(i).padStart(3, "0")}`));
    const r = run([], rows);
    expect(r.missingFiles).toBe(25);
    expect(r.samples.missingFiles).toHaveLength(10);
  });

  it("passes the truncation flag and the grace through", () => {
    expect(run([], [], { truncated: true, graceMinutes: 3 })).toMatchObject({ truncated: true, graceMinutes: 3 });
  });
});

describe("listFiles", () => {
  const bucket = (pages: { keys: string[]; truncated: boolean }[]) => {
    const calls: { prefix?: string; cursor?: string; limit?: number }[] = [];
    return {
      calls,
      list: async (o: { prefix?: string; cursor?: string; limit?: number }) => {
        calls.push(o);
        const i = o.cursor ? Number(o.cursor) : 0;
        const p = pages[i]!;
        return { objects: p.keys.map((key) => ({ key, uploaded: new Date(OLD) })), truncated: p.truncated, cursor: String(i + 1) };
      },
    } as unknown as R2Bucket & { calls: typeof calls };
  };

  it("follows the cursor through every page and only looks under docs/", async () => {
    const b = bucket([{ keys: ["docs/a/1.pdf", "docs/a/2.pdf"], truncated: true }, { keys: ["docs/b/3.pdf"], truncated: false }]);
    const out = await listFiles(b);
    expect(out.objects.map((o) => o.key)).toEqual(["docs/a/1.pdf", "docs/a/2.pdf", "docs/b/3.pdf"]);
    expect(out.truncated).toBe(false);
    expect(b.calls.every((c) => c.prefix === "docs/")).toBe(true);
  });

  it("stops at the limit and says the list is partial", async () => {
    const b = bucket([{ keys: ["docs/a/1.pdf", "docs/a/2.pdf"], truncated: true }, { keys: ["docs/a/3.pdf"], truncated: true }, { keys: ["docs/a/4.pdf"], truncated: false }]);
    const out = await listFiles(b, 2);
    expect(out.truncated).toBe(true);
    expect(out.objects).toHaveLength(2);
    expect(b.calls).toHaveLength(1);
  });

  it("an empty bucket is an empty list, not an error", async () => {
    expect(await listFiles(bucket([{ keys: [], truncated: false }]))).toEqual({ objects: [], truncated: false });
  });
});

describe("listDocuments", () => {
  it("reads the records in pages, in id order, converting the time", async () => {
    const all = Array.from({ length: 2005 }, (_, i) => ({ id: `d${String(i).padStart(5, "0")}`, user_id: "u", has_cover: i % 2, created_at: "2026-10-22 09:00:00" }));
    const afters: string[] = [];
    const db = {
      prepare: () => ({
        bind: (after: string) => ({
          all: async () => {
            afters.push(after);
            return { results: all.filter((r) => r.id > after).slice(0, 2000) };
          },
        }),
      }),
    } as unknown as D1Database;
    const rows = await listDocuments(db);
    expect(rows).toHaveLength(2005);
    expect(afters).toEqual(["", "d01999"]);
    expect(rows[0]).toMatchObject({ id: "d00000", createdMs: Date.parse("2026-10-22T09:00:00Z") });
  });

  it("exactly one full page ends with one extra, empty, read", async () => {
    const all = Array.from({ length: 2000 }, (_, i) => ({ id: `d${String(i).padStart(5, "0")}`, user_id: "u", has_cover: 0, created_at: "2026-10-22 09:00:00" }));
    const db = { prepare: () => ({ bind: (after: string) => ({ all: async () => ({ results: all.filter((r) => r.id > after).slice(0, 2000) }) }) }) } as unknown as D1Database;
    expect(await listDocuments(db)).toHaveLength(2000);
  });
});
