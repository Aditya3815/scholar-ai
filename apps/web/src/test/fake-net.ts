/**
 * A stand-in for the network, for the page's request and stream tests (docs/design/untangle.md, F9): every request is recorded as the server would see it (address, method, headers, body,
 * credentials, keepalive, whether it can be aborted), and `reply` says what the server answers. Installed as globalThis.fetch.
 */
export type Call = { url: string; method: string; headers: Record<string, string>; body: unknown; credentials: string | undefined; keepalive: boolean | undefined; signal: boolean };

export type Net = { calls: Call[]; reply: (call: Call, n: number) => Response | Promise<Response> };

const bodyOf = (b: unknown): unknown => {
  if (typeof b !== "string") return b ?? null;
  try {
    return JSON.parse(b);
  } catch {
    return b;
  }
};

export function fakeNet(reply: Net["reply"] = () => json({})): Net {
  const net: Net = { calls: [], reply };
  (globalThis as unknown as { fetch: unknown }).fetch = async (url: string, init: RequestInit = {}) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => (headers[k] = v));
    const call: Call = { url: String(url), method: init.method ?? "GET", headers, body: bodyOf(init.body), credentials: init.credentials, keepalive: init.keepalive, signal: !!init.signal };
    net.calls.push(call);
    if (init.signal?.aborted) throw new DOMException("aborted", "AbortError");
    return net.reply(call, net.calls.length);
  };
  return net;
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

/** An error reply as the API sends one (a problem), or a reply with no problem in it (`body` a string). */
export const problem = (status: number, body: Record<string, unknown> | string = {}, headers: Record<string, string> = {}) =>
  typeof body === "string" ? new Response(body, { status, headers }) : json(body, status, headers);

/** An event stream: each event a `data:` line and a blank line. A string is sent as it is (to send a broken event). */
export const sse = (events: unknown[], status = 200) =>
  new Response(
    new ReadableStream({
      start(c) {
        const enc = new TextEncoder();
        for (const e of events) c.enqueue(enc.encode(typeof e === "string" ? e : `data: ${JSON.stringify(e)}\n\n`));
        c.close();
      },
    }),
    { status, headers: { "Content-Type": "text/event-stream" } },
  );

/** A network failure, as fetch reports one. */
export const offline = (): never => {
  throw new TypeError("Failed to fetch");
};
