import type { TokenResponse } from "./oauth";

export type ProviderId = "google" | "orcid";

export type Profile = {
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  avatarUrl: string | null;
  orcid: string | null;
};

export type ProviderDef = {
  id: ProviderId;
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  clientId: string;
  clientSecret: string;
  /** Turns the token response (plus optional userinfo call) into a normalised profile. */
  profile(token: TokenResponse, doFetch: typeof fetch): Promise<Profile>;
};

export type AuthEnv = {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  ORCID_CLIENT_ID?: string;
  ORCID_CLIENT_SECRET?: string;
  /** "https://orcid.org" (default) or "https://sandbox.orcid.org" while testing. */
  ORCID_BASE_URL?: string;
  /** Only honoured together with ENABLE_DEV_ROUTES=1: points Google at a local fake identity provider for tests. */
  DEV_IDP_URL?: string;
  ENABLE_DEV_ROUTES?: string;
  PUBLIC_BASE_URL?: string;
};

type GoogleUserInfo = { sub?: string; email?: string; email_verified?: boolean; name?: string; picture?: string };

export function configuredProviders(env: AuthEnv): ProviderDef[] {
  const defs: ProviderDef[] = [];
  const devIdp = env.ENABLE_DEV_ROUTES === "1" ? env.DEV_IDP_URL : undefined;

  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    const userinfo = devIdp ? `${devIdp}/userinfo` : "https://openidconnect.googleapis.com/v1/userinfo";
    defs.push({
      id: "google",
      label: "Google",
      authorizeUrl: devIdp ? `${devIdp}/authorize` : "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: devIdp ? `${devIdp}/token` : "https://oauth2.googleapis.com/token",
      scope: "openid email profile",
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      async profile(token, doFetch) {
        const res = await doFetch(userinfo, {
          headers: { Authorization: `Bearer ${token.access_token}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`userinfo HTTP ${res.status}`);
        const u = (await res.json()) as GoogleUserInfo;
        if (!u.sub) throw new Error("userinfo has no sub");
        return {
          subject: u.sub,
          email: u.email ?? null,
          emailVerified: u.email_verified === true,
          name: u.name ?? null,
          avatarUrl: u.picture ?? null,
          orcid: null,
        };
      },
    });
  }

  if (env.ORCID_CLIENT_ID && env.ORCID_CLIENT_SECRET) {
    const base = (env.ORCID_BASE_URL ?? "https://orcid.org").replace(/\/$/, "");
    defs.push({
      id: "orcid",
      label: "ORCID",
      authorizeUrl: `${base}/oauth/authorize`,
      tokenUrl: `${base}/oauth/token`,
      scope: "/authenticate",
      clientId: env.ORCID_CLIENT_ID,
      clientSecret: env.ORCID_CLIENT_SECRET,
      // The ORCID token response already carries the iD and public name; email is not returned.
      async profile(token) {
        const orcid = typeof token.orcid === "string" ? token.orcid : "";
        if (!/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(orcid)) throw new Error("token response has no valid ORCID iD");
        const name = typeof token.name === "string" && token.name.trim() ? token.name.trim() : null;
        return { subject: orcid, email: null, emailVerified: false, name, avatarUrl: null, orcid };
      },
    });
  }
  return defs;
}
