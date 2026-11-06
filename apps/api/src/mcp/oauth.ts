import { Hono, type Context } from "hono";
import { AuthorizationError, OAuthProvider, authorizationErrorRedirect, getOAuthApi, type AuthRequest, type OAuthHelpers, type OAuthProviderOptions } from "@cloudflare/workers-oauth-provider";
import { currentUser, sameOrigin } from "../auth/http";
import { randomToken } from "../auth/oauth";
import { configuredProviders, type AuthEnv } from "../auth/providers";
import type { SessionUser } from "../auth/users";
import { mcpAllowedFor, mcpMode, type McpFlagEnv } from "./flag";
import { DEFAULT_SCOPES, GRANTABLE, SCOPES, baseUrlOf, grantedScopes, type McpProps, type Scope } from "./scopes";
import { closedBetaPage, consentPage, errorPage, signInPage } from "./pages";

/**
 * Sodhsetu as an OAuth 2.1 authorization server for MCP clients (docs "Sodhsetu understanding, follow-ups and MCP (design)", page 12), on @cloudflare/workers-oauth-provider. The library serves
 * the discovery documents, dynamic client registration (/oauth/register), the token endpoint (/oauth/token, PKCE checked) and the check of every bearer token on /mcp. This file adds what is ours:
 * the authorization page, where a person who is signed in to Sodhsetu (the same Google or ORCID sign-in as the website: no new address has to be registered with Google or ORCID) sees which app asks
 * for what and allows it or not.
 *
 * Storage: the library keeps clients, grants and tokens in a KV namespace bound as OAUTH_KV (its name is fixed by the library), a namespace of its own and not CACHE, which holds only public
 * data. Tokens are kept there as hashes and a grant's properties encrypted, by the library; this file adds two short-lived kinds of key under `mcp-` (a request kept while a person signs in, and an
 * authorization waiting for Allow or Cancel), ten minutes each.
 */

export type McpOAuthEnv = AuthEnv & McpFlagEnv & { DB: D1Database; OAUTH_KV: KVNamespace };
export { DEFAULT_SCOPES, GRANTABLE, SCOPES, baseUrlOf, grantedScopes, type McpProps, type Scope };

/** The provider's options for one address of the Worker. `apiHandler` is the MCP server (src/mcp/server.ts), passed in so that this file does not import it. */
export function oauthOptions(base: string, apiHandler: OAuthProviderOptions<McpOAuthEnv>["apiHandler"], defaultHandler: OAuthProviderOptions<McpOAuthEnv>["defaultHandler"]): OAuthProviderOptions<McpOAuthEnv> {
  return {
    apiRoute: `${base}/mcp`,
    apiHandler,
    defaultHandler,
    authorizeEndpoint: `${base}/oauth/authorize`,
    tokenEndpoint: `${base}/oauth/token`,
    clientRegistrationEndpoint: `${base}/oauth/register`,
    scopesSupported: Object.keys(SCOPES),
    // the scopes a client should ask for first (named in the 401 challenge); a tool that needs one the token lacks asks for it then (step-up)
    requiredScopes: [...DEFAULT_SCOPES],
    resourceMetadata: { resource: `${base}/mcp`, authorization_servers: [base], resource_name: "Sodhsetu" },
    accessTokenTTL: 3600,
    // a grant lives as long as the app keeps using it, and ends after 30 days without use
    refreshTokenTTL: 90 * 86_400,
    refreshTokenIdleTTL: 30 * 86_400,
  };
}

const providers = new Map<string, OAuthProvider<McpOAuthEnv>>();
/** One provider per address, made on first use (an isolate serves one address in production; a local run has its own). */
export function providerFor(base: string, apiHandler: OAuthProviderOptions<McpOAuthEnv>["apiHandler"], defaultHandler: OAuthProviderOptions<McpOAuthEnv>["defaultHandler"]): OAuthProvider<McpOAuthEnv> {
  let p = providers.get(base);
  if (!p) providers.set(base, (p = new OAuthProvider<McpOAuthEnv>(oauthOptions(base, apiHandler, defaultHandler))));
  return p;
}

/** The library's helpers (parse and complete an authorization, list and revoke grants), for code outside its own fetch. The handlers are not used by these helpers. */
export const oauthApi = (env: McpOAuthEnv, base: string): OAuthHelpers => getOAuthApi(oauthOptions(base, { fetch: () => new Response(null, { status: 404 }) }, { fetch: () => new Response(null, { status: 404 }) }), env);

// ---- the authorization page ----

/** A sign-in that has to happen first keeps the app's request here (the return address of the sign-in is limited to 300 characters; an authorization request is longer). Ten minutes. */
const RESUME_PREFIX = "mcp-resume:";
/** An authorization a person is looking at: who, and the request, until they press Allow or Cancel. Ten minutes. */
const CONSENT_PREFIX = "mcp-consent:";
const PENDING_TTL_S = 600;

type Pending = { userId: string; request: AuthRequest; client: string };
type Env = { Bindings: McpOAuthEnv };
export const oauthPages = new Hono<Env>();

oauthPages.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
  // the page can never be framed (a consent button under someone else's page), loads nothing from elsewhere and posts only to itself
  c.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'");
  c.header("X-Frame-Options", "DENY");
  // same-origin, not no-referrer: with no-referrer a browser sends "Origin: null" on the form post, and the post is then refused as cross-site; the app still gets no referrer
  c.header("Referrer-Policy", "same-origin");
  c.header("X-Content-Type-Options", "nosniff");
});

const html = (c: Context<Env>, body: string, status = 200) => c.html(body, status as 200);

/** The request the app sent, or the one kept while the person signed in. */
async function originalRequest(c: Context<Env>): Promise<Request | null> {
  const url = new URL(c.req.url);
  const resume = url.searchParams.get("resume");
  if (!resume) return c.req.raw;
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(resume)) return null;
  const search = await c.env.OAUTH_KV.get(`${RESUME_PREFIX}${resume}`);
  if (search === null) return null;
  return new Request(`${url.origin}${url.pathname}${search}`, { headers: c.req.raw.headers });
}

oauthPages.get("/oauth/authorize", async (c) => {
  const base = baseUrlOf(c.env, c.req.raw);
  const api = oauthApi(c.env, base);
  const request = await originalRequest(c);
  if (!request) return html(c, errorPage("This sign-in link has expired", "Start again from your app: ask it to connect to Sodhsetu once more."), 400);
  let auth: AuthRequest;
  try {
    auth = await api.parseAuthRequest(request);
  } catch (e) {
    if (e instanceof AuthorizationError) {
      if (e.redirectTo) return c.redirect(e.redirectTo, 302);
      return html(c, errorPage("This request cannot be used", e.description), 400);
    }
    throw e;
  }
  const client = await api.lookupClient(auth.clientId);
  if (!client) return html(c, errorPage("This app is not known", "Ask your app to connect to Sodhsetu again."), 400);
  const clientName = (client.clientName ?? "").trim() || "An app";
  const user = await currentUser(c);
  if (!user) {
    // keep the request and send the person through the website's own sign-in, which comes back here
    const resume = randomToken(24);
    await c.env.OAUTH_KV.put(`${RESUME_PREFIX}${resume}`, new URL(request.url).search, { expirationTtl: PENDING_TTL_S });
    const back = `/oauth/authorize?resume=${resume}`;
    return html(c, signInPage(clientName, configuredProviders(c.env).map((p) => ({ label: p.label, href: `/api/v1/auth/${p.id}/start?return=${encodeURIComponent(back)}` }))));
  }
  const mode = await mcpMode(c.env);
  if (!mcpAllowedFor(mode, c.env, user.id)) return html(c, closedBetaPage(clientName), 403);
  const handle = randomToken(24);
  const pending: Pending = { userId: user.id, request: auth, client: clientName.slice(0, 80) };
  await c.env.OAUTH_KV.put(`${CONSENT_PREFIX}${handle}`, JSON.stringify(pending), { expirationTtl: PENDING_TTL_S });
  return html(c, consentPage({ handle, clientName, clientUri: client.clientUri ?? null, redirectUri: auth.redirectUri, requested: auth.scope, granted: grantedScopes(auth.scope), user: displayName(user) }));
});

oauthPages.post("/oauth/authorize", async (c) => {
  if (!sameOrigin(c)) return html(c, errorPage("This request was blocked", "It did not come from this page."), 403);
  const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
  const handle = typeof form.handle === "string" && /^[A-Za-z0-9_-]{20,80}$/.test(form.handle) ? form.handle : null;
  const raw = handle ? await c.env.OAUTH_KV.get(`${CONSENT_PREFIX}${handle}`) : null;
  if (!handle || raw === null) return html(c, errorPage("This page has expired", "Start again from your app: ask it to connect to Sodhsetu once more."), 400);
  const pending = JSON.parse(raw) as Pending;
  const user = await currentUser(c);
  // the person who pressed the button is the one the page was made for, and they are still allowed
  if (!user || user.id !== pending.userId) return html(c, errorPage("You are not signed in as the same person", "Start again from your app."), 403);
  await c.env.OAUTH_KV.delete(`${CONSENT_PREFIX}${handle}`);
  if (form.decision !== "allow") return c.redirect(authorizationErrorRedirect(pending.request, "access_denied", "The person did not allow the connection"), 302);
  if (!mcpAllowedFor(await mcpMode(c.env), c.env, user.id)) return html(c, closedBetaPage(pending.client), 403);
  const scope = grantedScopes(pending.request.scope);
  if (scope.length === 0) return c.redirect(authorizationErrorRedirect(pending.request, "invalid_scope", "None of the requested scopes is available"), 302);
  const base = baseUrlOf(c.env, c.req.raw);
  const props: McpProps = { userId: user.id, client: pending.client };
  const { redirectTo } = await oauthApi(c.env, base).completeAuthorization({ request: pending.request, userId: user.id, metadata: { client: pending.client }, scope, props });
  return c.redirect(redirectTo, 302);
});

const displayName = (u: SessionUser): string => u.name ?? u.email ?? (u.orcid ? `ORCID ${u.orcid}` : "your account");

