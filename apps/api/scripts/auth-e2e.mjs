// Auth integration test: real Worker + local D1 + a fake identity provider that ENFORCES PKCE and the client secret.
//
//   terminal 1:  npx wrangler d1 migrations apply scholar-db --local
//                npx wrangler dev --port 8788 --var GOOGLE_CLIENT_ID:dev --var GOOGLE_CLIENT_SECRET:dev-secret \
//                  --var ORCID_CLIENT_ID:dev --var ORCID_CLIENT_SECRET:dev-secret \
//                  --var DEV_IDP_URL:http://localhost:9911 --var ORCID_BASE_URL:http://localhost:9911/orcid
//   terminal 2:  node scripts/auth-e2e.mjs
//
// (DEV_IDP_URL only works because .dev.vars sets ENABLE_DEV_ROUTES=1; production never does.)

import { startFakeIdp } from "./fake-idp.mjs";

const APP = process.env.APP ?? "http://localhost:8788";
const IDP_PORT = 9911;
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "  ok  " : " FAIL "} ${msg}`); if (!cond) failures++; };

/* ---------- fake IdP (shared with the browser e2e) ---------- */
const idp = await startFakeIdp(IDP_PORT);
let nextUser; void nextUser;
const setNext = (u) => { nextUser = u; idp.setUser(u); };
setNext({ sub: "g-111", email: "scholar@example.com", email_verified: true, name: "Test Scholar" });

/* ---------- tiny HTTP client with a cookie jar and manual redirects ---------- */
function client() {
  const jar = new Map();
  const send = async (url, init = {}) => {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(url, { redirect: "manual", ...init, headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) } });
    for (const sc of res.headers.getSetCookie?.() ?? []) {
      const [pair] = sc.split(";");
      const [k, ...v] = pair.split("=");
      if (/max-age=0|expires=thu, 01 jan 1970/i.test(sc) || v.join("=") === "") jar.delete(k); else jar.set(k, v.join("="));
    }
    return res;
  };
  /** Follows redirects across the app and the fake IdP until a response that is not a redirect, or a redirect back to the app root. */
  const follow = async (url) => {
    let res = await send(url);
    const hops = [];
    for (let i = 0; i < 6 && res.status >= 300 && res.status < 400; i++) {
      const loc = new URL(res.headers.get("location"), url);
      hops.push(loc.toString());
      if (loc.origin === APP && !loc.pathname.startsWith("/api/")) return { res, final: loc, hops };
      url = loc.toString();
      res = await send(url);
    }
    return { res, final: new URL(url), hops };
  };
  return { send, follow, jar };
}
const me = async (c) => (await (await c.send(`${APP}/api/v1/auth/me`)).json()).user;

try {
  const c = client();

  console.log("providers and anonymous state");
  const prov = await (await c.send(`${APP}/api/v1/auth/providers`)).json();
  ok(prov.providers.map((p) => p.id).join() === "google,orcid", `both providers configured (${prov.providers.map((p) => p.id)})`);
  ok((await me(c)) === null, "anonymous /me is null");
  ok((await c.send(`${APP}/api/v1/auth/nope/start`)).status === 404, "unknown provider -> 404");

  console.log("Google login (PKCE enforced by the fake IdP)");
  const login = await c.follow(`${APP}/api/v1/auth/google/start?return=${encodeURIComponent("/library?tab=saved")}`);
  ok(login.final.pathname === "/library" && login.final.search === "?tab=saved", `lands on return_to (${login.final.pathname}${login.final.search})`);
  const setCookie = (await c.send(`${APP}/api/v1/auth/me`)).status === 200 && c.jar.has("sid");
  ok(setCookie, "session cookie 'sid' set (http dev: no __Host- prefix)");
  const u = await me(c);
  ok(u?.email === "scholar@example.com" && u.name === "Test Scholar" && u.providers.join() === "google", `/me returns the user (${u?.email}, ${u?.providers})`);

  // cookie attributes from a fresh login
  const probe = client();
  const hop1 = await probe.send(`${APP}/api/v1/auth/google/start`);
  const hop2 = await probe.send(hop1.headers.get("location"));
  const cb = await probe.send(hop2.headers.get("location"));
  const attrs = (cb.headers.getSetCookie?.() ?? []).join(" | ");
  ok(/HttpOnly/i.test(attrs) && /SameSite=Lax/i.test(attrs) && /Max-Age=\d+/i.test(attrs), `cookie is HttpOnly; SameSite=Lax; Max-Age (${attrs.slice(0, 90)}...)`);

  console.log("state / replay / open redirect");
  const s1 = await c.send(`${APP}/api/v1/auth/google/start`);
  const idpAuth = await c.send(s1.headers.get("location"));
  const callbackUrl = idpAuth.headers.get("location");
  const first = await c.send(callbackUrl);
  ok(first.status === 302 && !String(first.headers.get("location")).includes("auth_error"), "first callback succeeds");
  const replay = await c.send(callbackUrl);
  ok(String(replay.headers.get("location")).includes("auth_error=state"), "replayed callback rejected (state is single-use)");
  const forged = new URL(callbackUrl); forged.searchParams.set("state", "forged-state");
  ok(String((await c.send(forged.toString())).headers.get("location")).includes("auth_error=state"), "forged state rejected");
  const noState = new URL(callbackUrl); noState.searchParams.delete("state");
  ok(String((await c.send(noState.toString())).headers.get("location")).includes("auth_error=state"), "missing state rejected");
  const evil = await client().follow(`${APP}/api/v1/auth/google/start?return=//evil.example`);
  ok(evil.final.origin === APP && evil.final.pathname === "/", `open redirect blocked (landed on ${evil.final})`);

  console.log("provider error / denied consent");
  const d = client();
  const ds = await d.send(`${APP}/api/v1/auth/google/start?return=/`);
  const st = new URL(ds.headers.get("location")).searchParams.get("state");
  const denied = await d.send(`${APP}/api/v1/auth/google/callback?error=access_denied&state=${st}`);
  ok(String(denied.headers.get("location")).includes("auth_error=denied") && !d.jar.has("sid"), "denied consent -> auth_error=denied, no session");

  console.log("logout and CSRF");
  ok((await c.send(`${APP}/api/v1/auth/logout`, { method: "POST" })).status === 403, "logout without Origin / Sec-Fetch-Site is blocked");
  ok((await c.send(`${APP}/api/v1/auth/logout`, { method: "POST", headers: { Origin: "http://evil.example" } })).status === 403, "logout from another origin is blocked");
  ok((await me(c)) !== null, "still signed in after the blocked attempts");
  const stale = c.jar.get("sid");
  ok((await c.send(`${APP}/api/v1/auth/logout`, { method: "POST", headers: { Origin: APP } })).status === 200, "same-origin logout succeeds");
  ok((await me(c)) === null, "signed out");
  const old = client(); old.jar.set("sid", stale);
  ok((await me(old)) === null, "the old session token no longer works (deleted server-side)");

  console.log("ORCID login, then linking, then identity conflicts");
  setNext({ sub: "g-222", email: "second@example.com", email_verified: true, name: "Second Scholar" });
  const a = client();
  await a.follow(`${APP}/api/v1/auth/google/start`);
  ok((await me(a))?.email === "second@example.com", "second Google user signed in");
  const link = await a.follow(`${APP}/api/v1/auth/orcid/start?link=1`);
  const after = await me(a);
  ok(after?.orcid === "0000-0002-1825-0097" && after.providers.sort().join() === "google,orcid", `ORCID linked to the signed-in account (${after?.providers})`);

  const b = client();
  await b.follow(`${APP}/api/v1/auth/orcid/start`);
  const bu = await me(b);
  ok(bu?.id === after?.id, "logging in with ORCID alone reaches the same account");

  setNext({ sub: "g-333", email: "third@example.com", email_verified: true, name: "Third" });
  const t = client();
  await t.follow(`${APP}/api/v1/auth/google/start`);
  const conflict = await t.follow(`${APP}/api/v1/auth/orcid/start?link=1`);
  ok(conflict.final.search.includes("auth_error=identity_taken"), "linking an ORCID that belongs to another account is refused");
  ok((await t.follow(`${APP}/api/v1/auth/orcid/start?link=1`), true), "(conflict leaves the third account intact)");
  const anon = client();
  ok((await anon.follow(`${APP}/api/v1/auth/orcid/start?link=1`)).final.search.includes("auth_error=signin_required"), "link without a session -> signin_required");

  console.log("verified-email auto-link");
  setNext({ sub: "g-444", email: "scholar@example.com", email_verified: true, name: "Same Email, New Google Subject" });
  const v = client();
  await v.follow(`${APP}/api/v1/auth/google/start`);
  const vu = await me(v);
  ok(vu?.id === u?.id && vu?.email === "scholar@example.com", "a second Google subject with the same verified email joins the existing account");

  setNext({ sub: "g-555", email: "unverified@example.com", email_verified: false, name: "No Verified Email" });
  const w = client();
  await w.follow(`${APP}/api/v1/auth/google/start`);
  const wu = await me(w);
  ok(wu && wu.email === null, "an UNVERIFIED email is never stored (cannot be squatted)");
} catch (e) {
  console.log(" FAIL unexpected error:", e);
  failures++;
} finally {
  idp.close();
}
console.log(failures ? `\n${failures} check(s) FAILED` : "\nall auth checks passed");
process.exit(failures ? 1 : 0);
