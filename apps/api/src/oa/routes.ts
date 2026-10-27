import { Hono, type Context } from "hono";
import { MAX_OA_ABSTRACT_CHARS, OA_UNREADABLE_TEXT, MAX_QUESTION_CHARS, OA_NEW_PAPERS_PER_DAY, OA_NEW_PAPERS_PER_DAY_ALL, OA_WAIT_MS, OA_WORKING, cleanArxivId, cleanDoi, cleanPmcid, oaKey, type OaAskEvent, type OaIngestEvent, type OaReason, type OaRef, type OaSource } from "@scholar/shared";
import { currentUser, sameOrigin } from "../auth/http";
import { answerQuestionStream, type StoredChunk } from "../docs/qa";
import { describeAskError, embedderFor, streamFor } from "../docs/routes";
import { sseStream } from "../sse";
import type { ApiGate } from "../gate/api-gate";
import { installGates } from "../gate";
import { remoteGate } from "../gate/api-gate";
import { isPermissiveLicense } from "./jats";
import { sourceDepsFor } from "./deps";
import { fetchArxivMeta, lookupByDoi, lookupOpenAlexAbstract } from "./sources";
import { claimAttempt, createPaper, failIfStale, getPaper, instanceId, keyHash, markFailed, readyChunks, refundDaily, setInstance, takeDaily, type OaRow } from "./store";
import type { OaParams } from "./workflow";
import { askOutcome, countOutcome } from "../outcomes";

type Bindings = {
  DB: D1Database;
  FILES: R2Bucket;
  AI?: Ai;
  API_GATE?: DurableObjectNamespace<ApiGate>;
  OA_INGEST: Workflow<OaParams>;
  ENABLE_DEV_ROUTES?: string;
  QA_STUB?: string;
  QA_TOP_K?: string;
  CROSSREF_MAILTO: string;
  OPENALEX_API_KEY?: string;
  OCR_PAGES_PER_DAY?: string;
  GEMINI_API_KEY?: string;
};
type Env = { Bindings: Bindings };
export const oaRoutes = new Hono<Env>();

oaRoutes.use("*", async (c, next) => {
  installGates(c.env.API_GATE ? remoteGate(c.env.API_GATE) : null);
  await next();
  c.header("Cache-Control", "no-store");
});

const deny = (c: Context<Env>, status: 400 | 401 | 403 | 503, type: string, title: string, detail?: string) => c.json({ type, title, ...(detail ? { detail } : {}) }, status);

/** What a request says about a paper: any of a DOI, an arXiv number, a PubMed Central number. */
function readRef(body: unknown): OaRef | null {
  const o = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const doi = cleanDoi(o.doi);
  const arxivId = cleanArxivId(o.arxivId);
  const pmcid = cleanPmcid(o.pmcid);
  return doi || arxivId ? { ...(doi ? { doi } : {}), ...(arxivId ? { arxivId } : {}), ...(pmcid ? { pmcid } : {}) } : null;
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
 * The state of a paper in the shared index, for the screen (a signed-in person; the index is public data: titles, states, counts).
 */
oaRoutes.get("/status", async (c) => {
  if (!(await currentUser(c))) return deny(c, 401, "unauthorized", "Sign in first");
  const ref = readRef({ doi: c.req.query("doi"), arxivId: c.req.query("arxivId") });
  const key = ref && oaKey(ref);
  if (!key) return deny(c, 400, "invalid_paper", "Give a DOI or an arXiv number");
  const r = await getPaper(c.env.DB, key);
  if (!r) return c.json({ key, known: false });
  return c.json({ key, known: true, status: r.status, progress: progressOf(r), source: r.source, license: r.license, title: r.title, reason: r.reason, permissive: isPermissiveLicense(r.license) });
});

/**
 * "Ask this paper", for any open-access paper. One stream:
 *   ingest  -> only while the paper is being read (from the shared index if it is already there: nothing to wait for), with its progress;
 *   paper   -> what the answer is made from: the full text (and from where, under which licence) or, when that cannot be read, the abstract alone, with the reason;
 *   stage, sources, delta, answer -> as for a question about a paper of your own, every claim tied to a quote that was checked against the text.
 * Nothing about the person is added to the shared index, and nothing is stored here: the answer goes to the browser, which keeps it.
 */
oaRoutes.post("/ask", async (c) => {
  if (!sameOrigin(c)) return deny(c, 403, "forbidden", "Cross-origin request blocked");
  const user = await currentUser(c);
  if (!user) return deny(c, 401, "unauthorized", "Sign in to ask a paper");
  const body = (await c.req.json().catch(() => null)) as { question?: unknown; abstract?: unknown } | null;
  const ref = readRef(body);
  const key = ref && oaKey(ref);
  if (!ref || !key) return deny(c, 400, "invalid_paper", "That paper cannot be found by its DOI or arXiv number");
  const question = typeof body?.question === "string" ? body.question.replace(/\s+/g, " ").trim() : "";
  if (question.length < 3) return deny(c, 400, "invalid_question", "Ask a question about the paper");
  if (question.length > MAX_QUESTION_CHARS) return deny(c, 400, "invalid_question", "That question is too long", `Keep it under ${MAX_QUESTION_CHARS} characters.`);
  // an abstract the browser already has (the card shows it): used only if the full text cannot be read, for this person's answer alone, never stored
  const clientAbstract = typeof body?.abstract === "string" ? body.abstract.replace(/\s+/g, " ").trim().slice(0, MAX_OA_ABSTRACT_CHARS) : "";
  const embed = embedderFor(c.env as never);
  if (!embed) return deny(c, 503, "ai_unavailable", "Answering is unavailable right now");

  const abort = new AbortController();
  return sseStream<OaAskEvent>(c, { terminal: ["answer", "error"], fallback: { type: "error", code: "internal_error", title: "Something went wrong" }, abort }, async (s) => {
    const { send } = s;
    const db = c.env.DB;
    const err = (code: string, title: string, detail?: string) => send({ type: "error", code, title, ...(detail ? { detail } : {}) });
    try {
      let row = await getPaper(db, key);
      if (isWorking(row) && (await failIfStale(db, key, Date.now()))) row = await getPaper(db, key);

      // a paper new to the index: it counts against the person's day (a paper that is already there is free)
      let startedByMe = false;
      if (!row) {
        // two limits: the person's own, and one for the whole service (an emergency brake); a refused person is answered from the abstract
        const everyone = await takeDaily(db, EVERYONE, today(), OA_NEW_PAPERS_PER_DAY_ALL);
        const mine = everyone && (await takeDaily(db, user.id, today(), OA_NEW_PAPERS_PER_DAY));
        if (everyone && !mine) await refundDaily(db, EVERYONE, today()); // the first was counted and the second refused: give it back
        if (mine) {
          if (!(await createPaper(db, key, ref))) await Promise.all([refundDaily(db, user.id, today()), refundDaily(db, EVERYONE, today())]);
          row = await getPaper(db, key);
        } else {
          return void (await answerFromAbstract(c, s, { key, ref, reason: "daily_cap", clientAbstract, question, embed, subject: user.id, abort }));
        }
      }
      if (!row) return void (await err("internal_error", "Something went wrong"));

      // start the reading, or join the one that is going
      if (row.status === "queued" || row.status === "failed") {
        const attempt = await claimAttempt(db, key, Date.now());
        if (attempt !== null) {
          const id = instanceId(await keyHash(key), attempt);
          try {
            await c.env.OA_INGEST.create({ id, params: { key, attempt } });
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
      const deadline = Date.now() + OA_WAIT_MS;
      while (isWorking(row) && !s.gone) {
        const state = `${row!.status}:${row!.done_chunks}`;
        if (state !== last) {
          last = state;
          peak = Math.max(peak, progressOf(row!));
          await send({ type: "ingest", status: row!.status, progress: peak, ...(row!.source ? { source: row!.source } : {}), started: startedByMe });
        }
        if (Date.now() > deadline) return void (await err("still_reading", "This paper is still being read", "It keeps going without you. Ask again in a minute."));
        await sleep(c.env.ENABLE_DEV_ROUTES === "1" ? 150 : 800);
        row = (await getPaper(db, key)) ?? row;
        if (isWorking(row) && (await failIfStale(db, key, Date.now()))) row = await getPaper(db, key);
      }
      if (s.gone || !row) return;

      if (row.status !== "ready") {
        await send({ type: "ingest", status: row.status, progress: peak });
        return void (await answerFromAbstract(c, s, { key, ref, reason: (row.reason ?? "internal") as OaReason, title: row.title, clientAbstract, question, embed, subject: user.id, abort }));
      }
      await send({ type: "ingest", status: "ready", progress: 1, ...(row.source ? { source: row.source } : {}) });
      await send({ type: "paper", key, title: row.title, source: (row.source ?? "pdf") as OaSource, license: row.license, permissive: isPermissiveLicense(row.license) });
      const chunks = await readyChunks(db, key);
      await ask(c, s, { chunks, question, embed, subject: user.id, abort });
    } catch (e) {
      if (s.gone) return;
      const d = describeAskError(e);
      if (!d) console.error(JSON.stringify({ level: "error", msg: "oa_ask_failed", error: e instanceof Error ? e.name : "unknown" }));
      await err(d?.code ?? "internal_error", d?.title ?? "Something went wrong", d?.detail);
    }
  });
});

type Session = Parameters<Parameters<typeof sseStream<OaAskEvent>>[2]>[0];
type Ctx = Context<Env>;
type AskArgs = { /** what the answer is made from: the paper's text, or only its abstract (counted apart) */ basis?: "abstract"; chunks: StoredChunk[]; question: string; embed: NonNullable<ReturnType<typeof embedderFor>>; subject: string; abort: AbortController };

/** The question over the passages: the same code as for a paper of your own, so the same checks. */
async function ask(c: Ctx, s: Session, a: AskArgs): Promise<void> {
  const stream = streamFor(c.env as never, a.subject, a.abort.signal);
  if (!stream) return void (await s.send({ type: "error", code: "ai_unavailable", title: "Answering is unavailable right now" }));
  const topK = c.env.ENABLE_DEV_ROUTES === "1" && Number.isInteger(Number(c.env.QA_TOP_K)) && Number(c.env.QA_TOP_K) >= 1 ? Number(c.env.QA_TOP_K) : undefined;
  // Only with the local dev switch (and not the stand-ins): print what the model said and was shown, to tune prompts. Never in production.
  const onRaw = c.env.ENABLE_DEV_ROUTES === "1" && c.env.QA_STUB !== "1" ? (raw: unknown, ex: { idx: number; section?: string; text: string }[]) => console.log(JSON.stringify({ msg: "oa_debug", raw, excerpts: ex.map((e) => ({ idx: e.idx, section: e.section, text: e.text })) })) : undefined;
  const answer = await answerQuestionStream({ question: a.question, chunks: a.chunks, embed: a.embed, stream, meta: { id: crypto.randomUUID().replace(/-/g, "").slice(0, 20), createdAt: Date.now() }, emit: s.send, topK, onRaw });
  if (s.gone) return;
  await countOutcome(c.env.DB, a.basis === "abstract" ? "oa_ask_abstract" : "oa_ask", askOutcome(answer));
  await s.send({ type: "answer", answer });
}

/**
 * The full text cannot be read (not open access, blocked, scanned, too long ...): the question is answered from the abstract alone, and the screen says so. The abstract is
 * what the services give for the DOI or arXiv number; if they give none, the one the browser sent (the card shows it) is used. With neither there is nothing to answer from.
 */
async function answerFromAbstract(c: Ctx, s: Session, a: { key: string; ref: OaRef; reason: OaReason; title?: string | null; clientAbstract: string; question: string; embed: AskArgs["embed"]; subject: string; abort: AbortController; notice?: "daily_cap" }): Promise<void> {
  const deps = sourceDepsFor(c.env as never);
  let title = a.title ?? null;
  let abstract = "";
  if (a.ref.doi) {
    const rec = await lookupByDoi(a.ref.doi, deps).catch(() => null);
    abstract = rec?.abstract ?? "";
    title = title ?? rec?.title ?? null;
  }
  if (!abstract && a.ref.doi) {
    // Europe PMC knows the abstracts of biomedical papers only; OpenAlex knows most fields
    const rec = await lookupOpenAlexAbstract(a.ref.doi, deps).catch(() => null);
    abstract = rec?.abstract ?? "";
    title = title ?? rec?.title ?? null;
  }
  if (!abstract && a.ref.arxivId) {
    const meta = await fetchArxivMeta(a.ref.arxivId, deps).catch(() => null);
    abstract = meta?.abstract ?? "";
    title = title ?? meta?.title ?? null;
  }
  abstract = abstract || a.clientAbstract;
  if (abstract.length < 40) {
    return void (await s.send({ type: "error", code: "no_text", title: "There is nothing to read for this paper", detail: `${OA_UNREADABLE_TEXT[a.reason]} No abstract could be found either, so there is nothing to answer from. If you have the PDF, add it to My Workspace and ask there.` }));
  }
  await s.send({ type: "paper", key: a.key, title, source: "abstract", license: null, permissive: false, reason: a.reason });
  const chunks: StoredChunk[] = [{ idx: 1000, page: 1, section: "Abstract", text: abstract.slice(0, MAX_OA_ABSTRACT_CHARS), embedding: null }];
  await ask(c, s, { basis: "abstract", chunks, question: a.question, embed: a.embed, subject: a.subject, abort: a.abort });
}

