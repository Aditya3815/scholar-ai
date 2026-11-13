// Auth integration test: real Worker + local D1 + a fake identity provider that ENFORCES PKCE and the client secret.
//
//   node scripts/integration.mjs --only="auth integration"   (starts both; scripts/lib/harness.mjs has the ports, the secret and the client)
//
// (DEV_IDP_URL only works with ENABLE_DEV_ROUTES=1, which the test Worker sets; production never does.)
import { APP, ok, startIdp, createClient, countFailure, finish } from "./lib/harness.mjs";

/* ---------- fake IdP (shared with the browser e2e) ---------- */
const idp = await startIdp();
let nextUser; void nextUser;
const setNext = (u) => { nextUser = u; idp.setUser(u); };
setNext({ sub: "g-111", email: "scholar@example.com", email_verified: true, name: "Test Scholar" });

/* ---------- the test client (scripts/test-client.mjs): a cookie jar and manual redirects ---------- */
const client = () => createClient(APP);
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
  countFailure();
} finally {
  idp.close();
}
finish("all auth checks passed", (n) => `${n} check(s) FAILED`);
