import { Hono, type Context } from "hono";
import { FEEDBACK_KINDS, FEEDBACK_PROBLEMS, MAX_FEEDBACK_NOTE_CHARS, MAX_FEEDBACK_PER_DAY, MAX_KEYWORD_QUERIES, MAX_KEYWORD_QUERY_CHARS, MAX_SEMANTIC_QUERY_CHARS, type FeedbackKind } from "@scholar/shared";
import { currentUser, sameOrigin } from "../auth/http";
import { scrubText } from "../idea/plan";

type Env = { Bindings: { DB: D1Database } };
export const feedbackRoutes = new Hono<Env>();

feedbackRoutes.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

const deny = (c: Context<Env>, status: 400 | 401 | 403 | 404 | 429, type: string, title: string, detail?: string) => c.json({ type, title, ...(detail ? { detail } : {}) }, status);
const randomId = () => [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, "0")).join("");
const REF_STATUSES = new Set(["verified", "mismatch", "not_found", "unverifiable", "unparsed"]);
const MAX_CONTEXT_CHARS = 20_000;

/**
 * "Report a problem". The researcher chooses to send this, and the page says what is sent. For an answer the question and answer are read back
 * from the researcher's own record (so nobody can file someone else's text, or invent an answer), and only ids come from the browser.
 */
feedbackRoutes.post("/", async (c) => {
  if (!sameOrigin(c)) return deny(c, 403, "forbidden", "Cross-origin request blocked");
  const user = await currentUser(c);
  if (!user) return deny(c, 401, "unauthorized", "Sign in to send a report");

  const b = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const kind = b?.kind as FeedbackKind;
  if (!b || !FEEDBACK_KINDS.includes(kind)) return deny(c, 400, "invalid_report", "Choose what you are reporting");
  const problem = typeof b.problem === "string" ? b.problem : "";
  if (!FEEDBACK_PROBLEMS[kind].some((p) => p.id === problem)) return deny(c, 400, "invalid_report", "Choose what went wrong");
  const note = scrubText(b.note, MAX_FEEDBACK_NOTE_CHARS) || null;

  const today = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM feedback WHERE user_id = ?1 AND created_at >= date('now')").bind(user.id).first<{ n: number }>();
  if ((today?.n ?? 0) >= MAX_FEEDBACK_PER_DAY) return deny(c, 429, "too_many", "You have sent a lot of reports today", "Thank you. Please try again tomorrow.");

  let context: unknown;
  if (kind === "answer") {
    const docId = typeof b.docId === "string" ? b.docId : "";
    const answerId = typeof b.answerId === "string" ? b.answerId : "";
    const row = await c.env.DB
      .prepare("SELECT q.question, q.answer, d.title FROM doc_qa q JOIN documents d ON d.id = q.doc_id WHERE q.id = ?1 AND q.doc_id = ?2 AND d.user_id = ?3")
      .bind(answerId, docId, user.id)
      .first<{ question: string; answer: string; title: string }>();
    if (!row) return deny(c, 404, "not_found", "That answer was not found");
    context = { paper: row.title, question: row.question, answer: JSON.parse(row.answer) };
  } else if (kind === "reference") {
    const reference = scrubText(b.reference, 1000);
    const status = typeof b.status === "string" && REF_STATUSES.has(b.status) ? b.status : "unknown";
    if (reference.length < 10) return deny(c, 400, "invalid_report", "The reference text is missing");
    context = { reference, status, reason: scrubText(b.reason, 500) };
  } else if (kind === "idea") {
    const queries = (Array.isArray(b.keywordQueries) ? b.keywordQueries : []).slice(0, MAX_KEYWORD_QUERIES).map((q) => scrubText(q, MAX_KEYWORD_QUERY_CHARS)).filter(Boolean);
    context = { semanticQuery: scrubText(b.semanticQuery, MAX_SEMANTIC_QUERY_CHARS), keywordQueries: queries };
  } else {
    context = {};
  }
  // A cut-off JSON text would not parse later, so an oversized context is replaced, never truncated.
  const json = JSON.stringify(context);
  const stored = json.length > MAX_CONTEXT_CHARS ? JSON.stringify({ truncated: true }) : json;

  const id = randomId();
  await c.env.DB.prepare("INSERT INTO feedback (id, user_id, kind, problem, note, context) VALUES (?1, ?2, ?3, ?4, ?5, ?6)").bind(id, user.id, kind, problem, note, stored).run();
  return c.json({ ok: true, id }, 201);
});
