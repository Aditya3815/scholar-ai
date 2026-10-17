import { describe, expect, it, vi } from "vitest";
import { buildAuthorizeUrl, exchangeCode, pkceChallenge, randomToken, safeReturnTo } from "./oauth";
import { configuredProviders, type ProviderDef } from "./providers";

describe("PKCE", () => {
  it("matches the RFC 7636 appendix B test vector", async () => {
    expect(await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });
  it("random tokens are url-safe and unique", () => {
    const a = randomToken(32);
    const b = randomToken(32);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe("safeReturnTo (no open redirects)", () => {
  it.each([
    ["/", "/"],
    ["/library?x=1", "/library?x=1"],
    ["?q=graph+neural", "/"],
    ["//evil.com", "/"],
    ["https://evil.com", "/"],
    ["/\\evil.com", "/"],
    ["javascript:alert(1)", "/"],
    ["/ok\nSet-Cookie: x=1", "/"],
    ["", "/"],
    [undefined, "/"],
    ["/" + "a".repeat(400), "/"],
  ])("%j -> %j", (input, expected) => {
    expect(safeReturnTo(input as string | undefined)).toBe(expected);
  });
});

const google: ProviderDef = configuredProviders({ GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "sec" })[0]!;

describe("authorize URL and token exchange", () => {
  it("builds a PKCE authorize URL with state", () => {
    const u = new URL(buildAuthorizeUrl(google, "https://app.test/api/v1/auth/google/callback", "STATE", "CHALLENGE"));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("client_id")).toBe("cid");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("code_challenge")).toBe("CHALLENGE");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("state")).toBe("STATE");
    expect(u.searchParams.get("redirect_uri")).toBe("https://app.test/api/v1/auth/google/callback");
  });

  it("sends the code verifier and client secret to the token endpoint, and rejects failures", async () => {
    const f = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = new URLSearchParams(init?.body as URLSearchParams);
      expect(body.get("code_verifier")).toBe("VERIFIER");
      expect(body.get("client_secret")).toBe("sec");
      expect(body.get("grant_type")).toBe("authorization_code");
      return new Response(JSON.stringify({ access_token: "at" }), { status: 200 });
    });
    const t = await exchangeCode(google, "CODE", "VERIFIER", "https://app.test/cb", f as unknown as typeof fetch);
    expect(t.access_token).toBe("at");

    const bad = vi.fn(async () => new Response("no", { status: 400 }));
    await expect(exchangeCode(google, "CODE", "V", "https://app.test/cb", bad as unknown as typeof fetch)).rejects.toThrow(/HTTP 400/);
    const noToken = vi.fn(async () => new Response("{}", { status: 200 }));
    await expect(exchangeCode(google, "CODE", "V", "https://app.test/cb", noToken as unknown as typeof fetch)).rejects.toThrow(/access_token/);
  });
});

describe("providers", () => {
  it("exposes only configured providers", () => {
    expect(configuredProviders({})).toHaveLength(0);
    expect(configuredProviders({ GOOGLE_CLIENT_ID: "a" })).toHaveLength(0); // needs the secret too
    expect(configuredProviders({ GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b" }).map((p) => p.id)).toEqual(["google"]);
    expect(
      configuredProviders({ GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b", ORCID_CLIENT_ID: "c", ORCID_CLIENT_SECRET: "d" }).map((p) => p.id),
    ).toEqual(["google", "orcid"]);
  });

  it("the dev identity provider override is ignored unless ENABLE_DEV_ROUTES=1 (prod cannot be redirected)", () => {
    const base = { GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b", DEV_IDP_URL: "http://evil.test" };
    expect(configuredProviders(base)[0]!.authorizeUrl).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(configuredProviders({ ...base, ENABLE_DEV_ROUTES: "1" })[0]!.authorizeUrl).toBe("http://evil.test/authorize");
  });

  it("ORCID profile requires a well-formed iD and keeps no email", async () => {
    const orcid = configuredProviders({ ORCID_CLIENT_ID: "c", ORCID_CLIENT_SECRET: "d" })[0]!;
    const p = await orcid.profile({ access_token: "x", orcid: "0000-0002-1825-0097", name: " Josiah Carberry " }, fetch);
    expect(p).toMatchObject({ subject: "0000-0002-1825-0097", email: null, emailVerified: false, name: "Josiah Carberry", orcid: "0000-0002-1825-0097" });
    await expect(orcid.profile({ access_token: "x", orcid: "not-an-orcid" }, fetch)).rejects.toThrow();
    // ORCID with a private name still logs in
    expect((await orcid.profile({ access_token: "x", orcid: "0000-0001-2345-678X", name: "" }, fetch)).name).toBeNull();
  });

  it("Google profile needs a sub and only trusts email_verified === true", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ sub: "s1", email: "a@b.c", email_verified: false, name: "A" }), { status: 200 }));
    const p = await google.profile({ access_token: "at" }, f as unknown as typeof fetch);
    expect(p).toMatchObject({ subject: "s1", email: "a@b.c", emailVerified: false });
    const nosub = vi.fn(async () => new Response("{}", { status: 200 }));
    await expect(google.profile({ access_token: "at" }, nosub as unknown as typeof fetch)).rejects.toThrow(/sub/);
  });
});
