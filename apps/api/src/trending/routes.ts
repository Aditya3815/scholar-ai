import { Hono } from "hono";
import { isFresh, parseTrending, type TrendingPayload } from "@scholar/shared";
import { emptyPayload } from "@scholar/shared/src/trending";
import { TRENDING_KEYS } from "./store";
import type { EnvPick, HonoEnv } from "../platform/env";
import { killSwitch, lowerByKey } from "../platform/switches";

/**
 * GET /api/v1/home/trending (docs/design/chatview-and-trending.md, T12): the one public file the Home page reads, the same for everyone. Not under /search or /chat, so it is outside their
 * per-minute bucket (it has the general one: ratelimit.ts). Not in the service worker's list (apps/web/public/sw.js). No sign-in, no cookie, nothing about the visitor is read or kept.
 *
 * It only ever reads KV: OpenAlex and arXiv are asked by the job (job.ts), never on this path. What it answers:
 *   - the variable TRENDING set to "off" or "dark" ("dark" is the state after the first hand-made list has been read: the job keeps making the list, nobody is shown it until the line is taken out; "off" is the launch state committed in wrangler.jsonc, with the job stopped too): a file
 *     with `disabled: true` and no chips, without reading KV;
 *   - the KV key `trending:v1:off` present, with any value: the same;
 *   - the file in KV, when the page's own reader accepts it and it is fresh (`isFresh`: before `validUntil`, the weekly pool not older than 14 days);
 *   - anything else (a miss, no KV, a file that is not right, a stale file): a valid, empty file that has already expired, so no page can call it trending;
 *   - a store that throws: the same empty file, but as a 503 with `Cache-Control: no-store` (nothing is to keep a blip; the page ignores an answer that is not OK and keeps its device copy).
 * The page shows no Trending row for any of those. A stale file is never passed on: the server checks what the page checks.
 *
 * The cost of a read: every request is one Worker call and one KV call (the flag and the file are read together, which KV counts as ONE operation toward a Worker's 1,000 per invocation) and, as a
 * bill, up to TWO reads: a bulk read is billed by the keys it reads (kv/platform/limits and kv/platform/pricing, read 4 Nov 2026). The place that serves it keeps what it read for 60 seconds
 * (`cacheTtl`), which is also how long the kill switch takes to reach a place that has just read the file. There is no memo in the isolate and no Cache API: at 10 million reads a month included,
 * a Home page seen a million times is up to a fifth of the allowance (2 million reads), and either would only add a second delay to the kill switch.
 */
export type TrendingRouteEnv = EnvPick<"TRENDING", "CACHE">;

/** What the route answers, for a time, and whether the store could not be read (the answer is then not one to keep). Never throws. */
export async function readTrending(env: TrendingRouteEnv, now: Date): Promise<{ payload: TrendingPayload; storeFailed: boolean }> {
  // "off": the job is stopped too (job.ts) and the route hides the list. "dark": the job runs and makes the list, and the route hides it (the step after the launch state, which wrangler.jsonc
  // commits as "off"). The variable is read trimmed and in any case (platform/switches.ts, its row of SWITCHES).
  if (killSwitch(env, "TRENDING") !== "on") return { payload: emptyPayload(now, true), storeFailed: false };
  const kv = env.CACHE;
  if (!kv) return { payload: emptyPayload(now, false), storeFailed: false };
  let flag: string | null | undefined;
  let text: string | null | undefined;
  try {
    const got = await kv.get([TRENDING_KEYS.off, TRENDING_KEYS.file], { type: "text", cacheTtl: 60 });
    flag = got.get(TRENDING_KEYS.off);
    text = got.get(TRENDING_KEYS.file);
  } catch {
    return { payload: emptyPayload(now, false), storeFailed: true }; // the store is out of reach: nothing to show, and nothing said about why
  }
  if (lowerByKey("TRENDING", "on", flag) !== "on") return { payload: emptyPayload(now, true), storeFailed: false };
  if (text === null || text === undefined) return { payload: emptyPayload(now, false), storeFailed: false };
  let file: TrendingPayload | null = null;
  try {
    file = parseTrending(JSON.parse(text));
  } catch {
    file = null;
  }
  if (!file) {
    console.warn(JSON.stringify({ level: "warn", msg: "trending_file_unreadable" })); // no content: only that it happened
    return { payload: emptyPayload(now, false), storeFailed: false };
  }
  return { payload: isFresh(file, now) ? file : emptyPayload(now, file.disabled), storeFailed: false };
}

export const trendingRoutes = new Hono<HonoEnv>();

trendingRoutes.get("/trending", async (c) => {
  const { payload, storeFailed } = await readTrending(c.env, new Date());
  // A store that could not be read is a 503 that nothing may keep: a 200 with max-age=300 would be held for five minutes after a blip of a second (by the browser, and by anything between with
  // "public"), and the page erases its device copy on an expired list. The page ignores an answer that is not OK and keeps its copy until the copy's own validUntil.
  c.header("Cache-Control", storeFailed ? "no-store" : "public, max-age=300");
  return c.json(payload, storeFailed ? 503 : 200);
});
