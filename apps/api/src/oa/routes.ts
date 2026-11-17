import { Hono } from "hono";
import { MAX_OA_ABSTRACT_CHARS, MAX_QUESTION_CHARS, oaKey, type OaAskEvent } from "@scholar/shared";
import { requireUser } from "../auth/service";
import { readJson } from "../platform/http/body";
import { depsOf } from "../platform/deps";
import { sseStream } from "../sse";
import { isPermissiveLicense } from "./jats";
import { getPaper } from "./store";
import { oaService, progressOf, readRef } from "./service";
import { deny } from "../problem";
import type { HonoEnv } from "../platform/env";


export const oaRoutes = new Hono<HonoEnv>();


/**
 * The state of a paper in the shared index, for the screen (a signed-in person; the index is public data: titles, states, counts).
 */
oaRoutes.get("/status", async (c) => {
  const got = await requireUser(c, { signIn: "Sign in first" });
  if (got instanceof Response) return got;
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
  const got = await requireUser(c, { signIn: "Sign in to ask a paper" });
  if (got instanceof Response) return got;
  const { user } = got;
  const body = (await readJson(c)) as { question?: unknown; abstract?: unknown } | null;
  const ref = readRef(body);
  const key = ref && oaKey(ref);
  if (!ref || !key) return deny(c, 400, "invalid_paper", "That paper cannot be found by its DOI or arXiv number");
  const question = typeof body?.question === "string" ? body.question.replace(/\s+/g, " ").trim() : "";
  if (question.length < 3) return deny(c, 400, "invalid_question", "Ask a question about the paper");
  if (question.length > MAX_QUESTION_CHARS) return deny(c, 400, "invalid_question", "That question is too long", `Keep it under ${MAX_QUESTION_CHARS} characters.`);
  // an abstract the browser already has (the card shows it): used only if the full text cannot be read, for this person's answer alone, never stored
  const clientAbstract = typeof body?.abstract === "string" ? body.abstract.replace(/\s+/g, " ").trim().slice(0, MAX_OA_ABSTRACT_CHARS) : "";
  const deps = depsOf(c);
  const embed = deps.embedder;
  if (!embed) return deny(c, 503, "ai_unavailable", "Answering is unavailable right now");

  const abort = new AbortController();
  return sseStream<OaAskEvent>(c, { terminal: ["answer", "error"], fallback: { type: "error", code: "internal_error", title: "Something went wrong" }, abort }, (s) =>
    oaService.ask(c.env, { userId: user.id, ref, key, question, clientAbstract, embed, abort, deps }, s),
  );
});
