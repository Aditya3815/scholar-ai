import type { ProblemType } from "@scholar/shared";
import {
  NOTEBOOK_KINDS_NOW,
  NOTEBOOK_LIMITS,
  checkNotebookBlocks,
  cleanNotebookTitle,
  isNotebookId,
  isNotebookPosition,
  isNotebookStyle,
  type NotebookBlock,
  type NotebookPage,
  type NotebookStyle,
} from "@scholar/shared";

/**
 * The Notebook's store (docs/design/paper-reader.md, 19.2 and 19.3): a paper's pages, one row each in doc_notebook_pages. Who may ask is decided by the routes (docs/routes.ts: the
 * same-origin check, the signed-in owner of the paper, the READER switch); what is here takes a paper that is already known to be theirs, and checks everything it is sent, because a
 * page is untrusted input. Every write of the blocks carries the revision it started from, so two windows cannot silently overwrite each other: the later one gets the server's page
 * (409) and merges by block id (apps/web/src/lib/notebook.ts). A rename, a style or a move is last-write-wins and never conflicts with someone typing.
 */

type PageRow = { id: string; title: string; style: NotebookStyle; position: number; blocks: string; rev: number; updated_at: string };
const COLS = "id, title, style, position, blocks, rev, updated_at";
const toPage = (r: PageRow): NotebookPage => ({ id: r.id, title: r.title, style: r.style, position: r.position, blocks: JSON.parse(r.blocks) as NotebookBlock[], rev: r.rev, updatedAt: Date.parse(`${r.updated_at.replace(" ", "T")}Z`) });

/** What a call answers: the HTTP status, and the body's `page` (or a refusal's type and words). */
export type NotebookResult = { status: 200 | 201; page: NotebookPage } | { status: 409; page: NotebookPage } | { status: 400 | 404 | 413; type: ProblemType; title: string; detail?: string };

const refuse = (status: 400 | 404 | 413, type: ProblemType, title: string, detail?: string): NotebookResult => ({ status, type, title, ...(detail ? { detail } : {}) });

export async function listPages(db: D1Database, docId: string): Promise<NotebookPage[]> {
  const rows = await db.prepare(`SELECT ${COLS} FROM doc_notebook_pages WHERE doc_id = ?1 ORDER BY position, created_at, id`).bind(docId).all<PageRow>();
  return rows.results.map(toPage);
}

const onePage = (db: D1Database, docId: string, id: string) => db.prepare(`SELECT ${COLS} FROM doc_notebook_pages WHERE doc_id = ?1 AND id = ?2`).bind(docId, id).first<PageRow>();

/** The bytes of the paper's other pages (for the 1 MB a paper). */
const otherBytes = async (db: D1Database, docId: string, id: string) =>
  (await db.prepare("SELECT COALESCE(SUM(LENGTH(CAST(blocks AS BLOB))), 0) AS n FROM doc_notebook_pages WHERE doc_id = ?1 AND id != ?2").bind(docId, id).first<{ n: number }>())?.n ?? 0;

/**
 * PUT a page. With no `rev` (or 0) the page is made, with its title, style, position and blocks (a page made offline, or one brought back by Undo, keeps its id); with the revision it
 * started from, its blocks are replaced (its title, style and place are PATCH's). A stale revision gets 409 and the server's page.
 */
export async function putPage(db: D1Database, docId: string, pageId: string, body: unknown, maxPage: number): Promise<NotebookResult> {
  if (!isNotebookId(pageId)) return refuse(400, "invalid_notebook", "That page id is not valid");
  if (!body || typeof body !== "object" || Array.isArray(body)) return refuse(400, "invalid_notebook", "Nothing to save");
  const b = body as Record<string, unknown>;
  const rev = b.rev === undefined ? 0 : b.rev;
  if (typeof rev !== "number" || !Number.isInteger(rev) || rev < 0) return refuse(400, "invalid_notebook", "The revision is not a whole number");
  const checked = checkNotebookBlocks(b.blocks, maxPage, NOTEBOOK_KINDS_NOW);
  if (!checked.ok) return refuse(checked.status, checked.status === 413 ? "too_big" : "invalid_notebook", "That page could not be saved", checked.reason);
  const data = JSON.stringify(checked.blocks);
  if ((await otherBytes(db, docId, pageId)) + new TextEncoder().encode(data).length > NOTEBOOK_LIMITS.paperBytes) {
    return refuse(413, "too_big", "The notes of this paper are full", `A paper's notes hold at most ${NOTEBOOK_LIMITS.paperBytes / 1024 / 1024} MB. Delete a page, or some blocks.`);
  }

  if (rev === 0) {
    const title = b.title === undefined ? "" : cleanNotebookTitle(b.title);
    if (title === null) return refuse(400, "invalid_notebook", "A page's title must be text");
    const style = b.style === undefined ? "plain" : b.style;
    if (!isNotebookStyle(style)) return refuse(400, "invalid_notebook", "That is not a paper style");
    if (b.position !== undefined && !isNotebookPosition(b.position)) return refuse(400, "invalid_notebook", "A page's place must be a number");
    // made only if the paper has room for another page, and only if no page of this paper has this id yet (one statement, so two windows cannot both make the 51st page)
    const res = await db
      .prepare(
        `INSERT INTO doc_notebook_pages (doc_id, id, title, style, position, blocks)
         SELECT ?1, ?2, ?3, ?4, COALESCE(?5, (SELECT COALESCE(MAX(position), 0) + 1 FROM doc_notebook_pages WHERE doc_id = ?1)), ?6
          WHERE (SELECT COUNT(*) FROM doc_notebook_pages WHERE doc_id = ?1) < ?7
         ON CONFLICT (doc_id, id) DO NOTHING`,
      )
      .bind(docId, pageId, title, style, b.position ?? null, data, NOTEBOOK_LIMITS.pages)
      .run();
    if ((res.meta.changes ?? 0) === 0) {
      const now = await onePage(db, docId, pageId);
      if (now) return { status: 409, page: toPage(now) };
      return refuse(413, "notebook_full", "This paper has as many pages of notes as it can hold", `The limit is ${NOTEBOOK_LIMITS.pages} pages.`);
    }
    return { status: 201, page: toPage((await onePage(db, docId, pageId))!) };
  }

  const res = await db.prepare("UPDATE doc_notebook_pages SET blocks = ?3, rev = rev + 1, updated_at = datetime('now') WHERE doc_id = ?1 AND id = ?2 AND rev = ?4").bind(docId, pageId, data, rev).run();
  if ((res.meta.changes ?? 0) === 0) {
    const now = await onePage(db, docId, pageId);
    // deleted in another window: the page that saves it can make it again (rev 0)
    if (!now) return refuse(404, "page_gone", "That page of notes is not there any more");
    return { status: 409, page: toPage(now) };
  }
  return { status: 200, page: toPage((await onePage(db, docId, pageId))!) };
}

/** PATCH a page's title, style or place: the last write wins, and the revision of its blocks does not move. */
export async function patchPage(db: D1Database, docId: string, pageId: string, body: unknown): Promise<NotebookResult> {
  if (!isNotebookId(pageId)) return refuse(400, "invalid_notebook", "That page id is not valid");
  if (!body || typeof body !== "object" || Array.isArray(body)) return refuse(400, "invalid_notebook", "Nothing to change");
  const b = body as Record<string, unknown>;
  const sets: string[] = [];
  const args: unknown[] = [docId, pageId];
  if (b.title !== undefined) {
    const title = cleanNotebookTitle(b.title);
    if (title === null) return refuse(400, "invalid_notebook", "A page's title must be text");
    args.push(title);
    sets.push(`title = ?${args.length}`);
  }
  if (b.style !== undefined) {
    if (!isNotebookStyle(b.style)) return refuse(400, "invalid_notebook", "That is not a paper style");
    args.push(b.style);
    sets.push(`style = ?${args.length}`);
  }
  if (b.position !== undefined) {
    if (!isNotebookPosition(b.position)) return refuse(400, "invalid_notebook", "A page's place must be a number");
    args.push(b.position);
    sets.push(`position = ?${args.length}`);
  }
  if (!sets.length) return refuse(400, "invalid_notebook", "Nothing to change", "Send a title, a style or a position.");
  const res = await db.prepare(`UPDATE doc_notebook_pages SET ${sets.join(", ")}, updated_at = datetime('now') WHERE doc_id = ?1 AND id = ?2`).bind(...args).run();
  if ((res.meta.changes ?? 0) === 0) return refuse(404, "page_gone", "That page of notes is not there any more");
  return { status: 200, page: toPage((await onePage(db, docId, pageId))!) };
}

/** DELETE a page. Undo puts it back with PUT and no revision. */
export async function deletePage(db: D1Database, docId: string, pageId: string): Promise<boolean> {
  if (!isNotebookId(pageId)) return false;
  const res = await db.prepare("DELETE FROM doc_notebook_pages WHERE doc_id = ?1 AND id = ?2").bind(docId, pageId).run();
  return (res.meta.changes ?? 0) > 0;
}
