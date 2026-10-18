import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyReference } from "./verify";

const env = { CROSSREF_MAILTO: "test@example.org" };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const cr = (over: Record<string, unknown> = {}) => ({
  DOI: "10.1000/real.1",
  title: ["Graph neural networks for protein function prediction"],
  author: [{ given: "Anita", family: "Desai" }, { given: "Rahul", family: "Verma" }],
  issued: { "date-parts": [[2021, 5, 1]] },
  "container-title": ["Bioinformatics"],
  ...over,
});

type Handler = (url: string) => Response | Promise<Response> | undefined;
function stub(...handlers: Handler[]) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    for (const h of handlers) {
      const r = await h(url);
      if (r) return r;
    }
    return json({ message: { items: [] } }); // default: empty Crossref result (also fine for the retraction check)
  });
  return calls;
}
const retractedNotice = (doi: string) => ({ message: { items: [{ DOI: "10.1000/notice", "update-to": [{ DOI: doi, type: "retraction" }] }] } });

afterEach(() => vi.unstubAllGlobals());

const GOOD = "Desai, A., & Verma, R. (2021). Graph neural networks for protein function prediction. Bioinformatics, 37(5), 1-12.";

describe("with a DOI", () => {
  it("verifies when the DOI's record matches title, authors and year", async () => {
    stub((u) => (u.includes("/works/10.1000/real.1") ? json({ message: cr() }) : undefined));
    const r = await verifyReference(`${GOOD} https://doi.org/10.1000/real.1`, env);
    expect(r.status).toBe("verified");
    expect(r.match?.doi).toBe("10.1000/real.1");
    expect(r.retracted).toBe(false);
  });

  it("flags a verified reference whose DOI is retracted", async () => {
    stub((u) => (u.includes("/works/10.1000/real.1") && !u.includes("filter") ? json({ message: cr() }) : undefined), (u) => (u.includes("filter=updates") ? json(retractedNotice("10.1000/real.1")) : undefined));
    const r = await verifyReference(`${GOOD} doi:10.1000/real.1`, env);
    expect(r.status).toBe("verified");
    expect(r.retracted).toBe(true);
  });

  it("calls it a mismatch when the DOI belongs to a different paper", async () => {
    stub((u) => (u.includes("/works/10.1000/other") ? json({ message: cr({ DOI: "10.1000/other", title: ["A survey of soil microbiomes"], author: [{ family: "Okafor" }] }) }) : undefined));
    const r = await verifyReference(`${GOOD} 10.1000/other`, env);
    expect(r.status).toBe("mismatch");
    expect(r.reason).toMatch(/different paper/);
  });

  it("calls it a mismatch when the title is real but authors and year were altered", async () => {
    stub((u) => (u.includes("/works/10.1000/real.1") ? json({ message: cr() }) : undefined));
    const r = await verifyReference("Nakamura, T., Ito, K. (2015). Graph neural networks for protein function prediction. Nature Methods. 10.1000/real.1", env);
    expect(r.status).toBe("mismatch");
    expect(r.reason).toMatch(/authors do not match/);
  });

  it("not_found when the DOI does not exist anywhere", async () => {
    stub(
      (u) => (u.includes("api.crossref.org/works/10.1000/ghost") && !u.includes("filter") ? new Response("", { status: 404 }) : undefined),
      (u) => (u.includes("api.openalex.org/works/doi:") ? new Response("", { status: 404 }) : undefined),
      (u) => (u.includes("doi.org/api/handles/") ? json({ responseCode: 100 }, 404) : undefined),
    );
    const r = await verifyReference(`${GOOD} https://doi.org/10.1000/ghost`, env);
    expect(r.status).toBe("not_found");
    expect(r.reason).toMatch(/does not exist/);
  });

  it("falls back to OpenAlex for DOIs Crossref does not hold (arXiv, Zenodo)", async () => {
    stub(
      (u) => (u.includes("api.crossref.org/works/10.48550/") && !u.includes("filter") ? new Response("", { status: 404 }) : undefined),
      (u) => (u.includes("api.openalex.org/works/doi:10.48550/") ? json({ doi: "https://doi.org/10.48550/arxiv.1706.03762", title: "Attention is All you Need", publication_year: 2017, authorships: [{ author: { display_name: "Ashish Vaswani" } }] }) : undefined),
    );
    const r = await verifyReference("Vaswani, A. et al. (2017). Attention is all you need. arXiv. https://doi.org/10.48550/arXiv.1706.03762", env);
    expect(r.status).toBe("verified");
  });

  it("unverifiable (not verified, not not_found) when the DOI exists but has no readable record", async () => {
    stub(
      (u) => (u.includes("api.crossref.org/works/10.5555/x") && !u.includes("filter") ? new Response("", { status: 404 }) : undefined),
      (u) => (u.includes("api.openalex.org/works/doi:") ? new Response("", { status: 404 }) : undefined),
      (u) => (u.includes("doi.org/api/handles/") ? json({ responseCode: 1 }) : undefined),
    );
    expect((await verifyReference(`${GOOD} 10.5555/x`, env)).status).toBe("unverifiable");
  });
});

describe("without a DOI", () => {
  it("verifies via Crossref bibliographic search", async () => {
    stub((u) => (u.includes("query.bibliographic") ? json({ message: { items: [cr({ DOI: "10.1000/decoy", title: ["Protein structure prediction with transformers"] }), cr()] } }) : undefined));
    const r = await verifyReference(GOOD, env);
    expect(r.status).toBe("verified");
    expect(r.match?.doi).toBe("10.1000/real.1");
  });

  it("not_found for an invented reference nothing resembles", async () => {
    stub((u) => (u.includes("query.bibliographic") ? json({ message: { items: [cr({ title: ["Soil carbon in tropical forests"], author: [{ family: "Silva" }] })] } }) : undefined));
    const r = await verifyReference("Kapoor, S., & Menon, V. (2022). Quantum reservoir scheduling for monsoon-aware banking. Journal of Applied Fictional Studies, 12(3), 55-71.", env);
    expect(r.status).toBe("not_found");
  });

  it("mismatch (never verified) when only the title is real", async () => {
    stub((u) => (u.includes("query.bibliographic") ? json({ message: { items: [cr()] } }) : undefined));
    const r = await verifyReference("Nakamura, T., Ito, K. (2015). Graph neural networks for protein function prediction. Nature Methods.", env);
    expect(r.status).toBe("mismatch");
    expect(r.match?.doi).toBe("10.1000/real.1"); // shown as the suggested real paper
  });
});

describe("markup in registry titles", () => {
  it("verifies a reference whose Crossref title carries <i> tags, without gluing the words together", async () => {
    stub((u) => (u.includes("query.bibliographic") ? json({ message: { items: [cr({ DOI: "10.1000/ital.1", title: ["<i>Anionic Mishran</i> Supplementation to Check Incidence of Milk Fever"], author: [{ given: "Rakesh", family: "Thakur" }], issued: { "date-parts": [[2017]] } })] } }) : undefined));
    const r = await verifyReference("Thakur, R., P.K. Dogra, V. Sankhyan, and P. Sood. 2017. Anionic Mishran Supplementation to Check Incidence of Milk Fever. Journal of Animal Research 7(3).", env);
    expect(r.status).toBe("verified");
    expect(r.match?.title).toBe("Anionic Mishran Supplementation to Check Incidence of Milk Fever");
  });

  it("keeps words apart when a tag sits between them with no space", async () => {
    stub((u) => (u.includes("/works/10.1000/glue.1") && !u.includes("filter") ? json({ message: cr({ DOI: "10.1000/glue.1", title: ["<i>In vitro</i>antibiofilm activity of<i>Murraya</i>oil"] }) }) : undefined));
    const r = await verifyReference("Desai A. In vitro antibiofilm activity of Murraya oil. Bioinformatics 2021. 10.1000/glue.1", env);
    expect(r.match?.title).toBe("In vitro antibiofilm activity of Murraya oil");
  });
});

describe("OpenAlex as a second source", () => {
  const ARXIV = "Kingma, D. P., & Ba, J. (2015). Adam: A method for stochastic optimization. In International Conference on Learning Representations.";
  const oaWork = (over: Record<string, unknown> = {}) => ({
    doi: "https://doi.org/10.48550/arxiv.1412.6980",
    title: "Adam: A Method for Stochastic Optimization",
    publication_year: 2014,
    authorships: [{ author: { display_name: "Diederik P. Kingma" } }, { author: { display_name: "Jimmy Ba" } }],
    primary_location: { source: { display_name: "arXiv" } },
    ...over,
  });
  const oaSearch = (results: unknown[]): Handler => (u) => (u.includes("api.openalex.org/works?") ? json({ results }) : undefined);

  it("verifies a preprint Crossref does not index, and says where it was found", async () => {
    const calls = stub(oaSearch([oaWork()]));
    const r = await verifyReference(ARXIV, env);
    expect(r.status).toBe("verified");
    expect(r.match?.doi).toBe("10.48550/arxiv.1412.6980");
    expect(r.reason).toMatch(/Found in OpenAlex/);
    expect(calls.some((u) => u.includes("title.search"))).toBe(true);
  });

  const LN = "Jimmy Lei Ba, Jamie Ryan Kiros, and Geoffrey E Hinton. Layer normalization. arXiv preprint arXiv:1607.06450, 2016.";
  const lnWork = (over: Record<string, unknown> = {}) => oaWork({ doi: "https://doi.org/10.48550/arxiv.1607.06450", title: "Layer Normalization", publication_year: 2016, authorships: [{ author: { display_name: "Jimmy Lei Ba" } }, { author: { display_name: "Geoffrey E. Hinton" } }], ...over });
  const oaByDoi = (w: unknown): Handler => (u) => (u.includes("/works/doi:10.48550/arxiv.1607.06450") ? json(w) : undefined);

  it("verifies a reference through its arXiv id without searching", async () => {
    const calls = stub(oaByDoi(lnWork()));
    const r = await verifyReference(LN, env);
    expect(r.status).toBe("verified");
    expect(r.reason).toMatch(/arXiv id/);
    expect(calls.some((u) => u.includes("query.bibliographic"))).toBe(false);
  });

  it("uses the year the preprint first appeared, not the latest version OpenAlex reports", async () => {
    stub(oaByDoi(lnWork({ publication_year: 2025 })));
    expect((await verifyReference(LN, env)).status).toBe("verified");
  });

  it("does not hold a different record behind the id against the reference: the search decides", async () => {
    stub(oaByDoi(lnWork({ title: "A Study of Soil Microbes", authorships: [{ author: { display_name: "Maria Silva" } }] })), oaSearch([lnWork()]));
    const r = await verifyReference(LN, env);
    expect(r.status).toBe("verified");
    expect(r.reason).toMatch(/Found in OpenAlex\./);
  });

  it("finds a short title that the title guess would have missed", async () => {
    const calls = stub(oaSearch([lnWork()]));
    const r = await verifyReference(LN.replace("arXiv preprint arXiv:1607.06450, ", ""), env);
    expect(r.status).toBe("verified");
    expect(calls.find((u) => u.includes("title.search"))).toMatch(/title\.search(%3A|:)Layer(\+|%20)normalization/);
  });

  it("is not asked when Crossref already verified the reference", async () => {
    const calls = stub((u) => (u.includes("query.bibliographic") ? json({ message: { items: [cr()] } }) : undefined), oaSearch([oaWork()]));
    expect((await verifyReference(GOOD, env)).status).toBe("verified");
    expect(calls.some((u) => u.includes("openalex"))).toBe(false);
  });

  it("lets a real OpenAlex record replace a Crossref near-miss", async () => {
    stub((u) => (u.includes("query.bibliographic") ? json({ message: { items: [cr({ title: ["Adam: a method for stochastic optimization (comment)"], author: [{ family: "Reviewer" }], issued: { "date-parts": [[2019]] } })] } }) : undefined), oaSearch([oaWork()]));
    const r = await verifyReference(ARXIV, env);
    expect(r.status).toBe("verified");
    expect(r.match?.authors[0]).toBe("Diederik P. Kingma");
  });

  it("still says not_found for an invented reference, naming both sources", async () => {
    stub(oaSearch([oaWork({ title: "Soil carbon in tropical forests", authorships: [{ author: { display_name: "Maria Silva" } }] })]));
    const r = await verifyReference("Kapoor, S., & Menon, V. (2022). Quantum reservoir scheduling for monsoon-aware banking. Journal of Applied Fictional Studies, 12(3), 55-71.", env);
    expect(r.status).toBe("not_found");
    expect(r.reason).toMatch(/Crossref or OpenAlex/);
  });

  it("a failing OpenAlex changes nothing: Crossref's answer stands, and the wording only names Crossref", async () => {
    stub((u) => (u.includes("api.openalex.org") ? new Response("", { status: 429 }) : undefined));
    const r = await verifyReference("Kapoor, S., & Menon, V. (2022). Quantum reservoir scheduling for monsoon-aware banking. Journal of Applied Fictional Studies, 12(3), 55-71.", env);
    expect(r.status).toBe("not_found");
    expect(r.reason).toMatch(/in Crossref\./);
    expect(r.reason).not.toMatch(/OpenAlex/);
  });

  it("does not turn an OpenAlex record with the right title but wrong authors into a verification", async () => {
    stub(oaSearch([oaWork({ authorships: [{ author: { display_name: "Maria Silva" } }], publication_year: 2003 })]));
    const r = await verifyReference(ARXIV, env);
    expect(r.status).toBe("mismatch");
  });
});

describe("failure handling never lies", () => {
  it("unverifiable when the databases are unreachable (not not_found)", async () => {
    vi.stubGlobal("fetch", async () => { throw new Error("network down"); });
    expect((await verifyReference(GOOD, env)).status).toBe("unverifiable");
    expect((await verifyReference(`${GOOD} 10.1000/real.1`, env)).status).toBe("unverifiable");
  });

  it("unverifiable on HTTP 500 from Crossref", async () => {
    stub((u) => (u.includes("query.bibliographic") ? new Response("", { status: 500 }) : undefined));
    expect((await verifyReference(GOOD, env)).status).toBe("unverifiable");
  });

  it("unparsed for tiny or empty input, without any network call", async () => {
    const calls = stub();
    for (const s of ["", "   ", "Smith 2020", "x y"]) expect((await verifyReference(s, env)).status).toBe("unparsed");
    expect(calls).toHaveLength(0);
  });

  it("a failing retraction check leaves `retracted` unset instead of claiming false", async () => {
    stub((u) => (u.includes("filter=updates") ? new Response("", { status: 500 }) : undefined), (u) => (u.includes("query.bibliographic") ? json({ message: { items: [cr()] } }) : undefined));
    const r = await verifyReference(GOOD, env);
    expect(r.status).toBe("verified");
    expect(r.retracted).toBeUndefined();
  });
});
