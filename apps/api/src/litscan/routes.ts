import { Hono, type Context } from "hono";
import {
  LITSCAN_LANGUAGES,
  LITSCAN_PER_DAY,
  PRIVACY_VERSION,
  cleanLitscanTopic,
  detectLanguage,
  estimateScanTokens,
  type LitscanEvent,
  type LitscanLanguage,
  type LitscanListItem,
  type LitscanPlan,
  type LitscanSnapshot,
} from "@scholar/shared";
import { currentUser, sameOrigin } from "../auth/http";
import { d1Ledger } from "../llm/d1";
import { AllProvidersFailedError, NoRouteError, QuotaError } from "../llm";
import { DEFAULT_CONFIG } from "../llm/config";
import { sseStream } from "../sse";
import type { LitscanEnv, LitscanParams } from "./workflow";
import { planModel } from "./model";
import { ScanPlanError, planScan, sanitizeApproved } from "./plan";
import { createScan, deleteScan, endScan, eventsAfter, failIfStale, getScan, listScans, partsOf, refundScan, runningScan, snapshotOf, takeScan } from "./store";

type Bindings = LitscanEnv & { LITSCAN: Workflow<LitscanParams> };
type Env = { Bindings: Bindings };
export const litscanRoutes = new Hono<Env>();

litscanRoutes.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

const deny = (c: Context<Env>, status: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 502 | 503, type: string, title: string, detail?: string, extra?: Record<string, unknown>) =>
  c.json({ type, title, ...(detail ? { detail } : {}), ...extra }, status);

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const today = () => new Date().toISOString().slice(0, 10);

/** The language the answers use: the person's choice, or (auto) the language the topic is written in; a language we do not write in becomes English. */
function resolveLanguage(choice: unknown, topic: string): LitscanLanguage {
  if (typeof choice === "string" && (LITSCAN_LANGUAGES as readonly string[]).includes(choice)) return choice as LitscanLanguage;
  const detected = detectLanguage(topic);
  return detected === "hi" || detected === "hinglish" ? detected : "en";
}

/** The checks every call that spends the person's allowance starts with: signed in, and the privacy note read (the topic is the person's own text). */
async function requireUser(c: Context<Env>) {
  // reading changes nothing (and a page cannot read the answer of another origin); every call that changes something must come from our own pages
  if (c.req.method !== "GET" && !sameOrigin(c)) return { error: deny(c, 403, "forbidden", "Cross-origin request blocked") };
  const user = await currentUser(c);
  if (!user) return { error: deny(c, 401, "unauthorized", "Sign in to scan the literature") };
  return { user };
}
const needsAck = (c: Context<Env>, user: { privacyAck: string | null }) =>
  user.privacyAck === PRIVACY_VERSION ? null : deny(c, 403, "privacy_ack_required", "Please read how your topics are handled first", "A short note appears before your first scan.");

/* ---------------------------------------------------------------- plan */

/**
 * The topic goes to the private model, which proposes the sub-questions; nothing is stored. The person reads and edits them (and the English search words, which are all that reaches the public
 * paper indexes) before anything is searched, and sees what the scan will use of today's allowance.
 */
litscanRoutes.post("/plan", async (c) => {
  const got = await requireUser(c);
  if (got.error) return got.error;
  const { user } = got;
  const ack = needsAck(c, user);
  if (ack) return ack;
  if (Number(c.req.header("content-length") ?? 0) > 20_000) return deny(c, 413, "too_large", "That is too much text");
  const body = (await c.req.json().catch(() => null)) as { topic?: unknown; language?: unknown } | null;
  const topic = cleanLitscanTopic(body?.topic);
  if (!topic) return deny(c, 400, "invalid_topic", "Describe the topic in a sentence or two", "Between 8 and 400 characters.");
  const language = resolveLanguage(body?.language, topic);

  const used = await d1Ledger(c.env.DB).tokensToday(user.id);
  try {
    const { items } = await planScan({ topic, language, complete: planModel(c.env, user.id) });
    return c.json<{ plan: LitscanPlan }>({ plan: { topic, language, items, allowance: { limit: DEFAULT_CONFIG.dailyTokenQuota, used, estimate: estimateScanTokens(items.length) } } });
  } catch (e) {
    if (e instanceof QuotaError) return deny(c, 429, "quota", "You have used today's AI allowance", e.message);
    if (e instanceof NoRouteError) return deny(c, 503, "ai_unavailable", "Planning is unavailable right now");
    if (e instanceof ScanPlanError) return deny(c, 502, "plan_failed", "We could not split this into sub-questions", "Try describing the topic with a few more words.");
    if (e instanceof AllProvidersFailedError) {
      console.error(JSON.stringify({ level: "error", msg: "litscan_plan_failed", attempts: e.attempts.map((a) => `${a.provider}:${a.ok ? "ok" : a.error}`) }));
      return deny(c, 502, "ai_failed", "The AI service could not read the topic just now", "Please try again in a moment.");
    }
    throw e;
  }
});

/* ---------------------------------------------------------------- start */

/** Starts the scan the person approved. One at a time, a few a day, and only if today's allowance covers what it is expected to use. */
litscanRoutes.post("/", async (c) => {
  const got = await requireUser(c);
  if (got.error) return got.error;
  const { user } = got;
  const ack = needsAck(c, user);
  if (ack) return ack;
  if (Number(c.req.header("content-length") ?? 0) > 20_000) return deny(c, 413, "too_large", "That is too much text");
  const body = (await c.req.json().catch(() => null)) as { topic?: unknown; language?: unknown; items?: unknown } | null;
  const topic = cleanLitscanTopic(body?.topic);
  const items = sanitizeApproved(body?.items);
  if (!topic || !items) return deny(c, 400, "invalid_plan", "The plan needs a topic and two to six sub-questions", "Each sub-question needs its question and some search words.");
  const language = resolveLanguage(body?.language, topic);

  const running = await runningScan(c.env.DB, user.id);
  if (running) return deny(c, 409, "scan_running", "A scan is already running", "Wait for it to finish, or cancel it.", { id: running });

  const estimate = estimateScanTokens(items.length);
  const used = await d1Ledger(c.env.DB).tokensToday(user.id);
  if (DEFAULT_CONFIG.dailyTokenQuota - used < estimate) {
    return deny(c, 429, "quota", "Today's AI allowance is not enough for this scan", `This scan is expected to use about ${estimate.toLocaleString("en")} tokens and you have ${Math.max(0, DEFAULT_CONFIG.dailyTokenQuota - used).toLocaleString("en")} left. It comes back tomorrow; fewer sub-questions need less.`);
  }
  const day = today();
  if (!(await takeScan(c.env.DB, user.id, day, LITSCAN_PER_DAY))) return deny(c, 429, "scan_limit", `You have started ${LITSCAN_PER_DAY} scans today`, "That is the most for one day. It resets at midnight UTC.");

  const id = crypto.randomUUID();
  try {
    await createScan(c.env.DB, { id, userId: user.id, topic, language, items, estimate });
    await c.env.LITSCAN.create({ id: `litscan-${id}`, params: { id } });
  } catch (e) {
    console.error(JSON.stringify({ level: "error", msg: "litscan_start_failed", error: e instanceof Error ? e.name : "unknown" }));
    await endScan(c.env.DB, id, "failed").catch(() => {});
    await refundScan(c.env.DB, user.id, day).catch(() => {});
    return deny(c, 503, "start_failed", "The scan could not be started", "Please try again in a moment.");
  }
  return c.json({ id }, 201);
});

/* ---------------------------------------------------------------- read */

litscanRoutes.get("/", async (c) => {
  const got = await requireUser(c);
  if (got.error) return got.error;
  return c.json<{ scans: LitscanListItem[] }>({ scans: await listScans(c.env.DB, got.user.id) });
});

litscanRoutes.get("/:id", async (c) => {
  const got = await requireUser(c);
  if (got.error) return got.error;
  const id = c.req.param("id");
  if (!ID.test(id)) return deny(c, 404, "not_found", "That scan does not exist");
  let row = await getScan(c.env.DB, id, got.user.id);
  if (!row) return deny(c, 404, "not_found", "That scan does not exist", "Scans are kept for a day.");
  if (row.state === "running" && (await failIfStale(c.env.DB, id))) row = (await getScan(c.env.DB, id, got.user.id)) ?? row;
  return c.json<{ scan: LitscanSnapshot }>({ scan: await snapshotOf(c.env.DB, row) });
});

/**
 * The scan as a stream: first how many sub-questions are finished, then the stored events after `after` (all of them when it is 0), then new ones as they happen, until the scan ends.
 * A page that was closed asks again with the last event it saw. The stream is a view: everything in it is in the database, so a lost connection loses nothing.
 */
litscanRoutes.get("/:id/events", async (c) => {
  const got = await requireUser(c);
  if (got.error) return got.error;
  const id = c.req.param("id");
  if (!ID.test(id)) return deny(c, 404, "not_found", "That scan does not exist");
  const row = await getScan(c.env.DB, id, got.user.id);
  if (!row) return deny(c, 404, "not_found", "That scan does not exist", "Scans are kept for a day.");
  const after = Math.max(0, Math.trunc(Number(c.req.query("after"))) || 0);
  const total = (JSON.parse(row.plan) as unknown[]).length;
  const db = c.env.DB;
  const poll = c.env.ENABLE_DEV_ROUTES === "1" ? 400 : 1_200;

  return sseStream<LitscanEvent>(c, { terminal: ["done", "error"], fallback: { type: "error", code: "internal_error", title: "Something went wrong" } }, async (s) => {
    const send = s.send;
    try {
      const before = await db.prepare("SELECT COUNT(*) AS n FROM litscan_events WHERE scan_id = ?1 AND type = 'part' AND seq <= ?2").bind(id, after).first<{ n: number }>();
      let done = before?.n ?? 0;
      let last = after;
      await send({ type: "progress", done, total });
      for (let round = 0; !s.gone; round++) {
        // the state is read before the events: a scan that has ended has all its events by then, so "ended and nothing new" means the last event was already sent
        const state = (await db.prepare("SELECT state FROM litscans WHERE id = ?1").bind(id).first<{ state: string }>())?.state;
        if (!state) return void (await send({ type: "error", code: "gone", title: "That scan no longer exists" }));
        const events = await eventsAfter(db, id, last);
        for (const e of events) {
          await send(e);
          last = e.seq ?? last;
          if (e.type === "part") await send({ type: "progress", done: ++done, total });
          if (e.type === "done") return;
        }
        if (state !== "running" && events.length === 0) {
          const parts = await partsOf(db, id);
          const answered = parts.filter((p) => p.status === "answered").length;
          return void (await send({ type: "done", state: state as "completed" | "canceled" | "failed", answered, gaps: parts.length - answered }));
        }
        if (round % 8 === 7) await failIfStale(db, id);
        await new Promise((r) => setTimeout(r, poll));
      }
    } catch (e) {
      console.error(JSON.stringify({ level: "error", msg: "litscan_stream_failed", error: e instanceof Error ? e.name : "unknown" }));
      await send({ type: "error", code: "internal_error", title: "Something went wrong" });
    }
  });
});

/* ---------------------------------------------------------------- stop, remove */

litscanRoutes.post("/:id/cancel", async (c) => {
  const got = await requireUser(c);
  if (got.error) return got.error;
  const id = c.req.param("id");
  if (!ID.test(id)) return deny(c, 404, "not_found", "That scan does not exist");
  const row = await getScan(c.env.DB, id, got.user.id);
  if (!row) return deny(c, 404, "not_found", "That scan does not exist");
  if (await endScan(c.env.DB, id, "canceled")) {
    // the answers that are still being written stop (what was finished stays); the instance may already be over, which is fine
    try {
      await (await c.env.LITSCAN.get(`litscan-${id}`)).terminate();
    } catch {
      /* already finished, or the engine has forgotten it */
    }
  }
  const now = await getScan(c.env.DB, id, got.user.id);
  return c.json({ state: now?.state ?? "canceled" });
});

litscanRoutes.delete("/:id", async (c) => {
  const got = await requireUser(c);
  if (got.error) return got.error;
  const id = c.req.param("id");
  if (!ID.test(id)) return deny(c, 404, "not_found", "That scan does not exist");
  const row = await getScan(c.env.DB, id, got.user.id);
  if (!row) return deny(c, 404, "not_found", "That scan does not exist");
  if (row.state === "running") await endScan(c.env.DB, id, "canceled");
  await deleteScan(c.env.DB, id, got.user.id);
  try {
    await (await c.env.LITSCAN.get(`litscan-${id}`)).terminate();
  } catch {
    /* already finished */
  }
  return c.json({ ok: true });
});
