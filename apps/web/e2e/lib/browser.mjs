// What every browser suite (e2e/*.mjs) shares, written once on top of the API suites' harness (apps/api/scripts/lib/harness.mjs; docs/design/untangle.md, F24): the Worker's address,
// ok() and the exit code, the fake identity provider on this run's port, and for a page: launching the browser (E2E_BROWSER), axe, the theme, the viewports, the sideways-scroll test, the
// console watcher, a poll inside the page, and the in-page stand-in for the chat's stream. A suite then says only what it checks and its own settings (which errors it allows, what axe
// is to leave out, how long a theme takes to settle).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";
import { APP, ok } from "../../../api/scripts/lib/harness.mjs";

export { ok, failed, countFailure, finish, sleep, until, startIdp, signIn, sqlResults, workerVars, position, at, IDP_PORT, IDP_URL, APP } from "../../../api/scripts/lib/harness.mjs";
export { startFakeIdp } from "../../../api/scripts/fake-idp.mjs";

/** The Worker's address: the first argument when a suite is run by hand with one, else the harness's (APP, or INTEGRATION_PORT). */
export const BASE = process.argv[2] ?? APP;

/** Launches Chrome or Edge (E2E_BROWSER, default msedge; playwright-core downloads no browser), headless. `options` are added to the launch's (e.g. ignoreDefaultArgs). */
export const launch = (options = {}) => chromium.launch({ channel: process.env.E2E_BROWSER ?? "msedge", headless: true, ...options });

/* ---------- viewports ---------- */

/** A desktop window of this size. */
export const desk = (width, height) => ({ viewport: { width, height } });
/** A phone of this size: twice the pixels, touch, a mobile browser. */
export const phone = (width, height) => ({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

/** True when the page cannot be scrolled sideways (the document is no wider than its box, one pixel of rounding allowed). */
export const noSideways = (p) => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

/* ---------- the theme ---------- */

/** Sets the theme the way the page keeps it (data-theme on <html>), then waits `settleMs` for colours to finish moving. */
export async function setTheme(p, theme, settleMs = 0) {
  await p.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
  if (settleMs) await new Promise((r) => setTimeout(r, settleMs));
}
/** Picks a theme with the page's own button ("<label> theme"), then waits `settleMs`. */
export async function clickTheme(page, label, settleMs) {
  await page.getByRole("button", { name: `${label} theme` }).click();
  await page.waitForTimeout(settleMs);
}

/* ---------- errors of the page ---------- */

/** A resource the page asked for and was refused (signed out, not found, a conflict): the browser reports it on the console, and it is no error of the page. */
export const REFUSED = /Failed to load resource.*(401|403|404|409)/;
/** The same, and a request held back (429) or a service not there (503), for the suites that make the page meet them. */
export const REFUSED_OR_BUSY = /Failed to load resource.*(401|403|404|409|429|503)/;

/**
 * Collects the page's uncaught errors and its console errors into `errors`, except a console error that `allowed` matches (each suite says which: REFUSED, REFUSED_OR_BUSY or its own).
 * `onPageError(e)` is told of each uncaught error too.
 */
export function watchPage(p, errors, { allowed = REFUSED, onPageError } = {}) {
  p.on("pageerror", (e) => {
    errors.push("pageerror: " + e.message);
    onPageError?.(e);
  });
  p.on("console", (m) => {
    if (m.type() === "error" && !allowed.test(m.text())) errors.push("console: " + m.text());
  });
}

/* ---------- axe ---------- */

export const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

/**
 * Runs axe (WCAG 2.0 A and AA, 2.1 AA, 2.2 AA) on the page and returns its violations. `inlineCites`: target-size is not reported for a citation button (data-cite), which WCAG 2.2
 * excepts as an inline target and axe cannot tell; `incompleteTargetSize`: target-size results axe could not decide count as violations too.
 */
export async function axeViolations(p, { inlineCites = false, incompleteTargetSize = false } = {}) {
  await p.evaluate(axeSource);
  return p.evaluate(
    async ({ tags, inlineCites, incompleteTargetSize }) => {
      const r = await window.axe.run(document, { runOnly: { type: "tag", values: tags } });
      if (inlineCites) for (const v of r.violations) if (v.id === "target-size") v.nodes = v.nodes.filter((n) => !n.target.join(" ").includes("data-cite"));
      const list = (items, impact) => items.filter((v) => v.nodes.length > 0).map((v) => ({ id: v.id, impact: impact ?? v.impact, nodes: v.nodes.length, sample: v.nodes[0]?.target?.join(" "), msg: v.nodes[0]?.failureSummary?.split("\n")[1] }));
      return [...list(r.violations), ...(incompleteTargetSize ? list(r.incomplete.filter((i) => i.id === "target-size"), "incomplete") : [])];
    },
    { tags: TAGS, inlineCites, incompleteTargetSize },
  );
}
/** Prints each violation under its check. */
export const printViolations = (res) => {
  for (const v of res) console.log(`        ${v.impact} ${v.id} x${v.nodes} ${v.sample} :: ${v.msg}`);
};

/**
 * One axe check: "axe [<label>]" (with ": no violations" or ":" after it when `said`), no violation allowed. Before it, `css` is put into the page for the run and taken out after (the
 * conversation's box unstuck, every reply drawn, motion stopped) and `settle(p)` is awaited (a pause, or the page told to stand still); `inlineCites` and `incompleteTargetSize` as axeViolations.
 */
export async function axeCheck(p, label, { css, settle, said = false, inlineCites, incompleteTargetSize } = {}) {
  const style = css ? await p.addStyleTag({ content: css }) : null;
  if (settle) await settle(p);
  const res = await axeViolations(p, { inlineCites, incompleteTargetSize });
  if (style) await style.evaluate((el) => el.remove());
  ok(res.length === 0, said ? `axe [${label}]: ${res.length ? "" : "no violations"}` : `axe [${label}]`);
  printViolations(res);
  return res;
}
/** The box that sticks to the bottom of a conversation is put in the flow of the page for axe, so that what axe reads is the page and not where it happens to be scrolled. */
export const UNSTICK = ".hm-box { position: static !important; }";
/** ...and every reply is drawn (a reply far from the window has no box, content-visibility, and axe would take the page behind its buttons to be white). */
export const UNSTICK_ALL = ".hm-box { position: static !important; } .chat-list > li { content-visibility: visible !important; }";

/* ---------- waiting inside a page ---------- */

/**
 * Evaluates `fn(arg)` in the page every 100 ms until it is truthy; throws "timed out waiting for <its first words>" after `timeout` ms. For what has to be asked of the page asynchronously
 * (the browser's storage): `waitForFunction` takes the Promise an async function returns for a true value and is done at once, so it cannot be used for that.
 */
export async function untilInPage(p, fn, arg, timeout = 15000) {
  const t = Date.now();
  while (!(await p.evaluate(fn, arg))) {
    if (Date.now() - t > timeout) throw new Error(`timed out waiting for ${fn.toString().slice(0, 90).replace(/[^ -~]+| {2,}/g, " ")}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

/* ---------- the chat's stream, fed by the suite ---------- */

/**
 * Put into every page before its own scripts (`ctx.addInitScript(CHAT_STAND_IN, { key: "__x" })`): once a part arms it (`window.__x = {}`), the next POST to /api/v1/chat is answered by a
 * stream the suite feeds event by event (`__x.emit(e)`, `__x.end()`). `sent: "last"` keeps that request's body in `__x.sent`; `sent: "all"` keeps every body sent to /api/v1/chat, armed
 * or not, in `window.__sent`.
 */
export const CHAT_STAND_IN = ({ key, sent }) => {
  const real = window.fetch.bind(window);
  if (sent === "all") window.__sent = [];
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (new URL(url, location.href).pathname === "/api/v1/chat" && (init?.method ?? "GET") === "POST") {
      if (sent === "all") {
        try { window.__sent.push(JSON.parse(init.body)); } catch { /* not JSON */ }
      }
      const box = window[key];
      if (box && !box.emit) {
        const enc = new TextEncoder();
        let ctrl;
        const body = new ReadableStream({ start(c) { ctrl = c; } });
        if (sent === "last") box.sent = init?.body ? JSON.parse(init.body) : null;
        box.emit = (e) => ctrl.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
        box.end = () => { try { ctrl.close(); } catch { /* closed */ } };
        return Promise.resolve(new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
      }
    }
    return real(input, init);
  };
};
