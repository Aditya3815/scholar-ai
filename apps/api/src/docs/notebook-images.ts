import { NOTE_IMAGE_LIMITS, isNotebookId, noteImageInfo, noteImageProblem, type NotebookBlock, type ProblemType } from "@scholar/shared";

/**
 * Pictures in the notes (docs/design/paper-reader.md, 22; the owner's yes of 18 Nov 2026). A picture's file is kept in R2 under its paper and its block, and served only to the
 * paper's owner (the routes in routes.ts guard it as the paper's own file). A file no block holds is noted in doc_notebook_image_gone and deleted ten minutes later, on the next write
 * in that paper, so Undo can bring its block back; the paper's deletion takes them all.
 */
export const notebookImagePrefix = (userId: string, docId: string) => `docs/${userId}/${docId}/notebook/`;
export const notebookImageKey = (userId: string, docId: string, blockId: string) => `${notebookImagePrefix(userId, docId)}${blockId}`;
/** How long a file no block holds is kept, for Undo. */
export const IMAGE_GRACE_MS = 10 * 60 * 1000;

type Env = { DB: D1Database; FILES: R2Bucket };
export type ImagePut = { ok: true; w: number; h: number; type: string } | { ok: false; status: 400 | 413; type: ProblemType; title: string; detail?: string };

/** The ids of the picture blocks among `blocks`. */
export const imageIds = (blocks: readonly NotebookBlock[] | unknown): string[] =>
  Array.isArray(blocks) ? (blocks as { kind?: unknown; id?: unknown }[]).filter((b) => b && b.kind === "image" && typeof b.id === "string").map((b) => b.id as string) : [];

/** Keeps a picture for block `blockId`: its bytes checked (kind by its first bytes, size, sides, no EXIF), at most 200 a paper. Noted as held by no block until a page holds it. */
export async function putNotebookImage(env: Env, userId: string, docId: string, blockId: string, bytes: Uint8Array, now = Date.now()): Promise<ImagePut> {
  if (!isNotebookId(blockId)) return { ok: false, status: 400, type: "invalid_image", title: "That picture's id is not valid" };
  const problem = noteImageProblem(bytes);
  if (problem) return { ok: false, status: problem.status, type: problem.status === 413 ? "too_big" : "invalid_image", title: problem.status === 413 ? "That picture is too big" : "That is not a picture we can keep", detail: problem.reason };
  const info = noteImageInfo(bytes)!;
  const key = notebookImageKey(userId, docId, blockId);
  const listed = await env.FILES.list({ prefix: notebookImagePrefix(userId, docId), limit: NOTE_IMAGE_LIMITS.perPaper + 1 });
  if (listed.objects.length >= NOTE_IMAGE_LIMITS.perPaper && !listed.objects.some((o) => o.key === key)) return { ok: false, status: 413, type: "too_many_images", title: `A paper's notes can hold ${NOTE_IMAGE_LIMITS.perPaper} pictures` };
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: info.type } });
  // held by no block until its page is saved with it
  await env.DB.prepare("INSERT INTO doc_notebook_image_gone (doc_id, block_id, user_id, since) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (doc_id, block_id) DO UPDATE SET since = excluded.since")
    .bind(docId, blockId, userId, now)
    .run();
  return { ok: true, w: info.w, h: info.h, type: info.type };
}

/** After a page was saved or deleted: the pictures it stopped holding are noted, those it holds now are kept, and the paper's files no block has held for ten minutes are deleted. */
export async function settleNotebookImages(env: Env, userId: string, docId: string, before: readonly string[], after: readonly string[], now = Date.now()): Promise<void> {
  const held = new Set(after);
  const dropped = before.filter((id) => !held.has(id));
  const stmts: D1PreparedStatement[] = [];
  for (const id of after) stmts.push(env.DB.prepare("DELETE FROM doc_notebook_image_gone WHERE doc_id = ?1 AND block_id = ?2").bind(docId, id));
  for (const id of dropped) stmts.push(env.DB.prepare("INSERT INTO doc_notebook_image_gone (doc_id, block_id, user_id, since) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (doc_id, block_id) DO NOTHING").bind(docId, id, userId, now));
  if (stmts.length) await env.DB.batch(stmts);
  await sweepNotebookImages(env, docId, now);
}

/** Deletes the paper's files that no block has held for ten minutes (checked once more against every page, in case one holds it again). */
export async function sweepNotebookImages(env: Env, docId: string, now = Date.now()): Promise<number> {
  const old = await env.DB.prepare("SELECT block_id, user_id FROM doc_notebook_image_gone WHERE doc_id = ?1 AND since <= ?2 LIMIT 50").bind(docId, now - IMAGE_GRACE_MS).all<{ block_id: string; user_id: string }>();
  if (!old.results.length) return 0;
  const pages = await env.DB.prepare("SELECT blocks FROM doc_notebook_pages WHERE doc_id = ?1").bind(docId).all<{ blocks: string }>();
  const held = new Set(pages.results.flatMap((p) => imageIds(JSON.parse(p.blocks) as unknown)));
  let gone = 0;
  for (const r of old.results) {
    if (!held.has(r.block_id)) {
      await env.FILES.delete(notebookImageKey(r.user_id, docId, r.block_id));
      gone++;
    }
    await env.DB.prepare("DELETE FROM doc_notebook_image_gone WHERE doc_id = ?1 AND block_id = ?2").bind(docId, r.block_id).run();
  }
  return gone;
}

/** Every picture of a paper's notes, with the paper (and so with the account). */
export async function deleteNotebookImages(env: Env, userId: string, docId: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const listed = await env.FILES.list({ prefix: notebookImagePrefix(userId, docId), cursor });
    if (listed.objects.length) await env.FILES.delete(listed.objects.map((o) => o.key));
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}

/** The pictures of a person's notes, for their data export: where each is, its kind and size (the files themselves are fetched from those addresses). */
export async function listNotebookImages(env: Env, userId: string, docIds: readonly string[]): Promise<{ docId: string; blockId: string; type: string; bytes: number; url: string }[]> {
  const out: { docId: string; blockId: string; type: string; bytes: number; url: string }[] = [];
  for (const docId of docIds) {
    let cursor: string | undefined;
    do {
      const listed = await env.FILES.list({ prefix: notebookImagePrefix(userId, docId), cursor, include: ["httpMetadata"] });
      for (const o of listed.objects) {
        const blockId = o.key.slice(notebookImagePrefix(userId, docId).length);
        out.push({ docId, blockId, type: o.httpMetadata?.contentType ?? "application/octet-stream", bytes: o.size, url: `/api/v1/documents/${docId}/notebook/images/${blockId}` });
      }
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
  }
  return out;
}
