import { Hono } from "hono";
import {
  LITSCAN_LANGUAGES,
  LITSCAN_MAX_SHARES,
  LITSCAN_PER_DAY,
  cleanLitscanTopic,
  detectLanguage,
  estimateScanTokens,
  isSearchScope,
  type LitscanEvent,
  type LitscanLanguage,
  type LitscanListItem,
  type LitscanPublic,
  type LitscanPlan,
  type LitscanSnapshot,
} from "@scholar/shared";
import { requireUser, type Door } from "../auth/service";
import { readJson } from "../platform/http/body";
import { problemFor } from "../platform/llm/failure";
import { allowanceOf } from "../platform/llm";
import { sseStream } from "../sse";
import { depsOf } from "../platform/deps";
import { PROFILES, modelFor } from "../platform/llm/profiles";
import { ScanPlanError, planScan, sanitizeApproved } from "./plan";
import { createShare, publicScan, revokeShare, shareOf } from "./share";
import { fromSqliteTime } from "../library/validate";
import { type ScanRow, createScan, deleteScan, endScan, failIfStale, getScan, listScans, partsOf, refundScan, runningScan, snapshotOf, takeScan, tickOf } from "./store";
import { deny } from "../problem";
import type { HonoEnv } from "../platform/env";
import { devOptions } from "../platform/dev";

export const litscanRoutes = new Hono<HonoEnv>();


const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const today = () => new Date().toISOString().slice(0, 10);

/** The language the answers use: the person's choice, or (auto) the language the topic is written in; a language we do not write in becomes English. */
function resolveLanguage(choice: unknown, topic: string): LitscanLanguage {
  if (typeof choice === "string" && (LITSCAN_LANGUAGES as readonly string[]).includes(choice)) return choice as LitscanLanguage;
  const detected = detectLanguage(topic);
  return detected === "hi" || detected === "hinglish" ? detected : "en";
}

/** Every call is a signed-in person's; the ones that spend the allowance on the topic also need the privacy note read (the topic is the person's own text). */
const SCANNER: Door = { signIn: "Sign in to scan the literature" };
const SCANNER_TOPIC: Door = { ...SCANNER, ack: { title: "Please read how your topics are handled first", detail: "A short note appears before your first scan." } };
/** A scan of this person's, named by the path (an id of the wrong shape names none). */
const OWN_SCAN: Door<ScanRow> = {
  ...SCANNER,
  owns: { find: (c, userId) => (ID.test(c.req.param("id") ?? "") ? getScan(c.env.DB, c.req.param("id")!, userId) : Promise.resolve(null)), missing: "That scan does not exist" },
};

/* ---------------------------------------------------------------- plan */

/**
 * The topic goes to the private model, which proposes the sub-questions; nothing is stored. The person reads and edits them (and the English search words, which are all that reaches the public
 * paper indexes) before anything is searched, and sees what the scan will use of today's allowance.
 */
litscanRoutes.post("/plan", async (c) => {
  const got = await requireUser(c, SCANNER_TOPIC);
  if (got instanceof Response) return got;
  const { user } = got;
  const sent = await readJson(c, 20_000);
  if (sent.tooLarge) return deny(c, 413, "too_large", "That is too much text");
  const body = sent.value as { topic?: unknown; language?: unknown } | null;
  const topic = cleanLitscanTopic(body?.topic);
  if (!topic) return deny(c, 400, "invalid_topic", "Describe the topic in a sentence or two", "Between 8 and 400 characters.");
  const language = resolveLanguage(body?.language, topic);

  const allowance = await allowanceOf(c.env.DB, user.id, c.env);
  try {
    const { items } = await planScan({ topic, language, complete: modelFor(depsOf(c), PROFILES.litscanPlan, user.id) });
    return c.json<{ plan: LitscanPlan }>({ plan: { topic, language, items, allowance: { limit: allowance.limit, used: allowance.used, estimate: estimateScanTokens(items.length) } } });
  } catch (e) {
    if (e instanceof ScanPlanError) return deny(c, 502, "plan_failed", "We could not split this into sub-questions", "Try describing the topic with a few more words.");
    const p = problemFor(e, {
      quota: { status: 429, code: "quota", title: "You have used today's AI allowance", detail: (e) => e.message },
      noRoute: { status: 503, code: "ai_unavailable", title: "Planning is unavailable right now" },
      failed: { status: 502, code: "ai_failed", title: "The AI service could not read the topic just now", detail: "Please try again in a moment." },
      log: "litscan_plan_failed",
    });
    if (p) return deny(c, p.status, p.code, p.title, p.detail);
    throw e;
  }
});

/* ---------------------------------------------------------------- start */

/** Starts the scan the person approved. One at a time, a few a day, and only if today's allowance covers what it is expected to use. */
litscanRoutes.post("/", async (c) => {
  const got = await requireUser(c, SCANNER_TOPIC);
  if (got instanceof Response) return got;
  const { user } = got;
  const sent = await readJson(c, 20_000);
  if (sent.tooLarge) return deny(c, 413, "too_large", "That is too much text");
  const body = sent.value as { topic?: unknown; language?: unknown; items?: unknown; scope?: unknown; fromYear?: unknown } | null;
  const topic = cleanLitscanTopic(body?.topic);
  const items = sanitizeApproved(body?.items);
  if (!topic || !items) return deny(c, 400, "invalid_plan", "The plan needs a topic and two to six themes", "Each theme needs its question and some search words.");
  // where to search: the regular sources, or only Indian ones (an unknown value is refused, not quietly widened)
  if (body?.scope !== undefined && !isSearchScope(body.scope)) return deny(c, 400, "invalid_scope", "That search scope is not available");
  const scope = isSearchScope(body?.scope) ? body.scope : "all";
  // the earliest year to read: a whole year from 1900 to this one, or none (anything else is refused, not repaired)
  const fromYear = body?.fromYear === undefined || body.fromYear === null ? null : body.fromYear;
  if (fromYear !== null && !(typeof fromYear === "number" && Number.isInteger(fromYear) && fromYear >= 1900 && fromYear <= new Date().getUTCFullYear())) return deny(c, 400, "invalid_since_year", "That year is not available", "fromYear must be a whole year from 1900 to this year.");
  const language = resolveLanguage(body?.language, topic);

  const running = await runningScan(c.env.DB, user.id);
  if (running) return deny(c, 409, "scan_running", "A scan is already running", "Wait for it to finish, or cancel it.", { id: running });

  const estimate = estimateScanTokens(items.length);
  const { left } = await allowanceOf(c.env.DB, user.id, c.env);
  if (left < estimate) {
    return deny(c, 429, "quota", "Today's AI allowance is not enough for this scan", `This scan is expected to use about ${estimate.toLocaleString("en")} tokens and you have ${Math.max(0, left).toLocaleString("en")} left. It comes back tomorrow; fewer sub-questions need less.`);
  }
  const day = today();
  if (!(await takeScan(c.env.DB, user.id, day, LITSCAN_PER_DAY))) return deny(c, 429, "scan_limit", `You have started ${LITSCAN_PER_DAY} scans today`, "That is the most for one day. It resets at midnight UTC.");

  const id = crypto.randomUUID();
  try {
    await createScan(c.env.DB, { id, userId: user.id, topic, language, items, estimate, scope, fromYear });
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
  const got = await requireUser(c, SCANNER);
  if (got instanceof Response) return got;
  return c.json<{ scans: LitscanListItem[] }>({ scans: await listScans(c.env.DB, got.user.id) });
});

/**
 * What anyone with a shared link may read. No sign-in: the token is the credential, like any shared link. A wrong, expired or turned-off link is one plain 404 (the three look the same). Not indexed by
 * search engines (the page that shows it says so too: apps/web/public/_headers).
 */
litscanRoutes.get("/shared/:token", async (c) => {
  c.header("X-Robots-Tag", "noindex, nofollow");
  const scan = await publicScan(c.env.DB, c.req.param("token"));
  if (!scan) return deny(c, 404, "not_found", "This link does not work", "It was turned off, or the scan was removed after a day.");
  return c.json<{ scan: LitscanPublic }>({ scan });
});

litscanRoutes.get("/:id", async (c) => {
  const got = await requireUser(c, SCANNER);
  if (got instanceof Response) return got;
  const id = c.req.param("id");
  if (!ID.test(id)) return deny(c, 404, "not_found", "That scan does not exist");
  let row = await getScan(c.env.DB, id, got.user.id);
  if (!row) return deny(c, 404, "not_found", "That scan does not exist", "Scans are kept for a day.");
  if (row.state === "running" && (await failIfStale(c.env.DB, id))) row = (await getScan(c.env.DB, id, got.user.id)) ?? row;
  return c.json<{ scan: LitscanSnapshot }>({ scan: { ...(await snapshotOf(c.env.DB, row)), share: await shareOf(c.env.DB, id) } });
});

/**
 * The scan as a stream: first how many sub-questions are finished, then the stored events after `after` (all of them when it is 0), then new ones as they happen, until the scan ends.
 * A page that was closed asks again with the last event it saw. The stream is a view: everything in it is in the database, so a lost connection loses nothing.
 */
/** The wait between reads of a stream that sees nothing new: the first ones are quick, then it settles. */
const STREAM_POLLS_MS = [1_200, 1_200, 2_500, 4_000];

litscanRoutes.get("/:id/events", async (c) => {
  const got = await requireUser(c, SCANNER);
  if (got instanceof Response) return got;
  const id = c.req.param("id");
  if (!ID.test(id)) return deny(c, 404, "not_found", "That scan does not exist");
  const row = await getScan(c.env.DB, id, got.user.id);
  if (!row) return deny(c, 404, "not_found", "That scan does not exist", "Scans are kept for a day.");
  const after = Math.max(0, Math.trunc(Number(c.req.query("after"))) || 0);
  const total = (JSON.parse(row.plan) as unknown[]).length;
  const db = c.env.DB;
  // a quiet scan is asked less and less often (a scan is a minute or two of work; the first answers come fast, the long waits do not need a read a second)
  const polls = devOptions(c.env).scanPollsMs ?? STREAM_POLLS_MS;

  return sseStream<LitscanEvent>(c, { terminal: ["done", "error"], fallback: { type: "error", code: "internal_error", title: "Something went wrong" } }, async (s) => {
    const send = s.send;
    try {
      const before = await db.prepare("SELECT COUNT(*) AS n FROM litscan_events WHERE scan_id = ?1 AND type = 'part' AND seq <= ?2").bind(id, after).first<{ n: number }>();
      let done = before?.n ?? 0;
      let last = after;
      let quiet = 0;
      await send({ type: "progress", done, total });
      for (let round = 0; !s.gone; round++) {
        const { state, events, more } = await tickOf(db, id, last);
        if (!state) return void (await send({ type: "error", code: "gone", title: "That scan no longer exists" }));
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
        if (more) continue;
        quiet = events.length === 0 ? quiet + 1 : 0;
        if (round % 8 === 7) await failIfStale(db, id);
        await new Promise((r) => setTimeout(r, polls[Math.min(quiet, polls.length - 1)]));
      }
    } catch (e) {
      console.error(JSON.stringify({ level: "error", msg: "litscan_stream_failed", error: e instanceof Error ? e.name : "unknown" }));
      await send({ type: "error", code: "internal_error", title: "Something went wrong" });
    }
  });
});

/* ---------------------------------------------------------------- stop, remove */

litscanRoutes.post("/:id/cancel", async (c) => {
  const got = await requireUser(c, OWN_SCAN);
  if (got instanceof Response) return got;
  const { row } = got;
  const id = row.id;
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

/** Turns on a read-only link for a scan that has ended (asking again gives the same link). The person sees what it shows before they press: topic, sub-questions, report. */
litscanRoutes.post("/:id/share", async (c) => {
  const got = await requireUser(c, OWN_SCAN);
  if (got instanceof Response) return got;
  const { row } = got;
  const r = await createShare(c.env.DB, row, got.user.id);
  if (!r.ok) {
    return r.reason === "running"
      ? deny(c, 409, "scan_running", "A scan can be shared when it has finished")
      : deny(c, 429, "share_limit", `You have ${LITSCAN_MAX_SHARES} scans shared already`, "Stop sharing one of them first.");
  }
  return c.json({ token: r.token, expiresAt: new Date(fromSqliteTime(row.expires_at)).toISOString() }, 201);
});

litscanRoutes.delete("/:id/share", async (c) => {
  const got = await requireUser(c, OWN_SCAN);
  if (got instanceof Response) return got;
  const id = got.row.id;
  await revokeShare(c.env.DB, id, got.user.id);
  return c.json({ ok: true });
});

litscanRoutes.delete("/:id", async (c) => {
  const got = await requireUser(c, OWN_SCAN);
  if (got instanceof Response) return got;
  const { row } = got;
  const id = row.id;
  if (row.state === "running") await endScan(c.env.DB, id, "canceled");
  await deleteScan(c.env.DB, id, got.user.id);
  try {
    await (await c.env.LITSCAN.get(`litscan-${id}`)).terminate();
  } catch {
    /* already finished */
  }
  return c.json({ ok: true });
});
