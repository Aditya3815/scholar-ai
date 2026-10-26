import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { NOTHING_NOTICE, PARTIAL_NOTICE, cleanChatMessage, type ChatEvent, type ChatNoAnswer, type SearchResponse } from "@scholar/shared";
import { currentUser, sameOrigin } from "../auth/http";
import { cacheStore } from "../cache";
import type { StreamComplete } from "../docs/qa";
import { AllProvidersFailedError, NoRouteError, QuotaError, gatewayFromEnv } from "../llm";
import { runSearch } from "../search";
import type { SearchEnv } from "../search/types";
import type { S2Throttle } from "../s2-throttle";
import { answerFromResults, pickEvidencePapers } from "./answer";
import { stubChatStream, stubSearchFor } from "./stub";

type Bindings = {
  DB: D1Database;
  CACHE?: KVNamespace;
  AI?: Ai;
  S2_THROTTLE: DurableObjectNamespace<S2Throttle>;
  GEMINI_API_KEY?: string;
  CROSSREF_MAILTO: string;
  OPENALEX_API_KEY?: string;
  NCBI_API_KEY?: string;
  S2_API_KEY?: string;
  CORE_API_KEY?: string;
  ENABLE_DEV_ROUTES?: string;
  QA_STUB?: string;
};
type Env = { Bindings: Bindings };
export const chatRoutes = new Hono<Env>();

chatRoutes.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

const deny = (c: Context<Env>, status: 400 | 403, type: string, title: string, detail?: string) => c.json({ type, title, ...(detail ? { detail } : {}) }, status);
const stubbed = (env: Bindings) => env.ENABLE_DEV_ROUTES === "1" && env.QA_STUB === "1";

const searchEnv = (env: Bindings): SearchEnv => ({
  store: cacheStore(env),
  OPENALEX_API_KEY: env.OPENALEX_API_KEY,
  NCBI_API_KEY: env.NCBI_API_KEY,
  S2_API_KEY: env.S2_API_KEY,
  CORE_API_KEY: env.CORE_API_KEY,
  CROSSREF_MAILTO: env.CROSSREF_MAILTO,
  s2Gate: (maxWaitMs) => env.S2_THROTTLE.getByName("global").reserve(maxWaitMs),
});

/** The model, for the person's own message: PRIVATE, so the gateway only uses providers that do not keep or train on it. `abort` stops it when the reader presses Stop or leaves. */
function streamFor(env: Bindings, subject: string, abort: AbortSignal): StreamComplete {
  if (stubbed(env)) return stubChatStream;
  const gateway = gatewayFromEnv(env);
  return async (req, hooks) => {
    const r = await gateway.stream({ task: "qa", sensitivity: "private", subject, system: req.system, user: req.user, schema: req.schema, maxTokens: req.maxTokens, timeoutMs: 60_000, label: req.label }, hooks, abort);
    return { json: r.json, model: r.model };
  };
}

/** Did every place that was asked answer? (A place that was not asked, because it is not in this search, is not counted.) */
const complete = (r: SearchResponse) => Object.values(r.providers).every((p) => p.ok);

/**
 * One message, one stream. In "search" mode: the papers (the first as soon as one source has answered, the list again as each source does), a plain line if a source did
 * not answer, and for a signed-in person a short answer made from the papers with every claim tied to a sentence of an abstract (see answer.ts). The server keeps no chat.
 */
chatRoutes.post("/", async (c) => {
  if (!sameOrigin(c)) return deny(c, 403, "forbidden", "Cross-origin request blocked");
  const body = (await c.req.json().catch(() => null)) as { mode?: unknown; message?: unknown } | null;
  if (!body || body.mode !== "search") return deny(c, 400, "invalid_mode", "That mode is not available yet");
  const query = cleanChatMessage(body.message);
  if (!query) return deny(c, 400, "invalid_message", "Write 2 to 300 characters");
  const user = await currentUser(c);
  const started = Date.now();

  return streamSSE(c, async (sse) => {
    let gone = false;
    const abort = new AbortController();
    sse.onAbort(() => {
      gone = true;
      abort.abort();
    });
    const send = async (e: ChatEvent) => {
      if (!gone) await sse.writeSSE({ event: e.type, data: JSON.stringify(e) }).catch(() => (gone = true));
    };
    const done = (answered: boolean, reason?: ChatNoAnswer) => send({ type: "done", answered, ...(reason ? { reason } : {}), tookMs: Date.now() - started });

    try {
      await send({ type: "understood", mode: "search", query });
      await send({ type: "step", step: "search" });
      const found = stubbed(c.env) ? stubSearchFor(query) : await runSearch(searchEnv(c.env), query, 20, { onSnapshot: (s) => send({ type: "papers", results: s.results, final: false }) });
      if (gone) return;
      await send({ type: "papers", results: found.results, final: true });
      if (!complete(found)) await send({ type: "notice", kind: "partial", text: PARTIAL_NOTICE });
      if (found.results.length === 0) {
        await send({ type: "notice", kind: "nothing", text: NOTHING_NOTICE });
        return void (await done(false));
      }
      if (found.results.some((p) => p.retracted)) await send({ type: "notice", kind: "retracted", text: "At least one paper in this list has been retracted. It is marked, and it was not used for the answer." });
      if (!user) return void (await done(false, "sign_in"));
      const picked = pickEvidencePapers(found.results);
      if (picked.length === 0) return void (await done(false, "no_abstracts"));

      await send({ type: "step", step: "read" });
      let answer;
      try {
        answer = await answerFromResults({ question: query, picked, stream: streamFor(c.env, user.id, abort.signal), emit: send, onRaw: c.env.ENABLE_DEV_ROUTES === "1" ? (raw) => console.log(JSON.stringify({ msg: "chat_debug", raw, shown: picked.map((p) => p.n) })) : undefined });
      } catch (e) {
        if (gone) return;
        if (e instanceof QuotaError) return void (await done(false, "quota"));
        if (e instanceof NoRouteError || e instanceof AllProvidersFailedError) {
          if (e instanceof AllProvidersFailedError) console.error(JSON.stringify({ level: "error", msg: "chat_failed", attempts: e.attempts.map((a) => `${a.provider}:${a.ok ? "ok" : a.error}`) }));
          return void (await done(false, "unavailable"));
        }
        throw e;
      }
      if (gone) return;
      await send({ type: "step", step: "check" });
      await send({ type: "answer", answer: { text: answer.text, citations: answer.citations, grounded: answer.grounded } });
      await done(answer.grounded, answer.grounded ? undefined : answer.enough ? "not_grounded" : "not_answered");
    } catch (e) {
      console.error(JSON.stringify({ level: "error", msg: "chat_stream_failed", error: e instanceof Error ? e.name : "unknown" }));
      await send({ type: "error", code: "internal_error", title: "Something went wrong" });
    }
  });
});
