// Tiny HTTP client for integration tests: cookie jar, manual redirects, follows the OAuth hops to the fake IdP.
export function createClient(APP) {
  const jar = new Map();
  const send = async (url, init = {}) => {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(url, { redirect: "manual", ...init, headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) } });
    for (const sc of res.headers.getSetCookie?.() ?? []) {
      const [pair] = sc.split(";");
      const [k, ...v] = pair.split("=");
      if (/max-age=0|expires=thu, 01 jan 1970/i.test(sc) || v.join("=") === "") jar.delete(k);
      else jar.set(k, v.join("="));
    }
    return res;
  };
  /** Follows redirects until the app (non-API path) is reached again. */
  const follow = async (url) => {
    let res = await send(url);
    for (let i = 0; i < 6 && res.status >= 300 && res.status < 400; i++) {
      const loc = new URL(res.headers.get("location"), url);
      if (loc.origin === APP && !loc.pathname.startsWith("/api/")) return { res, final: loc };
      url = loc.toString();
      res = await send(url);
    }
    return { res, final: new URL(url) };
  };
  /** Same-origin JSON request (browsers send Origin on these; Node does not, so add it). */
  const api = (path, { method = "GET", body, origin = APP } = {}) =>
    send(`${APP}${path}`, {
      method,
      headers: { ...(origin ? { Origin: origin } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  const me = async () => (await (await send(`${APP}/api/v1/auth/me`)).json()).user;
  return { send, follow, api, me, jar };
}
