import { MAX_OA_PAGES, OA_REASONS, OA_RETRYABLE, type OaReason } from "@scholar/shared";
import type { Embedder } from "../docs/embed";
import { chunksFromPages, chunksFromSections, type OaChunk } from "./chunks";
import { looksLikePaper } from "./identity";
import { parseJats } from "./jats";
import { PdfReadError, extractPdfPages } from "./pdf-text";
import { fetchPaperSource, type SourceDeps } from "./sources";
import { fileKey, getPaper, keyHash, markFailed, markReady, pendingEmbeddings, replaceChunks, saveEmbeddings, setFetched, setStatus, setTitle } from "./store";

/**
 * The steps of reading one open-access paper into the shared index, as plain functions over their dependencies. The Workflow (workflow.ts) gives each of them a name, a retry
 * policy and a checkpoint; here each one is written so that running it again after a partial success is harmless:
 *   fetch  -> finds the text (see sources.ts), keeps the file in R2 under a name derived from the paper;
 *   read   -> turns the file into passages and replaces ALL the paper's passages (a new try starts from nothing);
 *   embed  -> takes the next passages that have no embedding, embeds them, stores them (so a repeated step does only what is left);
 *   finish -> `ready` only if every passage has its embedding.
 */
export const EMBED_BATCH = 20;
/** The most passages one paper may have (about 1.3 million characters): a limit of memory and of cost. */
export const MAX_OA_CHUNKS = 1500;

export type IngestDeps = {
  db: D1Database;
  files: R2Bucket;
  embed: Embedder;
  source: SourceDeps;
  now?: () => number;
};

/** A reading failed for a named reason. `retryable` says whether waiting can cure it (the Workflow then tries the step again; otherwise the paper is unreadable for good). */
export class IngestError extends Error {
  constructor(readonly reason: OaReason, readonly retryable = OA_RETRYABLE.includes(reason)) {
    super(`oa:${reason}`);
    this.name = "IngestError";
  }
}

/** The reason in an error's message (`oa:blocked`), as it comes back from a Workflow, or "internal" for anything else. */
export function reasonOf(e: unknown): OaReason {
  const m = /oa:([a-z_]+)/.exec(e instanceof Error ? e.message : String(e));
  return (OA_REASONS as readonly string[]).includes(m?.[1] ?? "") ? (m![1] as OaReason) : "internal";
}

const row = async (d: IngestDeps, key: string) => {
  const r = await getPaper(d.db, key);
  if (!r) throw new IngestError("internal", false);
  return r;
};

export async function stepFetch(d: IngestDeps, key: string): Promise<{ format: "xml" | "pdf" }> {
  const paper = await row(d, key);
  await setStatus(d.db, key, "fetching");
  const found = await fetchPaperSource({ ...(paper.doi ? { doi: paper.doi } : {}), ...(paper.arxiv_id ? { arxivId: paper.arxiv_id } : {}), ...(paper.pmcid ? { pmcid: paper.pmcid } : {}) }, d.source);
  if (!found.ok) {
    if (found.title) await setTitle(d.db, key, found.title);
    throw new IngestError(found.reason);
  }
  const hash = await keyHash(key);
  const r2Key = fileKey(hash, found.format === "xml" ? "source.xml" : "source.pdf");
  await d.files.put(r2Key, found.format === "xml" ? found.xml : found.pdf, { httpMetadata: { contentType: found.format === "xml" ? "application/xml" : "application/pdf" } });
  await setFetched(d.db, key, { source: found.source, license: found.license, title: found.title, r2Key });
  return { format: found.format };
}

export async function stepRead(d: IngestDeps, key: string): Promise<{ total: number; pages: number | null }> {
  const paper = await row(d, key);
  await setStatus(d.db, key, "reading");
  if (!paper.r2_key) throw new IngestError("internal", false);
  const file = await d.files.get(paper.r2_key);
  if (!file) throw new IngestError("internal"); // the file is gone: a new try fetches it again
  let chunks: OaChunk[];
  let pages: number | null = null;
  let title = paper.title;
  if (paper.source === "europepmc") {
    const jats = parseJats(await file.text());
    if (jats.sections.length === 0 && !jats.abstract) throw new IngestError("empty", false);
    chunks = chunksFromSections(jats.sections, jats.abstract);
    title = title ?? jats.title;
    if (looksLikePaper(paper.title, [jats.title, jats.abstract].filter(Boolean).join(" ")) === false && jats.title) throw new IngestError("wrong_paper", false);
  } else {
    let text;
    try {
      text = await extractPdfPages(new Uint8Array(await file.arrayBuffer()), MAX_OA_PAGES);
    } catch (e) {
      if (e instanceof PdfReadError) throw new IngestError(e.reason, false);
      throw new IngestError("internal");
    }
    pages = text.totalPages;
    if (looksLikePaper(paper.title, text.pages.slice(0, 2).map((p) => p.text).join(" ")) === false) throw new IngestError("wrong_paper", false);
    chunks = chunksFromPages(text.pages);
  }
  if (chunks.length === 0) throw new IngestError("empty", false);
  if (chunks.length > MAX_OA_CHUNKS) throw new IngestError("too_long", false);
  await setTitle(d.db, key, title);
  await replaceChunks(d.db, key, chunks, pages);
  return { total: chunks.length, pages };
}

export async function stepEmbed(d: IngestDeps, key: string): Promise<{ embedded: number }> {
  await setStatus(d.db, key, "embedding");
  const todo = await pendingEmbeddings(d.db, key, EMBED_BATCH);
  if (todo.length === 0) return { embedded: 0 };
  const vectors = await d.embed(todo.map((t) => t.text));
  if (vectors.length !== todo.length) throw new IngestError("internal");
  await saveEmbeddings(d.db, key, todo.map((t, i) => ({ idx: t.idx, vector: vectors[i]! })));
  return { embedded: todo.length };
}

export async function stepFinish(d: IngestDeps, key: string): Promise<void> {
  if (!(await markReady(d.db, key))) throw new IngestError("internal"); // some passage has no embedding: the step is tried again
}

/** The reading is over without a paper: record why. Never throws (it runs while a failure is being handled). */
export async function recordFailure(d: IngestDeps, key: string, e: unknown): Promise<OaReason> {
  const reason = e instanceof IngestError ? e.reason : reasonOf(e);
  await markFailed(d.db, key, reason, (d.now ?? Date.now)()).catch(() => {});
  return reason;
}
