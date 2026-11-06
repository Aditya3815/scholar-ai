// The MCP server (src/mcp) end to end: real Worker + local D1 + local KV + the fake identity provider. An app registers itself, sends a person through Sodhsetu's sign-in and consent with PKCE, gets a
// token, and calls the tools over the real MCP protocol; the person sees it under Connected apps and disconnects it. With INTEGRATION_MCP=off (a second run, --only="MCP server integration") every
// path of the server answers 404, as before it existed.
import crypto from "node:crypto";
import { startFakeIdp } from "./fake-idp.mjs";
import { createClient } from "./test-client.mjs";

const APP = process.env.APP ?? "http://localhost:8788";
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "  ok  " : " FAIL "} ${msg}`); if (!cond) failures++; };
const sql = async (statements) => (await (await fetch(`${APP}/api/v1/dev/sql`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sql: statements }) })).json()).results;

if (process.env.INTEGRATION_MCP === "off") {
  console.log("the switch off: every path of the MCP server is the 404 it was before");
  for (const p of ["/mcp", "/oauth/authorize", "/oauth/token", "/oauth/register", "/.well-known/oauth-authorization-server", "/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp", "/api/v1/connected-apps"]) {
    const r = await fetch(`${APP}${p}`, { redirect: "manual" });
    const body = await r.json().catch(() => null);
    ok(r.status === 404 && body?.type === "not_found", `${p}: 404 not_found`);
  }
  const post = await fetch(`${APP}/mcp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  ok(post.status === 404, "a POST to /mcp: 404 too");
  console.log(failures === 0 ? "\nall MCP (off) checks passed" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

const idp = await startFakeIdp(9911);
const b64url = (buf) => Buffer.from(buf).toString("base64url");
const pkce = () => {
  const verifier = b64url(crypto.randomBytes(32));
  return { verifier, challenge: b64url(crypto.createHash("sha256").update(verifier).digest()) };
};
const REDIRECT = "http://localhost:9933/callback";
const form = (o) => new URLSearchParams(o).toString();

/** One MCP request with a bearer token; the 2025 leg answers with one server-sent event. */
const mcp = async (token, method, params = {}, id = 1) => {
  const res = await fetch(`${APP}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const text = await res.text();
  const data = text.startsWith("{") ? text : text.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
  return { res, body: data ? JSON.parse(data) : null };
};

/** Registers an app, sends person `c` through the authorization page and returns the code (or what came back instead). */
async function authorize(c, { decision = "allow", scope = "papers:read references:verify", clientName = "Test MCP App", signIn = null } = {}) {
  const reg = await fetch(`${APP}/oauth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ redirect_uris: [REDIRECT], client_name: clientName, token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }) });
  const client = await reg.json();
  const { verifier, challenge } = pkce();
  const state = b64url(crypto.randomBytes(12));
  const url = `${APP}/oauth/authorize?${form({ response_type: "code", client_id: client.client_id, redirect_uri: REDIRECT, scope, state, code_challenge: challenge, code_challenge_method: "S256", resource: `${APP}/mcp` })}`;
  let page = await c.send(url);
  let html = await page.text();
  if (signIn) {
    // not signed in: the page offers the website's own sign-in, which comes back to the same request
    const href = html.match(/href="([^"]*\/api\/v1\/auth\/google\/start[^"]*)"/)?.[1]?.replace(/&amp;/g, "&");
    signIn({ page, html, href });
    const { final } = await c.follow(new URL(href, APP).toString());
    page = await c.send(final.toString());
    html = await page.text();
  }
  const handle = html.match(/name="handle" value="([^"]+)"/)?.[1];
  const done = await c.send(`${APP}/oauth/authorize`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: APP }, body: form({ handle: handle ?? "", decision }) });
  const loc = done.headers.get("location") ? new URL(done.headers.get("location")) : null;
  return { client, verifier, state, consent: { status: page.status, html, headers: page.headers }, done, loc };
}

const token = (body) => fetch(`${APP}/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form(body) });

try {
  console.log("discovery");
  {
    const prm = await (await fetch(`${APP}/.well-known/oauth-protected-resource/mcp`)).json();
    ok(prm.resource === `${APP}/mcp` && prm.authorization_servers?.[0]?.startsWith(APP), "the protected resource names /mcp and Sodhsetu as its authorization server");
    const as = await (await fetch(`${APP}/.well-known/oauth-authorization-server`)).json();
    ok(as.authorization_endpoint === `${APP}/oauth/authorize` && as.token_endpoint === `${APP}/oauth/token` && as.registration_endpoint === `${APP}/oauth/register`, "the authorization server lists its endpoints");
    ok(as.code_challenge_methods_supported?.includes("S256"), "PKCE with S256");
    ok(["papers:read", "references:verify", "library:read", "library:write"].every((s) => as.scopes_supported?.includes(s)), "the four scopes are named");
    const bare = await mcp(null, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "1" } });
    ok(bare.res.status === 401 && /resource_metadata=/.test(bare.res.headers.get("www-authenticate") ?? ""), "/mcp without a token: 401 pointing at the resource metadata");
  }

  console.log("an app connects: sign-in, consent, PKCE");
  const P = createClient(APP);
  idp.setUser({ sub: "mcp-person", email: "mcp@example.edu", email_verified: true, name: "Meera C. Prasad" });
  let signInOffered = null;
  const first = await authorize(P, { signIn: (s) => (signInOffered = s) });
  ok(signInOffered?.page.status === 200 && /Sign in to connect Test MCP App/.test(signInOffered.html) && !!signInOffered.href, "a person who is not signed in is offered the website's own sign-in first");
  ok(first.consent.status === 200 && /Test MCP App<\/h1>|Test MCP App wants to use Sodhsetu/.test(first.consent.html), "...and comes back to the consent page, which names the app");
  ok(/localhost:9933/.test(first.consent.html) && /Signed in as <strong>Meera C. Prasad<\/strong>/.test(first.consent.html), "it shows where the person goes back to, and who is signed in");
  ok(/frame-ancestors 'none'/.test(first.consent.headers.get("content-security-policy") ?? "") && first.consent.headers.get("x-frame-options") === "DENY", "the consent page can never be framed");
  ok(first.done.status === 302 && first.loc?.origin === "http://localhost:9933" && !!first.loc.searchParams.get("code") && first.loc.searchParams.get("state") === first.state, "Allow sends the person back to the app with a code and its state");

  const bad = await token({ grant_type: "authorization_code", code: first.loc.searchParams.get("code"), redirect_uri: REDIRECT, client_id: first.client.client_id, code_verifier: "wrong-verifier-wrong-verifier-wrong-verifier-123", resource: `${APP}/mcp` });
  ok(bad.status === 400, "a token request with the wrong PKCE verifier is refused");
  const second = await authorize(P);
  const tok = await token({ grant_type: "authorization_code", code: second.loc.searchParams.get("code"), redirect_uri: REDIRECT, client_id: second.client.client_id, code_verifier: second.verifier, resource: `${APP}/mcp` });
  const t = await tok.json();
  ok(tok.status === 200 && !!t.access_token && !!t.refresh_token && /papers:read/.test(t.scope) && /references:verify/.test(t.scope), "the right verifier gets an access token and a refresh token with both Phase 1 scopes");

  console.log("the tools over MCP");
  const init = await mcp(t.access_token, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } });
  ok(init.res.status === 200 && init.body?.result?.serverInfo?.name === "sodhsetu", "initialize: the server says who it is");
  const list = await mcp(t.access_token, "tools/list", {}, 2);
  ok(JSON.stringify((list.body?.result?.tools ?? []).map((x) => x.name).sort()) === JSON.stringify(["check_retractions", "search_papers", "verify_references"]), "tools/list: the three Phase 1 tools");
  const ret = await mcp(t.access_token, "tools/call", { name: "check_retractions", arguments: { text: "doi = {10.5555/retracted-e2e}, 10.5555/clear-e2e" } }, 3);
  const s = ret.body?.result?.structuredContent;
  ok(s?.summary?.retracted === 1 && s?.summary?.not_retracted === 1 && s.items[0].notices[0]?.doi === "10.5555/retracted-e2e-notice", "check_retractions finds the retracted DOI and its notice");
  const inval = await mcp(t.access_token, "tools/call", { name: "verify_references", arguments: {} }, 4);
  ok(inval.body?.result?.isError === true, "a tool call with neither field is a tool error, not a crash");
  const rows = await sql(["SELECT * FROM mcp_calls ORDER BY rowid"]);
  ok(rows[0].length === 2 && rows[0].every((r) => Object.keys(r).sort().join() === "at,client,duration_ms,outcome,tool" && r.client === "Test MCP App"), "each call is counted: tool, app, time, outcome, and nothing else");
  ok(!JSON.stringify(rows).includes("10.5555"), "...and nothing of what was sent");

  console.log("Connected apps");
  const apps = await (await P.api("/api/v1/connected-apps")).json();
  ok(apps.mode === "on" && apps.apps.length >= 1 && apps.apps.every((a) => a.name === "Test MCP App"), "Settings lists the connected app");
  const other = createClient(APP);
  idp.setUser({ sub: "mcp-other", email: "other@example.edu", email_verified: true, name: "Other Person" });
  await other.follow(`${APP}/api/v1/auth/google/start`);
  ok((await (await other.api("/api/v1/connected-apps")).json()).apps.length === 0, "another person sees none of them");
  ok((await other.api(`/api/v1/connected-apps/${apps.apps[0].id}`, { method: "DELETE" })).status === 200 && (await (await P.api("/api/v1/connected-apps")).json()).apps.length === apps.apps.length, "and cannot disconnect them (nothing happens)");
  ok((await P.api(`/api/v1/connected-apps/${apps.apps[0].id}`, { method: "DELETE", origin: "https://evil.example" })).status === 403, "a cross-site disconnect is refused");
  for (const a of apps.apps) await P.api(`/api/v1/connected-apps/${a.id}`, { method: "DELETE" });
  ok((await (await P.api("/api/v1/connected-apps")).json()).apps.length === 0, "Disconnect removes it");
  const after = await mcp(t.access_token, "tools/list", {}, 5);
  ok(after.res.status === 401, "...and its token stops working at once");
  const refreshed = await token({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: second.client.client_id });
  ok(refreshed.status === 400, "...and so does its refresh token");

  console.log("Cancel, forged and stale requests");
  const denied = await authorize(P, { decision: "deny" });
  ok(denied.done.status === 302 && denied.loc?.searchParams.get("error") === "access_denied", "Cancel sends the app access_denied, no code");
  const cross = await P.send(`${APP}/oauth/authorize`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://evil.example" }, body: form({ handle: "x".repeat(32), decision: "allow" }) });
  ok(cross.status === 403, "a consent posted from another site is refused");
  const stale = await P.send(`${APP}/oauth/authorize`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: APP }, body: form({ handle: "y".repeat(32), decision: "allow" }) });
  ok(stale.status === 400, "a consent with an unknown handle is refused");
  const libOnly = await authorize(P, { scope: "library:write" });
  ok(/Not available yet/.test(libOnly.consent.html) && libOnly.loc?.searchParams.get("error") === "invalid_scope", "an app asking only for a scope this release cannot grant gets invalid_scope");

  console.log("the admin page");
  ok((await P.api("/api/v1/admin/mcp")).status === 404, "the MCP counts are for admins only");
  await P.api("/api/v1/dev/make-admin", { method: "POST" });
  const adm = await (await P.api("/api/v1/admin/mcp")).json();
  ok(adm.mode === "on" && adm.tools.some((x) => x.tool === "check_retractions" && x.ok >= 1) && adm.clients.some((x) => x.client === "Test MCP App"), "an admin sees calls by tool and by app");
} catch (e) {
  console.error(e);
  failures++;
} finally {
  idp.close?.();
}
console.log(failures === 0 ? "\nall MCP checks passed" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
