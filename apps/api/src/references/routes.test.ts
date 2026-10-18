import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { memoryStore } from "../cache/store";
import { MAX_REFERENCE_CHARS, referenceRoutes, verifyCached } from "./routes";

const env = { CROSSREF_MAILTO: "test@example.org" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const REF = "Desai, A., & Verma, R. (2021). Graph neural networks for protein function prediction. Bioinformatics, 37(5), 1-12.";
const record = {
  DOI: "10.1000/real.1",
  title: ["Graph neural networks for protein function prediction"],
  author: [{ given: "Anita", family: "Desai" }, { given: "Rahul", family: "Verma" }],
  issued: { "date-parts": [[2021]] },
  "container-title": ["Bioinformatics"],
};

function stubCrossref(opts: { fail?: boolean } = {}) {
  let calls = 0;
  vi.stubGlobal("fetch", async () => {
    calls++;
    if (opts.fail) return json({}, 500);
    return json({ message: { items: [record] } });
  });
  return () => calls;
}
afterEach(() => vi.unstubAllGlobals());

describe("verifyCached", () => {
  it("serves a repeat from the cache without calling Crossref", async () => {
    const store = memoryStore();
    const calls = stubCrossref();
    const first = await verifyCached(store, REF, env);
    expect(first.cached).toBe(false);
    expect(first.result.status).toBe("verified");
    const n = calls();
    const second = await verifyCached(store, `  ${REF.toUpperCase()}  `, env);
    expect(second.cached).toBe(true);
    expect(calls()).toBe(n);
    expect(second.result.status).toBe("verified");
    expect(second.result.input).toBe(REF.toUpperCase()); // the caller's own text comes back, not a stored copy
  });

  it("never stores the reference text itself", async () => {
    stubCrossref();
    let stored = "";
    const spy = { get: async () => null, set: async (_k: string, v: string) => { stored = v; } };
    await verifyCached(spy, REF, env);
    expect(stored).not.toBe("");
    expect(stored).not.toContain("Desai, A., & Verma");
  });

  it("does not cache an answer that came from a database outage", async () => {
    const store = memoryStore();
    stubCrossref({ fail: true });
    const r = await verifyCached(store, REF, env);
    expect(r.result.status).toBe("unverifiable");
    stubCrossref();
    const again = await verifyCached(store, REF, env);
    expect(again.cached).toBe(false);
    expect(again.result.status).toBe("verified");
  });
});

describe("POST /verify", () => {
  const app = new Hono();
  app.route("/api/v1/references", referenceRoutes);
  const post = (body: unknown, headers: Record<string, string> = { origin: "http://localhost" }) =>
    app.request(
      "http://localhost/api/v1/references/verify",
      { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) },
      { DB: {}, ...env },
    );

  it("rejects cross-origin requests", async () => {
    expect((await post({ reference: REF }, { origin: "https://evil.example" })).status).toBe(403);
  });
  it("rejects a missing or non-string reference", async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ reference: 42 })).status).toBe(400);
  });
  it("rejects an oversized reference with a hint to split the list", async () => {
    const res = await post({ reference: "x".repeat(MAX_REFERENCE_CHARS + 1) });
    expect(res.status).toBe(413);
    expect(((await res.json()) as { detail: string }).detail).toMatch(/Split/);
  });
});
