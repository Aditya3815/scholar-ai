import { Hono, type Context } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { cookieOpts, isHttps, readSession, sameOrigin } from "./http";
import { buildAuthorizeUrl, exchangeCode, pkceChallenge, randomToken, safeReturnTo } from "./oauth";
import { configuredProviders, type AuthEnv, type ProviderId } from "./providers";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, createSession, destroySession, userFromSession } from "./session";
import { resolveUser } from "./users";

type Env = { Bindings: AuthEnv & { DB: D1Database } };

export const authRoutes = new Hono<Env>();

const baseUrl = (c: Context<Env>) => (c.env.PUBLIC_BASE_URL ?? new URL(c.req.url).origin).replace(/\/$/, "");
const redirectUri = (c: Context<Env>, id: ProviderId) => `${baseUrl(c)}/api/v1/auth/${id}/callback`;

const fail = (c: Context<Env>, code: string) => c.redirect(`/?auth_error=${code}`, 302);

authRoutes.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

/** Which sign-in buttons the UI should show: only providers that are configured on this deployment. */
authRoutes.get("/providers", (c) =>
  c.json({ providers: configuredProviders(c.env).map((p) => ({ id: p.id, label: p.label })) }),
);

authRoutes.get("/me", async (c) => {
  const user = await userFromSession(c.env.DB, readSession(c));
  return c.json({ user });
});

authRoutes.post("/logout", async (c) => {
  if (!sameOrigin(c)) return c.json({ type: "forbidden", title: "Cross-origin request blocked" }, 403);
  await destroySession(c.env.DB, readSession(c));
  deleteCookie(c, SESSION_COOKIE, { path: "/", ...cookieOpts(c), secure: isHttps(c) });
  return c.json({ ok: true });
});

authRoutes.get("/:provider/start", async (c) => {
  const def = configuredProviders(c.env).find((p) => p.id === c.req.param("provider"));
  if (!def) return c.json({ type: "not_found", title: "Unknown or unconfigured provider" }, 404);

  // ?link=1 while signed in attaches this provider to the current account instead of logging in.
  let linkUserId: string | null = null;
  if (c.req.query("link") === "1") {
    const current = await userFromSession(c.env.DB, readSession(c));
    if (!current) return fail(c, "signin_required");
    linkUserId = current.id;
  }

  const state = randomToken(24);
  const verifier = randomToken(48);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM oauth_states WHERE expires_at < datetime('now')"),
    c.env.DB
      .prepare(
        "INSERT INTO oauth_states (state, provider, code_verifier, return_to, link_user_id, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, datetime('now', '+10 minutes'))",
      )
      .bind(state, def.id, verifier, safeReturnTo(c.req.query("return")), linkUserId),
  ]);
  return c.redirect(buildAuthorizeUrl(def, redirectUri(c, def.id), state, await pkceChallenge(verifier)), 302);
});

authRoutes.get("/:provider/callback", async (c) => {
  const def = configuredProviders(c.env).find((p) => p.id === c.req.param("provider"));
  if (!def) return fail(c, "provider");

  const state = c.req.query("state");
  const code = c.req.query("code");
  if (!state) return fail(c, "state");

  // Single-use: the row is consumed even if the provider reported an error.
  const pending = await c.env.DB
    .prepare(
      "DELETE FROM oauth_states WHERE state = ?1 AND provider = ?2 AND expires_at > datetime('now') RETURNING code_verifier, return_to, link_user_id",
    )
    .bind(state, def.id)
    .first<{ code_verifier: string; return_to: string; link_user_id: string | null }>();
  if (!pending) return fail(c, "state");
  if (c.req.query("error") || !code) return c.redirect(`${safeReturnTo(pending.return_to)}${pending.return_to.includes("?") ? "&" : "?"}auth_error=denied`, 302);

  try {
    const token = await exchangeCode(def, code, pending.code_verifier, redirectUri(c, def.id));
    const profile = await def.profile(token, fetch);
    const result = await resolveUser(c.env.DB, def.id, profile, pending.link_user_id);
    if ("error" in result) return fail(c, result.error);

    // Linking keeps the current session; a normal login starts a fresh one (prevents session fixation).
    if (!pending.link_user_id) {
      const sessionToken = await createSession(c.env.DB, result.userId, c.req.header("user-agent"));
      setCookie(c, SESSION_COOKIE, sessionToken, {
        path: "/",
        httpOnly: true,
        secure: isHttps(c),
        sameSite: "Lax",
        maxAge: SESSION_TTL_SECONDS,
        ...cookieOpts(c),
      });
    }
    return c.redirect(safeReturnTo(pending.return_to), 302);
  } catch (err) {
    console.error("auth callback failed", def.id, err instanceof Error ? err.message : err);
    return fail(c, "failed");
  }
});
