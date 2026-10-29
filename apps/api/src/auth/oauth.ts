import type { ProviderDef } from "./providers";

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export { sha256Hex } from "../hash";

/** PKCE S256 challenge: base64url(SHA-256(verifier)). */
export async function pkceChallenge(verifier: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(buf));
}

/**
 * Only same-site relative paths are allowed as post-login destinations. Rejects absolute URLs,
 * protocol-relative ("//evil.com") and backslash tricks ("/\evil.com"), which would make login an open redirect.
 */
export function safeReturnTo(value: string | undefined | null): string {
  if (!value || value.length > 300) return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  if (/[\u0000-\u001f]/.test(value)) return "/";
  return value;
}

export function buildAuthorizeUrl(def: ProviderDef, redirectUri: string, state: string, challenge: string): string {
  const u = new URL(def.authorizeUrl);
  u.searchParams.set("client_id", def.clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("scope", def.scope);
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  if (def.id === "google") u.searchParams.set("prompt", "select_account");
  return u.toString();
}

export type TokenResponse = Record<string, unknown> & { access_token?: string };

/** Authorization-code exchange. Sent server-to-server over TLS with the client secret and the PKCE verifier. */
export async function exchangeCode(
  def: ProviderDef,
  code: string,
  verifier: string,
  redirectUri: string,
  doFetch: typeof fetch = fetch,
): Promise<TokenResponse> {
  const res = await doFetch(def.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: def.clientId,
      client_secret: def.clientSecret,
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`token endpoint HTTP ${res.status}`);
  const json = (await res.json()) as TokenResponse;
  if (!json.access_token) throw new Error("token response has no access_token");
  return json;
}
