import { getDocumentProxy } from "unpdf";

/**
 * Spike R8: POST a PDF body, get back what a Worker could read from it: page count, characters, pages with no text layer, and the start of the text.
 * Time is measured by the caller (a Worker's own clock does not advance while it computes). Memory is judged by whether the isolate survives its 128 MB.
 * ?maxPages=N caps the pages read (the app would cap at 120).
 */
export default {
  async fetch(req: Request): Promise<Response> {
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
