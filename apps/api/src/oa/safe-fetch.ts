import { MAX_OA_BYTES, MAX_OA_REDIRECTS, OA_FETCH_TIMEOUT_MS, type OaReason } from "@scholar/shared";

/**
 * Fetching a file from an address that came from a search record, which means from a stranger. Every rule here is about not being used against someone else:
 *  - HTTPS only (an `http://` address is tried as `https://`, never fetched in the clear), no password in the address, no port but the default;
 *  - a real host name: no IP address in any spelling (the URL parser turns `2130706433` and `0x7f.1` into `127.0.0.1`, which is then refused), at least one dot, a letter-only
 *    ending, nothing that names a private network (`.local`, `.internal`, `localhost` ...);
 *  - **every redirect is checked again** (at most 3), because a harmless address can send us to a harmful one;
 *  - a size cap counted while the body streams in (a missing or lying Content-Length cannot get past it) and one time limit for the whole thing;
 *  - a polite User-Agent with a contact address (a Worker sends no cookies of its own).
 * Cloudflare's own network refuses to connect to private addresses; this is the second wall, and it keeps the first from being the only thing between us and a mistake.
 */

const PRIVATE_SUFFIXES = [".local", ".localhost", ".internal", ".localdomain", ".lan", ".home", ".corp", ".intranet", ".private", ".home.arpa"];

export type UrlVerdict = { ok: true; url: URL } | { ok: false };

/** Is this an address we may fetch? `http://` becomes `https://` first. Never throws. */
export function checkFetchUrl(raw: string): UrlVerdict {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048 || /[\u0000-\u001f\u007f\s]/.test(raw)) return { ok: false };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false };
  }
  if (url.protocol === "http:") url.protocol = "https:";
  if (url.protocol !== "https:") return { ok: false };
  if (url.username || url.password) return { ok: false };
  if (url.port !== "") return { ok: false }; // the default port only (443 is dropped by the parser)
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host.length === 0 || host.length > 253) return { ok: false };
  if (!/^[a-z0-9.-]+$/.test(host)) return { ok: false }; // also refuses [IPv6] and anything with odd characters
  if (/^\d+(?:\.\d+){3}$/.test(host)) return { ok: false }; // an IPv4 address, however it was written
  const labels = host.split(".");
  if (labels.length < 2 || labels.some((l) => l.length === 0 || l.length > 63 || l.startsWith("-") || l.endsWith("-"))) return { ok: false };
  const tld = labels[labels.length - 1]!;
  if (!/^(?:[a-z]{2,}|xn--[a-z0-9-]+)$/.test(tld)) return { ok: false };
  if (host === "localhost" || PRIVATE_SUFFIXES.some((s) => host.endsWith(s))) return { ok: false };
  url.hostname = host;
  url.hash = "";
  return { ok: true, url };
}

export type Fetched = { ok: true; bytes: Uint8Array; contentType: string; finalUrl: string };
export type FetchFailed = { ok: false; reason: OaReason; status?: number };

export type FetchOptions = {
  fetchImpl?: typeof fetch;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  accept?: string;
  userAgent: string;
};

/** Reads the body, stopping (and cancelling the download) the moment it passes `max`. Null if it did. */
async function readCapped(res: Response, max: number): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

export async function safeFetch(rawUrl: string, opts: FetchOptions): Promise<Fetched | FetchFailed> {
  const f = opts.fetchImpl ?? fetch;
  const max = opts.maxBytes ?? MAX_OA_BYTES;
  const maxRedirects = opts.maxRedirects ?? MAX_OA_REDIRECTS;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? OA_FETCH_TIMEOUT_MS);
  try {
    let current = rawUrl;
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const verdict = checkFetchUrl(current);
      if (!verdict.ok) return { ok: false, reason: "blocked" };
      let res: Response;
      try {
        res = await f(verdict.url.href, {
          method: "GET",
          redirect: "manual",
          signal: ctl.signal,
          headers: { "User-Agent": opts.userAgent, Accept: opts.accept ?? "*/*" },
        });
      } catch (e) {
        return { ok: false, reason: ctl.signal.aborted || (e instanceof Error && e.name === "AbortError") ? "timeout" : "fetch_failed" };
      }
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        await res.body?.cancel().catch(() => {});
        try {
          current = new URL(res.headers.get("location")!, verdict.url).href;
        } catch {
          return { ok: false, reason: "blocked" };
        }
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        const reason: OaReason = res.status === 401 || res.status === 403 ? "blocked" : res.status === 404 || res.status === 410 ? "no_source" : "fetch_failed";
        return { ok: false, reason, status: res.status };
      }
      let bytes: Uint8Array | null;
      try {
        bytes = await readCapped(res, max);
      } catch (e) {
        return { ok: false, reason: ctl.signal.aborted || (e instanceof Error && e.name === "AbortError") ? "timeout" : "fetch_failed" };
      }
      if (!bytes) return { ok: false, reason: "too_large" };
      return { ok: true, bytes, contentType: res.headers.get("content-type") ?? "", finalUrl: verdict.url.href };
    }
    return { ok: false, reason: "blocked" }; // more redirects than allowed
  } finally {
    clearTimeout(timer);
  }
}

const startsWithPdf = (b: Uint8Array) => new TextDecoder("latin1").decode(b.subarray(0, 1024)).includes("%PDF-");

/** The PDF address a publisher's landing page names for itself (`<meta name="citation_pdf_url" content="...">`, in either attribute order), or null. */
export function citationPdfUrl(html: string, base: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (!/\bname\s*=\s*["']citation_pdf_url["']/i.test(tag)) continue;
    const content = /\bcontent\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (!content) continue;
    try {
      return new URL(content.replace(/&amp;/g, "&"), base).href;
    } catch {
      return null;
    }
  }
  return null;
}

export type FetchedPdf = { ok: true; bytes: Uint8Array; finalUrl: string } | FetchFailed;

/**
 * A PDF from an address: the bytes must start with `%PDF-` (the Content-Type header is not believed). If the address is a landing page instead, the page is read once for
 * its `citation_pdf_url` and that address is tried with every check again; a second landing page is not followed.
 */
export async function fetchPdf(url: string, opts: FetchOptions): Promise<FetchedPdf> {
  const accept = "application/pdf,*/*;q=0.5";
  const first = await safeFetch(url, { ...opts, accept });
  if (!first.ok) return first;
  if (startsWithPdf(first.bytes)) return { ok: true, bytes: first.bytes, finalUrl: first.finalUrl };
  if (!/html/i.test(first.contentType)) return { ok: false, reason: "not_a_pdf" };
  const next = citationPdfUrl(new TextDecoder().decode(first.bytes.subarray(0, 300_000)), first.finalUrl);
  if (!next) return { ok: false, reason: "not_a_pdf" };
  const second = await safeFetch(next, { ...opts, accept });
  if (!second.ok) return second;
  return startsWithPdf(second.bytes) ? { ok: true, bytes: second.bytes, finalUrl: second.finalUrl } : { ok: false, reason: "not_a_pdf" };
}
