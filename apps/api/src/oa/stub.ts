/**
 * The network, offline (tests and the local end-to-end run only: QA_STUB=1 together with ENABLE_DEV_ROUTES=1, never production secrets). It answers like Europe PMC, OpenAlex,
 * arXiv and a few publishers would for DOIs that start with 10.5555/oa., and the DOI says what happens:
 *   oa.xml      open access in PubMed Central: the full-text XML of a small article about glaucoma screening (CC BY)
 *   oa.slow     the same, but the XML takes 2.5 seconds (two people asking at once, progress)
 *   oa.flaky    the same, but the first download of the XML fails with a 500 (the step is tried again)
 *   oa.pdf      not in PubMed Central; OpenAlex gives a free PDF (CC BY) about federated learning
 *   oa.landing  OpenAlex gives a landing page whose citation_pdf_url leads to that PDF
 *   oa.blocked  OpenAlex gives a PDF address that answers 403
 *   oa.scanned  a PDF that is pictures of pages (no text)
 *   oa.wrong    OpenAlex's title and the PDF it links to are two different papers
 *   oa.long     a PDF of 130 pages
 *   oa.closed   known to Europe PMC, not open access, no free copy anywhere
 * and the arXiv number 2401.00001 is a PDF about graph neural networks (with an arXiv API record). Anything else is not found.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A tiny valid PDF writer (Helvetica, one block of text per page). The same idea as scripts/lib/make-pdf.mjs, which the browser tests use; ASCII only. */
export function tinyPdf(pages: string[]): Uint8Array {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const objs: string[] = [];
  const add = (body: string) => objs.push(body);
  add(""); // 1 catalog
  add(""); // 2 pages
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"); // 3 font
  const kids: number[] = [];
  for (const text of pages) {
    const lines: string[] = [];
    for (const para of text.split("\n")) {
      let line = "";
      for (const w of para.split(/\s+/)) {
        if ((line + " " + w).trim().length > 80) {
          lines.push(line.trim());
          line = w;
        } else line = (line + " " + w).trim();
      }
      lines.push(line);
    }
    const stream = ["BT", "/F1 11 Tf", "14 TL", "56 780 Td", ...lines.map((l) => `(${esc(l)}) Tj T*`), "ET"].join("\n");
    add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const content = objs.length;
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${content} 0 R >>`);
    kids.push(objs.length);
  }
  objs[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(out, (c) => c.charCodeAt(0));
}

const TITLE_XML = "Smartphone Retinal Imaging for Glaucoma Screening in Rural Clinics";
const GLAUCOMA_SECTIONS: [string, string][] = [
  ["Introduction", "Glaucoma is a leading cause of irreversible blindness, and most people with it in rural areas are never examined. Screening needs equipment that a primary clinic can afford."],
  ["Methods > Participants", "We enrolled 240 adults aged over forty years from six primary health centres in Karnataka. Every participant gave written informed consent before the examination."],
  ["Methods > Imaging", "Fundus photographs were taken with a low cost smartphone adapter by trained health workers. Two ophthalmologists graded each image independently and disagreements were settled by a third."],
  ["Results", "The area under the curve was 0.94 for the smartphone system. Sensitivity was 91 percent and specificity was 87 percent against the reference examination."],
  ["Discussion", "The cost per screened person was four dollars, much less than a clinic visit. The limitations of this study are a single region and a modest sample size."],
];
const jatsXml = () =>
  `<?xml version="1.0" encoding="UTF-8"?><article><front><article-meta><title-group><article-title>${TITLE_XML}</article-title></title-group>` +
  `<permissions><license license-type="open-access" xlink:href="https://creativecommons.org/licenses/by/4.0/"><license-p>Creative Commons Attribution License</license-p></license></permissions>` +
  `<abstract><p>We evaluated a smartphone adapter for retinal imaging in rural primary clinics. Sensitivity for glaucoma was 91 percent and specificity was 87 percent.</p></abstract></article-meta></front>` +
  `<body>${GLAUCOMA_SECTIONS.map(([t, p]) => {
    const parts = t.split(" > ");
    return parts.length === 2 ? `<sec><title>${parts[0]}</title><sec><title>${parts[1]}</title><p>${p}</p></sec></sec>` : `<sec><title>${t}</title><p>${p}</p></sec>`;
  }).join("")}</body><back><ref-list><ref><mixed-citation>Someone S. 2001. An old paper that must not be read.</mixed-citation></ref></ref-list></back></article>`;

const FEDERATED_TITLE = "Federated Learning for Hospital Data: A Practical Guide";
const federatedPdf = () =>
  tinyPdf([
    `${FEDERATED_TITLE}\nAbstract. We train a federated model across five hospitals without sharing patient records. The method keeps every record inside the hospital that holds it.`,
    "Methods. Each hospital trains a local copy of the model for three epochs and sends only the weight updates to a coordinator. The coordinator averages the updates and sends the new model back to every hospital.",
    "Results. The federated model reached an accuracy of 0.89 on the pooled test set, close to the 0.91 of a model trained on all the records together. Communication cost was under two megabytes per round.",
  ]);
const GNN_TITLE = "Graph Neural Networks for Drug Discovery: A Survey";
const gnnPdf = () =>
  tinyPdf([
    `${GNN_TITLE}\nAbstract. Graph neural networks represent molecules as graphs of atoms and bonds. This survey reviews how they are used to predict the properties of drug candidates.`,
    "Applications. Message passing networks predict toxicity and solubility from the structure of a molecule. Generative graph models propose new molecules with the desired properties.",
    "Challenges. Labelled data is scarce and the activity of a molecule depends on measurements that are noisy. Evaluation on scaffolds not seen in training remains difficult for these models.",
  ]);
const scannedPdf = () => tinyPdf(["", "", ""]);
const wrongPdf = () =>
  tinyPdf([
    "Tomato Cultivation in Greenhouses\nAbstract. Growing tomatoes under glass needs careful control of temperature, humidity and watering through the whole season of the crop, and a grower who gets any of the three wrong loses a large part of the harvest.",
    "Methods. We compared three watering schedules across twelve greenhouses over two seasons and measured the yield of every plant in each of the greenhouses, weighing the fruit once a week from the first picking to the last of the season.",
    "Results. The drip schedule gave the highest yield and the lowest use of water in all twelve greenhouses over both of the seasons that were studied, and the difference between the schedules was larger in the hotter of the two seasons.",
  ]);
const longPdf = () => tinyPdf(Array.from({ length: 130 }, (_, i) => `Page ${i + 1}. A page of a very long report that is more than a hundred and twenty pages in length.`));

const PDFS: Record<string, () => Uint8Array> = { "oa-pdf.pdf": federatedPdf, "scanned.pdf": scannedPdf, "other.pdf": wrongPdf, "long.pdf": longPdf, "gnn.pdf": gnnPdf };
const pdfResponse = (bytes: Uint8Array) => new Response(bytes as BodyInit, { status: 200, headers: { "content-type": "application/pdf", "content-length": String(bytes.length) } });
const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });

/** DOI -> what Europe PMC says. */
const EPMC: Record<string, { pmcid?: string; open: boolean; title: string }> = {
  "10.5555/oa.xml": { pmcid: "PMC9000001", open: true, title: TITLE_XML },
  "10.5555/oa.slow": { pmcid: "PMC9000003", open: true, title: TITLE_XML },
  "10.5555/oa.flaky": { pmcid: "PMC9000002", open: true, title: TITLE_XML },
  "10.5555/oa.closed": { open: false, title: "A Paper Behind A Paywall" },
};
/** DOI -> what OpenAlex says. */
const OPENALEX: Record<string, { title: string; pdf: string | null }> = {
  "10.5555/oa.pdf": { title: FEDERATED_TITLE, pdf: "https://repo.example.org/oa-pdf.pdf" },
  "10.5555/oa.landing": { title: FEDERATED_TITLE, pdf: "https://journal.example.org/landing" },
  "10.5555/oa.blocked": { title: "A Paper From A Big Publisher", pdf: "https://publisher.example.org/blocked.pdf" },
  "10.5555/oa.scanned": { title: "A Scanned Report", pdf: "https://repo.example.org/scanned.pdf" },
  "10.5555/oa.wrong": { title: "Quantum Error Correction Thresholds Revisited", pdf: "https://repo.example.org/other.pdf" },
  "10.5555/oa.long": { title: "A Very Long Report", pdf: "https://repo.example.org/long.pdf" },
  "10.5555/oa.closed": { title: "A Paper Behind A Paywall", pdf: null },
};

const flakyHits = new Map<string, number>();

export const stubFetch: typeof fetch = async (input) => {
  const url = new URL(String(input));
  const host = url.hostname;
  if (host === "www.ebi.ac.uk" && url.pathname.endsWith("/search")) {
    const doi = /DOI:"([^"]+)"/.exec(url.searchParams.get("query") ?? "")?.[1]?.toLowerCase() ?? "";
    const hit = EPMC[doi];
    return json({ resultList: { result: hit ? [{ source: "MED", ...(hit.pmcid ? { pmcid: hit.pmcid } : {}), isOpenAccess: hit.open ? "Y" : "N", ...(hit.open ? { license: "cc by" } : {}), title: hit.title, abstractText: "<h4>Background</h4><p>This stand-in paper reports a trial of a screening method in rural clinics.</p>" }] : [] } });
  }
  if (host === "www.ebi.ac.uk" && url.pathname.endsWith("/fullTextXML")) {
    const id = /\/(PMC\d+)\/fullTextXML/.exec(url.pathname)?.[1] ?? "";
    if (id === "PMC9000003") await sleep(2500);
    if (id === "PMC9000002") {
      const n = (flakyHits.get(id) ?? 0) + 1;
      flakyHits.set(id, n);
      if (n === 1) return new Response("oops", { status: 500 });
    }
    return ["PMC9000001", "PMC9000002", "PMC9000003"].includes(id) ? new Response(jatsXml(), { status: 200, headers: { "content-type": "application/xml" } }) : new Response("not found", { status: 404 });
  }
  if (host === "api.openalex.org") {
    const doi = decodeURIComponent(/\/works\/doi:(.+)$/.exec(url.pathname)?.[1] ?? "").toLowerCase();
    const w = OPENALEX[doi];
    return w ? json({ title: w.title, best_oa_location: w.pdf ? { pdf_url: w.pdf, license: "cc-by" } : null }) : new Response("not found", { status: 404 });
  }
  if (host === "arxiv.org" && url.pathname === "/pdf/2401.00001") return pdfResponse(gnnPdf());
  if (host === "export.arxiv.org") {
    return new Response(`<feed><entry><title>${GNN_TITLE}</title><summary>Graph neural networks represent molecules as graphs of atoms and bonds. This survey reviews how they are used to predict the properties of drug candidates.</summary></entry></feed>`, { status: 200 });
  }
  if (host === "journal.example.org" && url.pathname === "/landing") {
    return new Response('<html><head><meta name="citation_pdf_url" content="https://repo.example.org/oa-pdf.pdf"></head></html>', { status: 200, headers: { "content-type": "text/html" } });
  }
  if (host === "publisher.example.org") return new Response("Forbidden", { status: 403 });
  if (host === "repo.example.org") {
    const make = PDFS[url.pathname.slice(1)];
    if (make) return pdfResponse(make());
  }
  return new Response("not found", { status: 404 });
};
