// What every API suite (scripts/*-e2e.mjs) and every browser suite (e2e/*.mjs, through e2e/lib/browser.mjs) shares, written once (docs/design/untangle.md, F24):
//   - where the Worker and the fake identity provider are (INTEGRATION_PORT, INTEGRATION_IDP_PORT; APP when a runner names the Worker's address itself);
//   - ok() and the exit code;
//   - signing a fake person in (with the privacy note read, unless a suite says otherwise);
//   - reading a server-sent-event stream with the page's own reader (apps/web/src/lib/sse.ts);
//   - the dev-only SQL route; waiting for something to become true;
//   - where each switch stands in this run, read from the registry (apps/api/src/platform/switches.ts) out of the Worker's own variables, which scripts/integration.mjs passes in INTEGRATION_VARS.
// A suite then says only what it checks. Node loads the two TypeScript files as they are (type stripping; neither imports anything).
import { startFakeIdp } from "../fake-idp.mjs";
import { createClient } from "../test-client.mjs";
import { readSse as readSseOfThePage } from "../../../web/src/lib/sse.ts";
import { SWITCHES, killSwitch, positionOfVariable } from "../../src/platform/switches.ts";

export { createClient };

/** The Worker's port (scripts/integration.mjs starts it there) and the fake identity provider's: one variable each, so that two runs can go side by side on other ports. */
export const WORKER_PORT = Number(process.env.INTEGRATION_PORT ?? 8788);
export const IDP_PORT = Number(process.env.INTEGRATION_IDP_PORT ?? 9911);
/** The Worker's address. A browser suite run by hand may still name it as its first argument (e2e/lib/browser.mjs). */
export const APP = process.env.APP ?? `http://localhost:${WORKER_PORT}`;
/** The address the Worker is told to sign in at (DEV_IDP_URL); ORCID's is under /orcid. */
export const IDP_URL = `http://localhost:${IDP_PORT}`;
/** The client secret the fake provider demands (scripts/fake-idp.mjs) and the Worker is started with (GOOGLE_CLIENT_SECRET, ORCID_CLIENT_SECRET). */
export const IDP_SECRET = "dev-secret";

/* ---------- checks ---------- */

let failures = 0;
/** One check: prints "  ok  " or " FAIL " and the message, and counts a failure. */
export const ok = (cond, msg) => {
  console.log(`${cond ? "  ok  " : " FAIL "} ${msg}`);
  if (!cond) failures++;
};
/** How many checks failed so far. */
export const failed = () => failures;
/** Counts a failure that is not a check (an unexpected error a suite caught). */
export const countFailure = () => {
  failures++;
};
/** Prints the suite's last line and exits: 0 when nothing failed. `whenFailed` gets the number of failures. */
export function finish(whenPassed, whenFailed = (n) => `${n} FAILED`) {
  console.log(failures ? `\n${whenFailed(failures)}` : `\n${whenPassed}`);
  process.exit(failures ? 1 : 0);
}

/* ---------- waiting ---------- */

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * Asks `fn` every `every` ms until it gives something truthy, and returns that; after `ms` it returns false, or throws "timed out waiting for <what>" when `what` is given.
 */
export async function until(fn, { ms = 15_000, every = 250, what } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await fn();
    if (v) return v;
    await sleep(every);
  }
  if (what !== undefined) throw new Error(`timed out waiting for ${what}`);
  return false;
}

/* ---------- the fake identity provider and signing in ---------- */

/** Starts the fake identity provider on this run's port. */
export const startIdp = () => startFakeIdp(IDP_PORT);

/**
 * Signs a fake person in through Google's way in (the fake provider), and reads the privacy note as a person clicking "I understand" does, unless `ack` is false. Returns the client (cookie jar).
 */
export async function signIn(idp, { sub, email, name, emailVerified = true, ack = true } = {}) {
  idp.setUser({ sub, email, email_verified: emailVerified, name });
  const c = createClient(APP);
  await c.follow(`${APP}/api/v1/auth/google/start`);
  if (ack) await c.ack();
  return c;
}
/** The same, as most suites write it: `login(sub, email, name)`. */
export const loginWith = (idp, defaults = {}) => (sub, email, name, options = {}) => signIn(idp, { sub, email, name, ...defaults, ...options });

/* ---------- the dev-only SQL route ---------- */

/**
 * Runs statements through the Worker's dev-only route (/api/v1/dev/sql; ENABLE_DEV_ROUTES=1) and returns `results` (one array of rows per statement), or null when the answer had none.
 * `strict` throws on an answer that is not 200, with its text; `base` is the Worker's address when a suite was given another one (a browser suite's argument).
 */
export async function sqlResults(statements, { strict = false, base = APP } = {}) {
  const res = await fetch(`${base}/api/v1/dev/sql`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sql: statements }) });
  if (strict && !res.ok) throw new Error(`sql failed: HTTP ${res.status} ${await res.text()}`);
  return (await res.json()).results;
}

/* ---------- server-sent events ---------- */

/**
 * Reads a server-sent-event stream with the page's own reader (apps/web/src/lib/sse.ts: a blank line ends an event, its `data:` line is JSON). Every event goes to `events`, unless `keep(e)` says
 * false. `stopWhen(e, events)` true after an event stops reading there: the stream is cancelled, or `ctl` (the request's AbortController) is aborted, as the Stop button does.
 * Returns the events and whether it was stopped.
 */
export async function readEvents(res, { keep, stopWhen, ctl } = {}) {
  const events = [];
  const stop = ctl ?? new AbortController();
  let stopped = false;
  try {
    await readSseOfThePage(
      res,
      (e) => {
        if (stopped) return;
        if (keep && !keep(e)) return;
        events.push(e);
        if (stopWhen?.(e, events)) {
          stopped = true;
          stop.abort();
        }
      },
      stop.signal,
    );
  } catch (e) {
    if (!(stopped && e?.name === "AbortError")) throw e;
  }
  return { events, stopped };
}

/* ---------- where the switches stand ---------- */

/**
 * The Worker's variables in this run, as scripts/integration.mjs passes them: "NAME:value,NAME:value" (the committed vars of wrangler.jsonc with the run's own on top).
 * A suite run by hand, without the runner, sees none: every gate off, every kill switch on.
 */
export const workerVars = Object.fromEntries(
  (process.env.INTEGRATION_VARS ?? "")
    .split(",")
    .filter(Boolean)
    .map((p) => [p.slice(0, p.indexOf(":")), p.slice(p.indexOf(":") + 1)]),
);

/** Where a switch stands in this run, read as the Worker reads its variable (the registry's own readers; no KV). A name the registry does not know throws. */
export function position(name, vars = workerVars) {
  const spec = SWITCHES[name];
  if (!spec) throw new Error(`no switch named ${name} in apps/api/src/platform/switches.ts`);
  if (spec.kind === "kill") return killSwitch(vars, name);
  const p = spec.positions;
  return positionOfVariable(vars[name], p.includes("core"), p.includes("writer"), p.includes("beta")).position;
}
/** True when the switch stands at one of `positions` in this run. */
export const at = (name, ...positions) => positions.includes(position(name));
