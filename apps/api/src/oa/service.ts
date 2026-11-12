import { MAX_OA_ABSTRACT_CHARS, OA_REFRESH_DAYS, OA_UNREADABLE_TEXT, OA_NEW_PAPERS_PER_DAY, OA_NEW_PAPERS_PER_DAY_ALL, OA_WAIT_MS, OA_WORKING, cleanArxivId, cleanDoi, cleanPmcid, type OaAskEvent, type OaReason, type OaRef, type OaSource } from "@scholar/shared";
import { answerQuestionStream, type StoredChunk } from "../docs/qa";
import { describeAskError, embedderFor, streamFor } from "../docs/routes";
import type { SseSession } from "../sse";
import { isPermissiveLicense } from "./jats";
import { sourceDepsFor } from "./deps";
import { fetchArxivMeta, lookupByDoi, lookupOpenAlexAbstract } from "./sources";
import { claimAttempt, claimRefresh, createPaper, failIfStale, getPaper, instanceId, keepOld, keyHash, markFailed, readyChunks, refundDaily, setInstance, takeDaily, type OaRow } from "./store";
import { isRetracted } from "../search/retraction-service";
import { askOutcome, countOutcome } from "../outcomes";
import type { EnvPick } from "../platform/env";
import type { LlmEnv } from "../llm";

/**
 * "Ask this paper" as a service (docs/design: "service layer"): the page's /api/v1/papers/oa/ask stream calls `oaService.ask`, and so will the MCP tool `ask_paper` (Phase 2). The events it
 * sends are the stream's events; who carries them (an SSE response, or a tool that collects them) is the caller's business.
 */

/** What "Ask this paper" reads: the model (through the gateway), the shared index and its Workflow, the literature services, and the development switches. */
export type OaEnv = LlmEnv & EnvPick<"FILES" | "OA_INGEST" | "QA_STUB" | "QA_TOP_K" | "CROSSREF_MAILTO" | "OPENALEX_API_KEY", "API_GATE">;
export type AskSession = SseSession<OaAskEvent>;

/** What a request says about a paper: any of a DOI, an arXiv number, a PubMed Central number. */
export function readRef(body: unknown): OaRef | null {
  const o = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const doi = cleanDoi(o.doi);
  const arxivId = cleanArxivId(o.arxivId);
  const pmcid = cleanPmcid(o.pmcid);
  return doi || arxivId ? { ...(doi ? { doi } : {}), ...(arxivId ? { arxivId } : {}), ...(pmcid ? { pmcid } : {}) } : null;
}

/**
 * Is the paper retracted? Looked up when it is asked (Crossref's retraction data through the public cache, which keeps an answer for a day), not only when a card was made: a paper can be
 * retracted after it was found, and a bare DOI pasted into the box has no card. A lookup that fails says nothing and never stops an answer.
 */
async function retractedNow(env: OaEnv, ref: OaRef): Promise<boolean> {
  if (!ref.doi) return false;
  return isRetracted(env, ref.doi, 4000);
}

/**
 * A paper that was read more than OA_REFRESH_DAYS ago is fetched again, in the background: the person who asked is answered from the copy that is there (it stays ready), and the new
 * file is compared with the old one (src/oa/ingest.ts). One refresh at a time, and none again for an hour.
 */
async function refreshIfOld(env: OaEnv, key: string): Promise<void> {
  const attempt = await claimRefresh(env.DB, key, Date.now(), OA_REFRESH_DAYS).catch(() => null);
  if (attempt === null) return;
  try {
    await env.OA_INGEST.create({ id: instanceId(await keyHash(key), attempt), params: { key, attempt, refresh: true } });
  } catch (e) {
    if (!/already_exists|already exists/i.test(e instanceof Error ? e.message : String(e))) {
      console.error(JSON.stringify({ level: "error", msg: "oa_refresh_start_failed", error: e instanceof Error ? e.name : "unknown" }));
      await keepOld(env.DB, key, Date.now(), OA_REFRESH_DAYS).catch(() => {});
    }
  }
}

/** How far along a reading is, 0 to 1, for the progress line. */
export function progressOf(r: Pick<OaRow, "status" | "chunk_count" | "done_chunks">): number {
  switch (r.status) {
    case "queued": return 0.03;
    case "fetching": return 0.12;
    case "reading": return 0.3;
    case "embedding": return r.chunk_count > 0 ? 0.4 + 0.58 * Math.min(1, r.done_chunks / r.chunk_count) : 0.4;
    case "ready": return 1;
    default: return 0;
  }
}
const isWorking = (r: OaRow | null) => !!r && (OA_WORKING as readonly string[]).includes(r.status);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const today = () => new Date().toISOString().slice(0, 10);
/** The row of oa_daily that counts the whole service. */
const EVERYONE = "*";

/**
 * One question about one paper, answered as a stream of events:
 *   ingest  -> only while the paper is being read (from the shared index if it is already there: nothing to wait for), with its progress;
 *   paper   -> what the answer is made from: the full text (and from where, under which licence) or, when that cannot be read, the abstract alone, with the reason;
 *   stage, sources, delta, answer -> as for a question about a paper of your own, every claim tied to a quote that was checked against the text.
 * A paper new to the shared index counts against the person's day (`userId`). Nothing about the person is added to the index, and nothing is stored here.
 */
export async function askOpenAccess(env: OaEnv, a: { userId: string; ref: OaRef; key: string; question: string; clientAbstract: string; embed: NonNullable<ReturnType<typeof embedderFor>>; abort: AbortController; /** How long to wait for a reading that is going (default OA_WAIT_MS; the MCP tool waits less, since an app gives up sooner than the page). */ waitMs?: number }, s: AskSession): Promise<void> {
  const { send } = s;
  const db = env.DB;
  const { ref, key, question, clientAbstract, embed, abort } = a;
  const err = (code: string, title: string, detail?: string) => send({ type: "error", code, title, ...(detail ? { detail } : {}) });
  try {
    let row = await getPaper(db, key);
    if (isWorking(row) && (await failIfStale(db, key, Date.now()))) row = await getPaper(db, key);

    // a paper new to the index: it counts against the person's day (a paper that is already there is free)
    let startedByMe = false;
    if (!row) {
      // two limits: the person's own, and one for the whole service (an emergency brake); a refused person is answered from the abstract
      const everyone = await takeDaily(db, EVERYONE, today(), OA_NEW_PAPERS_PER_DAY_ALL);
      const mine = everyone && (await takeDaily(db, a.userId, today(), OA_NEW_PAPERS_PER_DAY));
      if (everyone && !mine) await refundDaily(db, EVERYONE, today()); // the first was counted and the second refused: give it back
      if (mine) {
        if (!(await createPaper(db, key, ref))) await Promise.all([refundDaily(db, a.userId, today()), refundDaily(db, EVERYONE, today())]);
        row = await getPaper(db, key);
      } else {
        return void (await answerFromAbstract(env, s, { key, ref, reason: "daily_cap", clientAbstract, question, embed, subject: a.userId, abort }));
      }
    }
    if (!row) return void (await err("internal_error", "Something went wrong"));

    // start the reading, or join the one that is going
    if (row.status === "queued" || row.status === "failed") {
      const attempt = await claimAttempt(db, key, Date.now());
      if (attempt !== null) {
        const id = instanceId(await keyHash(key), attempt);
        try {
          await env.OA_INGEST.create({ id, params: { key, attempt } });
          await setInstance(db, key, id);
          startedByMe = true;
        } catch (e) {
          if (!/already_exists|already exists/i.test(e instanceof Error ? e.message : String(e))) {
            console.error(JSON.stringify({ level: "error", msg: "oa_start_failed", error: e instanceof Error ? e.name : "unknown" }));
            await markFailed(db, key, "internal", Date.now());
          }
        }
      }
      row = (await getPaper(db, key)) ?? row;
    }

    // wait for it, telling how far it has got
    let last = "";
    let peak = 0; // the progress of a reading never goes back, whatever the row says next (a reading that fails keeps the point it had reached)
    const deadline = Date.now() + (a.waitMs ?? OA_WAIT_MS);
    while (isWorking(row) && !s.gone) {
      const state = `${row!.status}:${row!.done_chunks}`;
      if (state !== last) {
        last = state;
        peak = Math.max(peak, progressOf(row!));
        await send({ type: "ingest", status: row!.status, progress: peak, ...(row!.source ? { source: row!.source } : {}), started: startedByMe });
      }
      if (Date.now() > deadline) return void (await err("still_reading", "This paper is still being read", "It keeps going without you. Ask again in a minute."));
      await sleep(env.ENABLE_DEV_ROUTES === "1" ? 150 : 800);
      row = (await getPaper(db, key)) ?? row;
      if (isWorking(row) && (await failIfStale(db, key, Date.now()))) row = await getPaper(db, key);
    }
    if (s.gone || !row) return;

    if (row.status !== "ready") {
      await send({ type: "ingest", status: row.status, progress: peak });
      return void (await answerFromAbstract(env, s, { key, ref, reason: (row.reason ?? "internal") as OaReason, title: row.title, clientAbstract, question, embed, subject: a.userId, abort }));
    }
    await send({ type: "ingest", status: "ready", progress: 1, ...(row.source ? { source: row.source } : {}) });
    const retracted = await retractedNow(env, ref);
    await send({ type: "paper", key, title: row.title, source: (row.source ?? "pdf") as OaSource, license: row.license, permissive: isPermissiveLicense(row.license), ...(retracted ? { retracted: true } : {}) });
    // the chunks are read first, then (if the copy is old) the refresh is started: the answer is made from the copy as it is now
    const chunks = await readyChunks(db, key);
    await refreshIfOld(env, key);
    await ask(env, s, { chunks, question, embed, subject: a.userId, abort });
  } catch (e) {
    if (s.gone) return;
    const d = describeAskError(e);
    if (!d) console.error(JSON.stringify({ level: "error", msg: "oa_ask_failed", error: e instanceof Error ? e.name : "unknown" }));
    await err(d?.code ?? "internal_error", d?.title ?? "Something went wrong", d?.detail);
  }
}

type AskArgs = { /** what the answer is made from: the paper's text, or only its abstract (counted apart) */ basis?: "abstract"; chunks: StoredChunk[]; question: string; embed: NonNullable<ReturnType<typeof embedderFor>>; subject: string; abort: AbortController };

/** The question over the passages: the same code as for a paper of your own, so the same checks. */
async function ask(env: OaEnv, s: AskSession, a: AskArgs): Promise<void> {
  const stream = streamFor(env, a.subject, a.abort.signal);
  if (!stream) return void (await s.send({ type: "error", code: "ai_unavailable", title: "Answering is unavailable right now" }));
  const topK = env.ENABLE_DEV_ROUTES === "1" && Number.isInteger(Number(env.QA_TOP_K)) && Number(env.QA_TOP_K) >= 1 ? Number(env.QA_TOP_K) : undefined;
  // Only with the local dev switch (and not the stand-ins): print what the model said and was shown, to tune prompts. Never in production.
  const onRaw = env.ENABLE_DEV_ROUTES === "1" && env.QA_STUB !== "1" ? (raw: unknown, ex: { idx: number; section?: string; text: string }[]) => console.log(JSON.stringify({ msg: "oa_debug", raw, excerpts: ex.map((e) => ({ idx: e.idx, section: e.section, text: e.text })) })) : undefined;
  const answer = await answerQuestionStream({ question: a.question, chunks: a.chunks, embed: a.embed, stream, meta: { id: crypto.randomUUID().replace(/-/g, "").slice(0, 20), createdAt: Date.now() }, emit: s.send, topK, onRaw });
  if (s.gone) return;
  await countOutcome(env.DB, a.basis === "abstract" ? "oa_ask_abstract" : "oa_ask", askOutcome(answer));
  await s.send({ type: "answer", answer });
}

/**
 * The full text cannot be read (not open access, blocked, scanned, too long ...): the question is answered from the abstract alone, and the screen says so. The abstract is
 * what the services give for the DOI or arXiv number; if they give none, the one the browser sent (the card shows it) is used. With neither there is nothing to answer from.
 */
/**
 * The title and abstract the services give for a DOI or an arXiv number: Europe PMC first (biomedical papers), then OpenAlex (most fields), then arXiv. `found` says whether any of them
 * knew the paper at all. Lookups that fail say nothing; never throws. Used by the answer from an abstract below and by the MCP tool check_claim.
 */
export async function abstractFor(env: Pick<OaEnv, "ENABLE_DEV_ROUTES" | "QA_STUB" | "CROSSREF_MAILTO" | "OPENALEX_API_KEY">, ref: OaRef): Promise<{ title: string | null; abstract: string; found: boolean }> {
  const deps = sourceDepsFor(env);
  let title: string | null = null;
  let abstract = "";
  let found = false;
  if (ref.doi) {
    const rec = await lookupByDoi(ref.doi, deps).catch(() => null);
    found ||= !!rec;
    abstract = rec?.abstract ?? "";
    title = rec?.title ?? null;
  }
  if (!abstract && ref.doi) {
    // Europe PMC knows the abstracts of biomedical papers only; OpenAlex knows most fields
    const rec = await lookupOpenAlexAbstract(ref.doi, deps).catch(() => null);
    found ||= !!rec;
    abstract = rec?.abstract ?? "";
    title = title ?? rec?.title ?? null;
  }
  if (!abstract && ref.arxivId) {
    const meta = await fetchArxivMeta(ref.arxivId, deps).catch(() => null);
    found ||= !!meta;
    abstract = meta?.abstract ?? "";
    title = title ?? meta?.title ?? null;
  }
  return { title, abstract, found };
}

async function answerFromAbstract(env: OaEnv, s: AskSession, a: { key: string; ref: OaRef; reason: OaReason; title?: string | null; clientAbstract: string; question: string; embed: AskArgs["embed"]; subject: string; abort: AbortController }): Promise<void> {
  const looked = await abstractFor(env, a.ref);
  const title = a.title ?? looked.title;
  const abstract = looked.abstract || a.clientAbstract;
  if (abstract.length < 40) {
    return void (await s.send({ type: "error", code: "no_text", title: "There is nothing to read for this paper", detail: `${OA_UNREADABLE_TEXT[a.reason]} No abstract could be found either, so there is nothing to answer from. If you have the PDF, add it to My Workspace and ask there.` }));
  }
  const retracted = await retractedNow(env, a.ref);
  await s.send({ type: "paper", key: a.key, title, source: "abstract", license: null, permissive: false, reason: a.reason, ...(retracted ? { retracted: true } : {}) });
  const chunks: StoredChunk[] = [{ idx: 1000, page: 1, section: "Abstract", text: abstract.slice(0, MAX_OA_ABSTRACT_CHARS), embedding: null }];
  await ask(env, s, { basis: "abstract", chunks, question: a.question, embed: a.embed, subject: a.subject, abort: a.abort });
}

export const oaService = { ask: askOpenAccess, readRef, progressOf, abstractFor };
