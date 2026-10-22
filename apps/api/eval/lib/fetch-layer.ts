// Record / replay / live HTTP for the eval harness.
//   replay: every request is answered from eval/fixtures.json.gz (deterministic, offline, free). A request with no fixture is
//           recorded in `missing` and fails loudly: it means the code now asks for something we never recorded.
//   record: real network, throttled per host, bodies trimmed to the fields our code reads, saved to the fixtures file.
//   live:   real network, nothing saved (weekly drift check).
// API keys and mailto are stripped from request keys, so no secret or email is ever written to the fixtures.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
// @ts-expect-error plain .mjs shared with the scrub script
import { trimBody } from "./trim.mjs";

export type Mode = "replay" | "record" | "live";
type Fixture = { s: number; b: string };

const realFetch = globalThis.fetch.bind(globalThis);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function requestKey(input: unknown, init?: RequestInit): string {
  const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url);
  for (const k of ["api_key", "mailto"]) u.searchParams.delete(k);
  u.searchParams.sort();
  return `${(init?.method ?? "GET").toUpperCase()} ${u.origin}${u.pathname}?${u.searchParams.toString()}`;
}

const HOST_INTERVAL_MS: Record<string, number> = {
  "api.semanticscholar.org": 1150,
  "api.crossref.org": 110,
  "doi.org": 70,
  "eutils.ncbi.nlm.nih.gov": 110,
  "api.openalex.org": 0,
  "export.arxiv.org": 3100, // arXiv asks for one request every three seconds
};

export class FetchLayer {
  readonly missing: string[] = [];
  private fixtures = new Map<string, Fixture>();
  private lastCall = new Map<string, number>();
  calls = 0;

  constructor(readonly mode: Mode, private file: string) {
    if (mode === "replay") {
      if (!existsSync(file)) throw new Error(`No fixtures at ${file}. Run: npm run eval:record -w apps/api`);
      const raw = JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")) as Record<string, Fixture>;
      this.fixtures = new Map(Object.entries(raw));
    }
  }

  install() {
    globalThis.fetch = ((input: unknown, init?: RequestInit) => this.handle(input, init)) as typeof fetch;
  }
  uninstall() {
    globalThis.fetch = realFetch;
  }

  private async handle(input: unknown, init?: RequestInit): Promise<Response> {
    this.calls++;
    const key = requestKey(input, init);
    if (this.mode === "replay") {
      const fx = this.fixtures.get(key);
      if (!fx) {
        this.missing.push(key);
        throw new Error(`eval fixture missing: ${key}`);
      }
      return new Response(fx.b, { status: fx.s, headers: { "Content-Type": "application/json" } });
    }

    // Recording the same request twice (the same search made by several configurations of one eval) must not be paid for twice.
    const done = this.mode === "record" ? this.fixtures.get(key) : undefined;
    if (done && done.s < 400) return new Response(done.b, { status: done.s, headers: { "Content-Type": "application/json" } });

    const url = new URL(key.slice(key.indexOf(" ") + 1));
    const gap = HOST_INTERVAL_MS[url.host] ?? 100;
    let res: Response | undefined;
    for (let attempt = 0; attempt < 6; attempt++) {
      const wait = (this.lastCall.get(url.host) ?? 0) + gap - Date.now();
      if (wait > 0) await sleep(wait);
      this.lastCall.set(url.host, Date.now());
      // Drop the caller's AbortSignal: the product's 6 s provider timeouts would abort throttled/retried requests mid-flight and
      // leave holes in the recording. Latency is not what this eval measures; data accuracy is.
      const { signal: _ignored, ...rest } = init ?? {};
      res = await realFetch(input as RequestInfo, rest).catch(() => undefined as unknown as Response);
      if (res && res.status !== 429 && res.status < 500) break;
      await sleep(1500 * (attempt + 1));
    }
    if (!res) {
      // Record the failure too (status 599): replay then fails the same request the same way instead of reporting a missing recording.
      if (this.mode === "record") this.fixtures.set(key, { s: 599, b: "" });
      throw new Error(`network failure: ${key}`);
    }

    const text = await res.text();
    if (this.mode === "record") {
      // The code under test must see EXACTLY what replay will later give it, so it gets the trimmed body too. (Otherwise a field
      // we trimmed away could change a ranking during recording and replay would diverge from the recorded run.)
      const trimmed = trimBody(url.toString(), text);
      this.fixtures.set(key, { s: res.status, b: trimmed });
      return new Response(trimmed, { status: res.status, headers: { "Content-Type": "application/json" } });
    }
    return new Response(text, { status: res.status, headers: { "Content-Type": res.headers.get("content-type") ?? "application/json" } });
  }

  save() {
    if (this.mode !== "record") return;
    const obj = Object.fromEntries([...this.fixtures.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
    writeFileSync(this.file, gzipSync(JSON.stringify(obj), { level: 9 }));
  }

  get size() {
    return this.fixtures.size;
  }
}
