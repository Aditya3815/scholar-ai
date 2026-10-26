import { describe, expect, it } from "vitest";
import { checkFetchUrl, citationPdfUrl, fetchPdf, safeFetch, type FetchOptions } from "./safe-fetch";

const UA = "scholar-ai-test (mailto:test@example.com)";
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n");

/** A fake network: `routes` maps an address to what it answers; every request is recorded. */
function net(routes: Record<string, () => Response | Promise<Response>>) {
  const seen: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, init });
    const route = routes[url];
    if (!route) return new Response("not here", { status: 404 });
    return route();
  }) as typeof fetch;
  return { fetchImpl, seen };
}
const pdf = (headers: Record<string, string> = { "content-type": "application/pdf" }) => () => new Response(PDF, { status: 200, headers });
const redirect = (to: string, status = 302) => () => new Response(null, { status, headers: { location: to } });
const opts = (n: ReturnType<typeof net>, extra: Partial<FetchOptions> = {}): FetchOptions => ({ fetchImpl: n.fetchImpl, userAgent: UA, ...extra });

describe("checkFetchUrl", () => {
  it.each([
    "https://arxiv.org/pdf/1706.03762",
    "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC1/pdf/x.pdf",
    "https://journal.example.ac.in/article/12/download?file=a.pdf",
    "https://xn--bcher-kva.example/paper.pdf",
    "https://arxiv.org:443/pdf/1706.03762",
    "https://arxiv.org./pdf/1706.03762",
  ])("allows %s", (u) => expect(checkFetchUrl(u).ok).toBe(true));

  it("tries an http address as https, never in the clear", () => {
    const v = checkFetchUrl("http://journal.example.org/a.pdf");
    expect(v.ok && v.url.protocol).toBe("https:");
  });

  it.each([
    ["an IPv4 address", "https://192.168.1.10/a.pdf"],
    ["the loopback address", "https://127.0.0.1/a.pdf"],
    ["a decimal IP", "https://2130706433/a.pdf"],
    ["a hex IP", "https://0x7f.0.0.1/a.pdf"],
    ["an octal IP", "https://0177.0.0.1/a.pdf"],
    ["a short IP", "https://127.1/a.pdf"],
    ["an IPv6 address", "https://[::1]/a.pdf"],
    ["an IPv4-mapped IPv6 address", "https://[::ffff:127.0.0.1]/a.pdf"],
    ["the cloud metadata address", "https://169.254.169.254/latest/meta-data/"],
    ["localhost", "https://localhost/a.pdf"],
    ["a name with no dot", "https://intranet/a.pdf"],
    ["a .local name", "https://printer.local/a.pdf"],
    ["a .internal name", "https://metadata.google.internal/computeMetadata/v1/"],
    ["a .localhost name", "https://anything.localhost/a.pdf"],
    ["a non-standard port", "https://journal.example.org:8443/a.pdf"],
    ["a port on http", "http://journal.example.org:8080/a.pdf"],
    ["a password in the address", "https://user:pass@journal.example.org/a.pdf"],
    ["a user name only", "https://user@journal.example.org/a.pdf"],
    ["ftp", "ftp://journal.example.org/a.pdf"],
    ["file", "file:///etc/passwd"],
    ["javascript", "javascript:alert(1)"],
    ["data", "data:application/pdf;base64,JVBERi0="],
    ["a numeric ending", "https://example.123/a.pdf"],
    ["a space", "https://journal.example.org/a b.pdf"],
    ["a newline", "https://journal.example.org/a\n.pdf"],
    ["nothing", ""],
    ["not a URL", "not a url"],
    ["a label starting with a dash", "https://-bad.example.org/a.pdf"],
    ["an empty label", "https://journal..example.org/a.pdf"],
    ["a huge address", "https://journal.example.org/" + "a".repeat(2100)],
  ])("refuses %s", (_label, u) => expect(checkFetchUrl(u).ok).toBe(false));

  it("never throws, whatever it is given", () => {
    for (const v of [null, undefined, 5, {}, [], "https://", "https:///a", "//a.pdf", "https://%00.example.org/"] as unknown as string[]) expect(() => checkFetchUrl(v)).not.toThrow();
  });
});

describe("safeFetch", () => {
  it("fetches, sends a polite User-Agent and no ambient credentials, and does not follow redirects by itself", async () => {
    const n = net({ "https://a.example.org/x.pdf": pdf() });
    const r = await safeFetch("https://a.example.org/x.pdf", opts(n));
    expect(r.ok && r.bytes.length).toBe(PDF.length);
    const init = n.seen[0]!.init!;
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe(UA);
    expect(init.redirect).toBe("manual");
  });

  it("follows up to three redirects and checks every one of them", async () => {
    const n = net({
      "https://a.example.org/1": redirect("https://b.example.org/2"),
      "https://b.example.org/2": redirect("/3"),
      "https://b.example.org/3": redirect("https://c.example.org/4.pdf"),
      "https://c.example.org/4.pdf": pdf(),
    });
    const r = await safeFetch("https://a.example.org/1", opts(n));
    expect(r.ok && r.finalUrl).toBe("https://c.example.org/4.pdf");
  });

  it("refuses a fourth redirect", async () => {
    const n = net({
      "https://a.example.org/1": redirect("https://a.example.org/2"),
      "https://a.example.org/2": redirect("https://a.example.org/3"),
      "https://a.example.org/3": redirect("https://a.example.org/4"),
      "https://a.example.org/4": redirect("https://a.example.org/5"),
      "https://a.example.org/5": pdf(),
    });
    expect(await safeFetch("https://a.example.org/1", opts(n))).toEqual({ ok: false, reason: "blocked" });
    expect(n.seen.map((s) => s.url)).not.toContain("https://a.example.org/5");
  });

  it("a harmless address that redirects somewhere harmful is stopped at the second step, which is never requested", async () => {
    for (const evil of ["https://169.254.169.254/latest/meta-data/", "http://127.0.0.1:8788/api/v1/admin", "https://metadata.google.internal/", "https://[::1]/", "https://host.example.org:9999/a.pdf", "ftp://a.example.org/a.pdf", "https://user:pw@a.example.org/"]) {
      const n = net({ "https://a.example.org/start": redirect(evil), [evil]: pdf() });
      expect(await safeFetch("https://a.example.org/start", opts(n)), evil).toEqual({ ok: false, reason: "blocked" });
      expect(n.seen).toHaveLength(1);
    }
  });

  it("a redirect to http is requested as https", async () => {
    const n = net({ "https://a.example.org/s": redirect("http://b.example.org/f.pdf"), "https://b.example.org/f.pdf": pdf() });
    expect((await safeFetch("https://a.example.org/s", opts(n))).ok).toBe(true);
  });

  it("an address that cannot be read, in a Location header, is refused", async () => {
    const n = net({ "https://a.example.org/s": redirect("https://") });
    expect(await safeFetch("https://a.example.org/s", opts(n))).toEqual({ ok: false, reason: "blocked" });
  });

  it("stops a body that is larger than the cap while it is still arriving, even with no Content-Length", async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled += 1000;
        c.enqueue(new Uint8Array(1000));
        if (pulled > 1_000_000) c.close();
      },
    });
    const n = net({ "https://a.example.org/big": () => new Response(stream, { status: 200 }) });
    const r = await safeFetch("https://a.example.org/big", opts(n, { maxBytes: 5000 }));
    expect(r).toEqual({ ok: false, reason: "too_large" });
    expect(pulled).toBeLessThan(20_000); // it stopped reading, it did not read a megabyte first
  });

  it("refuses a file whose Content-Length is already over the cap without reading it", async () => {
    const n = net({ "https://a.example.org/big": () => new Response(new Uint8Array(10), { status: 200, headers: { "content-length": "999999999" } }) });
    expect(await safeFetch("https://a.example.org/big", opts(n))).toEqual({ ok: false, reason: "too_large" });
  });

  it("gives up after the time limit, also when the body never arrives", async () => {
    const never = ((input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as typeof fetch;
    const t0 = Date.now();
    expect(await safeFetch("https://a.example.org/slow", { fetchImpl: never, userAgent: UA, timeoutMs: 60 })).toEqual({ ok: false, reason: "timeout" });
    expect(Date.now() - t0).toBeLessThan(1000);
    const stalled = (async (_: RequestInfo | URL, init?: RequestInit) =>
      new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(10)); init?.signal?.addEventListener("abort", () => c.error(new DOMException("aborted", "AbortError"))); } }), { status: 200 })) as typeof fetch;
    expect(await safeFetch("https://a.example.org/stalled", { fetchImpl: stalled, userAgent: UA, timeoutMs: 60 })).toEqual({ ok: false, reason: "timeout" });
  });

  it("names the reason: blocked for 401 and 403, no source for 404 and 410, fetch failed otherwise", async () => {
    const status = (s: number) => net({ "https://a.example.org/x": () => new Response("no", { status: s }) });
    const reason = async (s: number) => (await safeFetch("https://a.example.org/x", opts(status(s)))) as { reason: string; status: number };
    expect(await reason(403)).toMatchObject({ reason: "blocked", status: 403 });
    expect(await reason(401)).toMatchObject({ reason: "blocked" });
    expect(await reason(404)).toMatchObject({ reason: "no_source" });
    expect(await reason(410)).toMatchObject({ reason: "no_source" });
    expect(await reason(429)).toMatchObject({ reason: "fetch_failed" });
    expect(await reason(500)).toMatchObject({ reason: "fetch_failed" });
    expect(await reason(503)).toMatchObject({ reason: "fetch_failed" });
  });

  it("a network error is a failed fetch, not an exception", async () => {
    const down = (async () => { throw new TypeError("network"); }) as unknown as typeof fetch;
    expect(await safeFetch("https://a.example.org/x", { fetchImpl: down, userAgent: UA })).toEqual({ ok: false, reason: "fetch_failed" });
  });
});

describe("citationPdfUrl", () => {
  it("finds the address in either attribute order, resolves a relative one and decodes &amp;", () => {
    expect(citationPdfUrl('<head><meta name="citation_pdf_url" content="https://p.example.org/a.pdf"></head>', "https://p.example.org/landing")).toBe("https://p.example.org/a.pdf");
    expect(citationPdfUrl('<meta content="/files/a.pdf?x=1&amp;y=2" name="citation_pdf_url" />', "https://p.example.org/landing")).toBe("https://p.example.org/files/a.pdf?x=1&y=2");
    expect(citationPdfUrl("<META NAME='citation_pdf_url' CONTENT='b.pdf'>", "https://p.example.org/x/landing")).toBe("https://p.example.org/x/b.pdf");
  });
  it("is null when the tag is missing or is about something else", () => {
    expect(citationPdfUrl('<meta name="citation_title" content="x">', "https://p.example.org/")).toBeNull();
    expect(citationPdfUrl("<html>nothing</html>", "https://p.example.org/")).toBeNull();
  });
});

describe("fetchPdf", () => {
  it("accepts a PDF by its first bytes, whatever the Content-Type says", async () => {
    const n = net({ "https://a.example.org/x": pdf({ "content-type": "text/plain" }) });
    expect((await fetchPdf("https://a.example.org/x", opts(n))).ok).toBe(true);
  });

  it("refuses a file that says it is a PDF but is not", async () => {
    const n = net({ "https://a.example.org/x": () => new Response("<?php echo 1; ?>", { status: 200, headers: { "content-type": "application/pdf" } }) });
    expect(await fetchPdf("https://a.example.org/x", opts(n))).toEqual({ ok: false, reason: "not_a_pdf" });
  });

  it("follows a landing page once, to the address it names, with every check again", async () => {
    const page = '<html><head><meta name="citation_pdf_url" content="https://files.example.org/p.pdf"></head></html>';
    const n = net({
      "https://a.example.org/landing": () => new Response(page, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }),
      "https://files.example.org/p.pdf": pdf(),
    });
    const r = await fetchPdf("https://a.example.org/landing", opts(n));
    expect(r.ok && r.finalUrl).toBe("https://files.example.org/p.pdf");
  });

  it("does not follow a landing page to a private address", async () => {
    const page = '<meta name="citation_pdf_url" content="https://169.254.169.254/latest/meta-data/">';
    const n = net({ "https://a.example.org/landing": () => new Response(page, { status: 200, headers: { "content-type": "text/html" } }) });
    expect(await fetchPdf("https://a.example.org/landing", opts(n))).toEqual({ ok: false, reason: "blocked" });
    expect(n.seen).toHaveLength(1);
  });

  it("does not follow a second landing page, and says the link did not lead to a PDF", async () => {
    const page = (to: string) => () => new Response(`<meta name="citation_pdf_url" content="${to}">`, { status: 200, headers: { "content-type": "text/html" } });
    const n = net({ "https://a.example.org/1": page("https://a.example.org/2"), "https://a.example.org/2": page("https://a.example.org/3"), "https://a.example.org/3": pdf() });
    expect(await fetchPdf("https://a.example.org/1", opts(n))).toEqual({ ok: false, reason: "not_a_pdf" });
    expect(n.seen.map((s) => s.url)).toEqual(["https://a.example.org/1", "https://a.example.org/2"]);
  });

  it("a landing page without the tag is not a PDF; a blocked publisher is blocked", async () => {
    const n = net({ "https://a.example.org/landing": () => new Response("<html>paywall</html>", { status: 200, headers: { "content-type": "text/html" } }), "https://b.example.org/x": () => new Response("no", { status: 403 }) });
    expect(await fetchPdf("https://a.example.org/landing", opts(n))).toEqual({ ok: false, reason: "not_a_pdf" });
    expect(await fetchPdf("https://b.example.org/x", opts(n))).toMatchObject({ ok: false, reason: "blocked" });
  });
});
