import { afterEach, describe, expect, it, vi } from "vitest";
import { createMcpHandler } from "@modelcontextprotocol/server";
import type { Paper, SearchResponse } from "@scholar/shared";
import { testD1 } from "../test-d1";
import { oaService } from "../oa/service";
import { searchService } from "../search/service";
import { buildServer, type McpEnv } from "./server";
import { MCP_TOOLS, logCall } from "./calls";
import { AskPaperOut, ClaimOut, LibraryOut, SaveOut, askPaperOut, libraryOut, readAskPaperIn } from "./tools";

/** Phase 2 and 3 of the MCP server (ask_paper, get_library, save_paper, check_claim) over its real protocol, in-process, with the offline stand-ins (QA_STUB) for the network and the models. */

afterEach(() => vi.restoreAllMocks());

const BASE = "https://sodhsetu.in";

function setup(opts: { scopes?: string[]; checkClaim?: boolean; userId?: string; protocol?: "2025-06-18" | "2026-07-28"; elicitation?: boolean; stub?: boolean } = {}) {
  const { db, sql } = testD1();
  sql.prepare("INSERT INTO users (id, email) VALUES ('u-1', 'u1@example.org'), ('u-2', 'u2@example.org')").run();
  // stub: false leaves the stand-ins out, for a test that puts its own search behind searchService.run
  const env = { DB: db, CROSSREF_MAILTO: "t@example.org", ...(opts.stub === false ? {} : { ENABLE_DEV_ROUTES: "1", QA_STUB: "1" }) } as unknown as McpEnv;
  const deferred: Promise<unknown>[] = [];
  const handler = createMcpHandler(() => buildServer({ env, userId: opts.userId ?? "u-1", client: "Test App", base: BASE, defer: (p) => deferred.push(p), checkClaim: opts.checkClaim }), { responseMode: "json" });
  const scopes = opts.scopes ?? ["papers:read", "references:verify", "library:read", "library:write"];
  const protocol = opts.protocol ?? "2025-06-18";
  let id = 0;
  const rpc = async (method: string, params: Record<string, unknown> = {}) => {
    const meta =
      protocol === "2026-07-28"
        ? { _meta: { "io.modelcontextprotocol/protocolVersion": protocol, "io.modelcontextprotocol/clientInfo": { name: "modern", version: "1" }, "io.modelcontextprotocol/clientCapabilities": opts.elicitation ? { elicitation: { form: {} } } : {} } }
        : {};
    const res = await handler.fetch(
      new Request(`${BASE}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": protocol, ...(protocol === "2026-07-28" ? { "Mcp-Method": method, ...(typeof params.name === "string" ? { "Mcp-Name": params.name } : {}) } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params: { ...params, ...meta } }) }),
      { authInfo: { token: "t", clientId: "c", scopes } },
    );
    const text = await res.text();
    const data = text.startsWith("{") ? text : text.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
    return { status: res.status, headers: res.headers, body: data ? (JSON.parse(data) as { result?: Record<string, unknown>; error?: { code: number; message: string } }) : null };
  };
  type Result = { isError?: boolean; content: { type: string; text: string }[]; structuredContent?: Record<string, unknown>; resultType?: string; inputRequests?: Record<string, { method?: string; params?: { message?: string } }> };
  const call = async (name: string, args: unknown, extra: Record<string, unknown> = {}) => (await rpc("tools/call", { name, arguments: args, ...extra })).body?.result as Result;
  return { rpc, call, sql, settle: () => Promise.all(deferred), env };
}

const paper = (doi: string, over: Partial<Paper> = {}): Paper => ({
  id: `doi:${doi}`, doi, pmid: null, title: `The paper ${doi}`, authors: ["A. Author", "B. Author"], year: 2021, venue: "Journal", abstract: "One sentence. Two sentences.", citationCount: 3, oaUrl: null, retracted: false,
  retractionSources: [], sources: ["openalex", "crossref"], score: 1, doiStatus: "verified", ...over,
});
const searchOf = (papers: Paper[]): SearchResponse => ({ query: "q", results: papers, providers: { openalex: { ok: true, count: papers.length, ms: 1, cached: false } }, doiCheck: { ok: true, count: 0, ms: 0, cached: false }, retractionCheck: { ok: true, count: 0, ms: 0, cached: false }, tookMs: 1 });

describe("tools/list after Phase 2", () => {
  it("lists six tools; check_claim only for an account its own switch lets in; save_paper is the one tool that writes", async () => {
    const names = async (checkClaim?: boolean) => ((await setup({ checkClaim }).rpc("tools/list")).body!.result as { tools: { name: string; annotations: Record<string, boolean> }[] }).tools;
    const six = await names();
    expect(six.map((t) => t.name).sort()).toEqual(["ask_paper", "check_retractions", "get_library", "save_paper", "search_papers", "verify_references"]);
    const save = six.find((t) => t.name === "save_paper")!;
    expect(save.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true });
    for (const t of six.filter((x) => x.name !== "save_paper")) expect(t.annotations.readOnlyHint, t.name).toBe(true);
    expect((await names(true)).map((t) => t.name)).toContain("check_claim");
  });
});

describe("ask_paper", () => {
  it("reads the DOI or arXiv number as the website does, and refuses what is neither", () => {
    expect(readAskPaperIn({ doi: "https://doi.org/10.48550/arXiv.1706.03762", question: "what is attention?" })).toMatchObject({ ok: true, ref: { doi: "10.48550/arxiv.1706.03762", arxivId: "1706.03762" }, key: "doi:10.48550/arxiv.1706.03762" });
    expect(readAskPaperIn({ arxiv_id: "arXiv:2401.00001v2", question: "what?" })).toMatchObject({ ok: true, ref: { arxivId: "2401.00001" }, key: "arxiv:2401.00001" });
    expect(readAskPaperIn({ question: "what?" }).ok).toBe(false);
    expect(readAskPaperIn({ doi: "not a doi", question: "what?" }).ok).toBe(false);
  });

  it("answers with the checked quotes, by page or section, and says plainly when only the abstract was read", async () => {
    const spy = vi.spyOn(oaService, "ask").mockImplementation(async (_env, a, s) => {
      expect(a.userId).toBe("u-1");
      expect(a.waitMs).toBe(45_000);
      await s.send({ type: "ingest", status: "ready", progress: 1 });
      await s.send({ type: "paper", key: a.key, title: "A Paper Behind A Paywall", source: "abstract", license: null, permissive: false, reason: "no_source" });
      await s.send({ type: "answer", answer: { id: "x", question: a.question, found: true, answer: "It reports a trial [1].", verified: true, citations: [{ n: 1, page: 1, idx: 1000, quote: "reports a trial", section: "Abstract" }], createdAt: 1 } });
    });
    const { call, sql, settle } = setup();
    const r = await call("ask_paper", { doi: "10.5555/oa.closed", question: "What does it report?" });
    expect(spy).toHaveBeenCalledOnce();
    const s = AskPaperOut.parse(r.structuredContent);
    expect(s).toMatchObject({ status: "answered", paper: { basis: "abstract", title: "A Paper Behind A Paywall", retracted: false }, answer: "It reports a trial [1].", verified: true });
    expect(s.paper.why_not_full_text).toBeTruthy();
    expect(s.quotes).toEqual([{ n: 1, quote: "reports a trial", page: null, section: "Abstract" }]);
    expect(r.content[0]!.text).toMatch(/Answered from the abstract only/);
    await settle();
    expect(sql.prepare("SELECT tool, outcome FROM mcp_calls").all()).toEqual([{ tool: "ask_paper", outcome: "ok" }]);
  });

  it("says still_reading when the paper is being read, and turns the allowance being used up into a tool error counted as quota", async () => {
    vi.spyOn(oaService, "ask").mockImplementationOnce(async (_env, _a, s) => {
      await s.send({ type: "ingest", status: "reading", progress: 0.3 });
      await s.send({ type: "error", code: "still_reading", title: "This paper is still being read", detail: "It keeps going without you. Ask again in a minute." });
    });
    const { call, sql, settle } = setup();
    const r = await call("ask_paper", { doi: "10.5555/oa.slow", question: "What?" });
    expect(r.structuredContent).toMatchObject({ status: "still_reading", answer: null });
    vi.spyOn(oaService, "ask").mockImplementationOnce(async (_env, _a, s) => {
      await s.send({ type: "error", code: "quota", title: "You have used today's AI allowance", detail: "resets 00:00 UTC" });
    });
    const q = await call("ask_paper", { doi: "10.5555/oa.xml", question: "What?" });
    expect(q.isError).toBe(true);
    expect(q.content[0]!.text).toMatch(/AI allowance/);
    await settle();
    expect((sql.prepare("SELECT outcome FROM mcp_calls ORDER BY rowid").all() as { outcome: string }[]).map((x) => x.outcome)).toEqual(["ok", "quota"]);
  });

  it("marks a retracted paper in the answer and its text", () => {
    const out = askPaperOut(BASE, { doi: "10.1/x" }, { paper: { type: "paper", key: "doi:10.1/x", title: "T", source: "europepmc", license: "cc by", permissive: true, retracted: true }, answer: { id: "a", question: "q", found: true, answer: "A [1].", verified: true, citations: [{ n: 1, page: 0, idx: 3, quote: "q", section: "Methods" }], createdAt: 1 }, error: null })!;
    expect(out.paper).toMatchObject({ retracted: true, basis: "full_text" });
    expect(out.quotes[0]).toEqual({ n: 1, quote: "q", page: null, section: "Methods" });
  });

  it("needs papers:read (step-up)", async () => {
    const { rpc } = setup({ scopes: ["references:verify"] });
    const r = await rpc("tools/call", { name: "ask_paper", arguments: { doi: "10.1/x", question: "what?" } });
    expect(r.status).toBe(403);
    expect(r.headers.get("www-authenticate") ?? "").toMatch(/papers:read/);
  });
});

describe("get_library and save_paper", () => {
  it("save_paper saves nothing without the person's yes, looks the paper up itself, and saving twice is saving once", async () => {
    const run = vi.spyOn(searchService, "run").mockResolvedValue(searchOf([paper("10.1234/other"), paper("10.1234/saved", { title: "The Saved Paper", authors: Array.from({ length: 80 }, (_, i) => `Author ${i}`) })]));
    const { call, sql } = setup({ stub: false });
    const no = await call("save_paper", { doi: "10.1234/saved" });
    expect(SaveOut.parse(no.structuredContent)).toMatchObject({ saved: false });
    expect(no.content[0]!.text).toMatch(/Ask the person/);
    expect(run).not.toHaveBeenCalled();
    expect(sql.prepare("SELECT COUNT(*) AS n FROM library_items").get()).toEqual({ n: 0 });

    const yes = await call("save_paper", { doi: "https://doi.org/10.1234/SAVED", confirm: true });
    expect(yes.structuredContent).toMatchObject({ saved: true, already_saved: false, paper: { title: "The Saved Paper", doi: "10.1234/saved" } });
    expect(run).toHaveBeenCalledWith(expect.anything(), { q: "10.1234/saved", limit: 5, scope: "all" });
    const row = sql.prepare("SELECT user_id, paper_id, doi, data FROM library_items").get() as { user_id: string; paper_id: string; doi: string; data: string };
    expect(row).toMatchObject({ user_id: "u-1", paper_id: "doi:10.1234/saved", doi: "10.1234/saved" });
    expect((JSON.parse(row.data) as Paper).authors.length).toBe(50);
    const again = await call("save_paper", { doi: "10.1234/saved", confirm: true });
    expect(again.structuredContent).toMatchObject({ saved: true, already_saved: true });
    expect(sql.prepare("SELECT COUNT(*) AS n FROM library_items").get()).toEqual({ n: 1 });
  });

  it("save_paper saves nothing for a DOI no source knows", async () => {
    vi.spyOn(searchService, "run").mockResolvedValue(searchOf([paper("10.1234/near-but-not-it")]));
    const { call, sql } = setup({ stub: false });
    const r = await call("save_paper", { doi: "10.1234/unknown", confirm: true });
    expect(r.structuredContent).toMatchObject({ saved: false });
    expect(sql.prepare("SELECT COUNT(*) AS n FROM library_items").get()).toEqual({ n: 0 });
  });

  it("an app that can ask the person (protocol 2026-07-28, elicitation) is asked to confirm, and a yes saves", async () => {
    vi.spyOn(searchService, "run").mockResolvedValue(searchOf([paper("10.1234/asked")]));
    const { call, sql, rpc } = setup({ protocol: "2026-07-28", elicitation: true, stub: false });
    const raw = await rpc("tools/call", { name: "save_paper", arguments: { doi: "10.1234/asked" } });
    const first = raw.body?.result as never as { resultType?: string; inputRequests?: Record<string, { method?: string; params?: { message?: string } }> };
    expect(first.resultType).toBe("input_required");
    expect(first.inputRequests?.confirm?.method).toBe("elicitation/create");
    expect(first.inputRequests?.confirm?.params?.message).toMatch(/10\.1234\/asked/);
    expect(sql.prepare("SELECT COUNT(*) AS n FROM library_items").get()).toEqual({ n: 0 });
    const declined = await call("save_paper", { doi: "10.1234/asked" }, { inputResponses: { confirm: { action: "decline" } } });
    expect(declined.structuredContent).toMatchObject({ saved: false, note: "Not saved: the person did not confirm." });
    expect(sql.prepare("SELECT COUNT(*) AS n FROM library_items").get()).toEqual({ n: 0 });
    const yes = await call("save_paper", { doi: "10.1234/asked" }, { inputResponses: { confirm: { action: "accept", content: { confirm: true } } } });
    expect(yes.structuredContent).toMatchObject({ saved: true });
    expect(sql.prepare("SELECT COUNT(*) AS n FROM library_items").get()).toEqual({ n: 1 });
  });

  it("get_library pages the person's own papers, newest first, and shows no one else's", async () => {
    const { call, sql } = setup();
    const ins = sql.prepare("INSERT INTO library_items (user_id, paper_id, data, doi, saved_at) VALUES (?1, ?2, ?3, ?4, ?5)");
    for (let i = 0; i < 25; i++) ins.run("u-1", `doi:10.1/p${i}`, JSON.stringify(paper(`10.1/p${i}`)), `10.1/p${i}`, `2026-11-0${1 + (i % 5)} 10:${String(i).padStart(2, "0")}:00`);
    ins.run("u-2", "doi:10.1/theirs", JSON.stringify(paper("10.1/theirs")), "10.1/theirs", "2026-11-06 10:00:00");
    const first = await call("get_library", { limit: 20 });
    const s = LibraryOut.parse(first.structuredContent);
    expect(s.total).toBe(25);
    expect(s.papers.length).toBe(20);
    expect(s.papers.every((p) => p.doi !== "10.1/theirs")).toBe(true);
    expect(s.papers[0]!.saved_at >= s.papers[1]!.saved_at).toBe(true);
    const next = LibraryOut.parse((await call("get_library", { cursor: s.next_cursor! })).structuredContent);
    expect(next.papers.length).toBe(5);
    expect(next.papers[0]!.n).toBe(21);
    expect(next.next_cursor).toBeNull();
    expect((await call("get_library", { cursor: "nonsense" })).isError).toBe(true);
    expect(libraryOut(BASE, [], 0, 20)).toMatchObject({ total: 0, papers: [], next_cursor: null });
  });

  it("each needs its own library scope (step-up)", async () => {
    const { rpc } = setup({ scopes: ["papers:read", "references:verify"] });
    for (const [name, scope, args] of [["get_library", "library:read", {}], ["save_paper", "library:write", { doi: "10.1/x", confirm: true }]] as const) {
      const r = await rpc("tools/call", { name, arguments: args });
      expect(r.status, name).toBe(403);
      expect(r.headers.get("www-authenticate") ?? "", name).toMatch(new RegExp(scope));
    }
  });
});

describe("save_paper with the offline stand-ins (QA_STUB: the local end-to-end run)", () => {
  it("finds the paper in the chat's stand-in search, as the chat route does", async () => {
    const run = vi.spyOn(searchService, "run");
    const { call } = setup();
    const r = await call("save_paper", { doi: "10.1000/glaucoma.1", confirm: true });
    expect(r.structuredContent).toMatchObject({ saved: true, paper: { doi: "10.1000/glaucoma.1", title: "Deep learning for glaucoma screening from fundus photographs" } });
    expect(run).not.toHaveBeenCalled();
  });
});

describe("check_claim", () => {
  it("supported: the evidence is the abstract's own sentence; not_supported has none; the call is counted", async () => {
    const { call, sql, settle } = setup({ checkClaim: true });
    const yes = await call("check_claim", { claim: "Drip lines cut farm water use by about a third.", dois: ["10.5555/oa.alexabs"] });
    const s = ClaimOut.parse(yes.structuredContent);
    expect(s.verdict).toBe("supported");
    expect(s.evidence).toEqual([{ doi: "10.5555/oa.alexabs", title: "A Survey Of Farm Water Use", sentences: ["Farms with drip lines used about a third less water than farms that flooded their fields."] }]);
    expect(s.papers).toEqual([{ doi: "10.5555/oa.alexabs", title: "A Survey Of Farm Water Use", found: true, read: "abstract", retracted: false, url: "https://doi.org/10.5555/oa.alexabs" }]);
    const no = ClaimOut.parse((await call("check_claim", { claim: "Drip lines are an invented cure for drought everywhere.", dois: ["10.5555/oa.alexabs"] })).structuredContent);
    expect(no).toMatchObject({ verdict: "not_supported", evidence: [] });
    await settle();
    expect(sql.prepare("SELECT tool, outcome FROM mcp_calls").all()).toEqual([
      { tool: "check_claim", outcome: "ok" },
      { tool: "check_claim", outcome: "ok" },
    ]);
  });

  it("a retracted paper is never evidence, a DOI with no abstract is not read, and with nothing to read the verdict is cannot_check", async () => {
    const { call } = setup({ checkClaim: true });
    const r = ClaimOut.parse((await call("check_claim", { claim: "Some finding that these papers might state.", dois: ["10.5555/retracted-claim", "10.5555/nothing-here"] })).structuredContent);
    expect(r.verdict).toBe("cannot_check");
    expect(r.reason).toMatch(/No abstract could be read/);
    expect(r.papers.find((p) => p.doi === "10.5555/retracted-claim")).toMatchObject({ retracted: true, read: "none" });
    expect(r.papers.find((p) => p.doi === "10.5555/nothing-here")).toMatchObject({ found: false, read: "none" });
  });

  it("refuses what is not a DOI, more than five DOIs, and is not there at all without its switch", async () => {
    const { call, rpc } = setup({ checkClaim: true });
    expect((await call("check_claim", { claim: "A claim long enough to check.", dois: ["nope"] })).isError).toBe(true);
    const six = await rpc("tools/call", { name: "check_claim", arguments: { claim: "A claim long enough to check.", dois: Array.from({ length: 6 }, (_, i) => `10.1/${i}`) } });
    expect(!!six.body?.error || (six.body?.result as { isError?: boolean }).isError === true).toBe(true);
    const off = await setup().rpc("tools/call", { name: "check_claim", arguments: { claim: "A claim long enough to check.", dois: ["10.1/x"] } });
    expect(!!off.body?.error || (off.body?.result as { isError?: boolean }).isError === true).toBe(true);
  });
});

describe("the counts of the admin page", () => {
  it("name only the server's own tools: anything else is written as unknown", async () => {
    const { sql, env } = setup();
    await logCall(env.DB, { tool: "save_paper", client: "App", ms: 12, outcome: "ok" });
    await logCall(env.DB, { tool: "drop table users", client: "App", ms: 1, outcome: "error" });
    expect((sql.prepare("SELECT tool FROM mcp_calls ORDER BY rowid").all() as { tool: string }[]).map((r) => r.tool)).toEqual(["save_paper", "unknown"]);
    expect([...MCP_TOOLS].sort()).toEqual(["ask_paper", "check_claim", "check_retractions", "get_library", "save_paper", "search_papers", "verify_references"]);
  });
});
