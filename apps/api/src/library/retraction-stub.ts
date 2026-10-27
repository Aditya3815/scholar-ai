/**
 * Crossref's retraction data, offline (tests and the local end-to-end run only: QA_STUB=1 together with ENABLE_DEV_ROUTES=1, see src/index.ts). The DOI says what happens:
 *   a DOI containing "retracted"   a retraction notice names it
 *   a DOI containing "reject"      the service answers 400 to any request that names it (a DOI it cannot take)
 *   a DOI containing "outage"      the service answers 503 (it is down: the run must stop, not mark anything)
 * and every other DOI is clear. `calls` lets a test see how many requests the job made.
 */
export const stubCrossrefCalls: string[][] = [];

export const stubCrossrefFetch: typeof fetch = async (input) => {
  const url = new URL(String(input));
  const dois = [...(url.searchParams.get("filter") ?? "").matchAll(/updates:([^,]+)/g)].map((m) => m[1]!.toLowerCase());
  stubCrossrefCalls.push(dois);
  if (dois.some((d) => d.includes("outage"))) return new Response("down", { status: 503 });
  if (dois.some((d) => d.includes("reject"))) return new Response("bad filter", { status: 400 });
  const items = dois.filter((d) => d.includes("retracted")).map((d) => ({ DOI: `${d}-notice`, "update-to": [{ DOI: d, type: "retraction" }] }));
  return new Response(JSON.stringify({ message: { items } }), { status: 200, headers: { "content-type": "application/json" } });
};
