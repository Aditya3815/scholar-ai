import { getDocumentProxy } from "unpdf";

/**
 * Spike R8: POST a PDF body, get back what a Worker could read from it: page count, characters, pages with no text layer, and the start of the text.
 * Time is measured by the caller (a Worker's own clock does not advance while it computes). Memory is judged by whether the isolate survives its 128 MB.
 * ?maxPages=N caps the pages read (the app would cap at 120).
 */
export default {
  async fetch(req: Request): Promise<Response> {
    // GET /probe?url=...: what Cloudflare's own network gets from an address (status, type, first bytes), to compare with a laptop's answer. Local preview only.
    const probe = new URL(req.url);
    if (req.method === "GET" && probe.pathname === "/probe") {
      const target = probe.searchParams.get("url") ?? "";
      try {
        const r = await fetch(target, { headers: { "User-Agent": "scholar-ai-spike/1.0 (mailto:tiadiaditya@gmail.com)", Accept: "application/pdf,*/*;q=0.5" }, redirect: "follow" });
        const head = new Uint8Array((await r.arrayBuffer()).slice(0, 5));
        return Response.json({ status: r.status, type: r.headers.get("content-type"), pdf: new TextDecoder().decode(head) === "%PDF-" });
      } catch (e) {
        return Response.json({ status: 0, error: String(e) });
      }
    }
    if (req.method !== "POST") return new Response("POST a PDF", { status: 405 });
    const url = new URL(req.url);
    const maxPages = Number(url.searchParams.get("maxPages") ?? 120);
    try {
      const bytes = new Uint8Array(await req.arrayBuffer());
      const pdf = await getDocumentProxy(bytes);
      const pages = pdf.numPages;
      const read = Math.min(pages, maxPages);
      let chars = 0;
      let empty = 0;
      let sample = "";
      for (let p = 1; p <= read; p++) {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        const text = content.items.map((i) => ("str" in i ? i.str : "")).join(" ").replace(/\s+/g, " ").trim();
        if (text.length < 20) empty++;
        chars += text.length;
        if (p === 1) sample = text.slice(0, 200);
        page.cleanup();
      }
      await (pdf as unknown as { destroy?: () => Promise<void> }).destroy?.();
      return Response.json({ ok: true, bytes: bytes.length, pages, read, chars, emptyPages: empty, sample });
    } catch (e) {
      return Response.json({ ok: false, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) }, { status: 500 });
    }
  },
};
