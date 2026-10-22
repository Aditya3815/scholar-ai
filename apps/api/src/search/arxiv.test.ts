import { afterEach, describe, expect, it, vi } from "vitest";
import { arxiv, arxivQuery, parseArxivFeed } from "./arxiv";

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/2301.04567v2</id>
    <published>2023-01-11T10:00:00Z</published>
    <title>Deep   learning for
      glaucoma screening on smartphones &amp; low-cost lenses</title>
    <summary>  We present a CNN that screens glaucoma from smartphone fundus images.
      It was tested in rural clinics.  </summary>
    <author><name>Anita Desai</name></author>
    <author><name>Rahul Verma</name></author>
    <arxiv:doi>10.1000/Example.2023.5</arxiv:doi>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/hep-th/9901001v1</id>
    <published>1999-01-02T00:00:00Z</published>
    <title>An old-style identifier paper</title>
    <summary>Short.</summary>
    <author><name>Old Author</name></author>
  </entry>
  <entry><id>http://arxiv.org/abs/2302.00001v1</id><title></title></entry>
</feed>`;

afterEach(() => vi.unstubAllGlobals());

describe("parseArxivFeed", () => {
  const [a, b, ...rest] = parseArxivFeed(FEED);
  it("reads the entries and ignores one with no title", () => {
    expect(rest).toHaveLength(0);
    expect(a!.title).toBe("Deep learning for glaucoma screening on smartphones & low-cost lenses");
    expect(a!.authors).toEqual(["Anita Desai", "Rahul Verma"]);
    expect(a!.year).toBe(2023);
    expect(a!.abstract).toBe("We present a CNN that screens glaucoma from smartphone fundus images. It was tested in rural clinics.");
    expect(a!.venue).toBe("arXiv");
    expect(a!.workType).toBe("preprint");
    expect(a!.oaUrl).toBe("https://arxiv.org/pdf/2301.04567");
  });
  it("uses the paper's own DOI when it has one, else the DOI arXiv registers, else none (old-style identifiers)", () => {
    expect(a!.doi).toBe("10.1000/example.2023.5");
    expect(parseArxivFeed(FEED.replace("<arxiv:doi>10.1000/Example.2023.5</arxiv:doi>", ""))[0]!.doi).toBe("10.48550/arxiv.2301.04567");
    expect(b!.doi).toBeNull();
  });
});

describe("arxivQuery", () => {
  it("asks for every meaningful word, without the little ones, at most six", () => {
    expect(arxivQuery("smartphone fundus photography for glaucoma")).toBe("all:smartphone AND all:fundus AND all:photography AND all:glaucoma");
    expect(arxivQuery("a method of the using it")).toBe("all:method AND all:it".replace(" AND all:it", ""));
    expect(arxivQuery("one two three four five six seven eight").split(" AND ")).toHaveLength(6);
    expect(arxivQuery("of the a")).toBe("");
  });
});

describe("arxiv provider", () => {
  it("fetches the feed and parses it, and fails loudly on an HTTP error", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (u: unknown) => (urls.push(String(u)), new Response(FEED, { status: 200 })));
    const out = await arxiv.search("glaucoma smartphone screening", 5, { store: undefined as never, CROSSREF_MAILTO: "x" }, new AbortController().signal);
    expect(out).toHaveLength(2);
    expect(decodeURIComponent(urls[0]!).replace(/\+/g, " ")).toContain("search_query=all:glaucoma AND all:smartphone AND all:screening");
    expect(urls[0]).toContain("max_results=5");
    vi.stubGlobal("fetch", async () => new Response("", { status: 503 }));
    await expect(arxiv.search("glaucoma screening", 5, { store: undefined as never, CROSSREF_MAILTO: "x" }, new AbortController().signal)).rejects.toThrow(/HTTP 503/);
  });
  it("does not call arXiv for a query with nothing to search for", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await arxiv.search("of the", 5, { store: undefined as never, CROSSREF_MAILTO: "x" }, new AbortController().signal)).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });
});
