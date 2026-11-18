import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ABSTRACT_READ_CHARS, MAX_TIGHTEN_PAPERS, MAX_TIGHTEN_TEXT, PRIVACY_VERSION, type TightenRequest } from "@scholar/shared";
import { chatRoutes } from "./routes";
import { MAX_TIGHTEN_BODY_BYTES } from "./tighten";
import { testD1 } from "../test-d1";
import { sha256Hex } from "../hash";

/**
 * Bug B7: the strict check's body has a size limit, and it must not refuse a request the page can really send. The largest one (tightenRequestFor at every cap, in Devanagari, three
 * bytes a character) passes the limit; one byte over the limit is refused with the chat's words.
 */

const TOKEN = "k".repeat(40);
const DEVANAGARI = "अनुसंधान में पाया गया कि ";
const fill = (n: number) => DEVANAGARI.repeat(Math.ceil(n / DEVANAGARI.length)).slice(0, n);

/** What tightenRequestFor sends at most: the longest answer (a marker every 3 characters is the most citations it can hold), the most papers, each abstract at its cap and a long title. */
function largest(): TightenRequest {
  const papers = Array.from({ length: MAX_TIGHTEN_PAPERS }, (_, i) => ({ n: i + 1, title: fill(1_000), year: 2024, abstract: fill(ABSTRACT_READ_CHARS) }));
  const citations = Array.from({ length: Math.ceil(MAX_TIGHTEN_TEXT / 3) }, (_, i) => ({ n: (i % MAX_TIGHTEN_PAPERS) + 1, sentenceNo: 99 }));
  return { text: fill(MAX_TIGHTEN_TEXT), papers, citations };
}

async function post(body: string) {
  const { db, sql } = testD1();
  sql.prepare("INSERT INTO users (id, email, privacy_ack) VALUES ('u1', 'u1@example.org', ?)").run(PRIVACY_VERSION);
  sql.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, 'u1', datetime('now', '+1 day'))").run(await sha256Hex(TOKEN));
  const res = await chatRoutes.request(
    "http://localhost/tighten",
    { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", cookie: `sid=${TOKEN}` }, body },
    { DB: db, ENABLE_DEV_ROUTES: "1", QA_STUB: "1" },
  );
  return { status: res.status, json: (await res.json().catch(() => null)) as { type?: string; title?: string; detail?: string } | null };
}

beforeAll(() => {
  vi.stubGlobal("fetch", async () => new Response("", { status: 503 }));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterAll(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the strict check's body limit (bug B7)", () => {
  it("is the arithmetic of its comment", () => {
    expect(MAX_TIGHTEN_BODY_BYTES).toBe(223_392);
  });

  it("lets the largest request the page can send through", async () => {
    const body = JSON.stringify(largest());
    const bytes = new TextEncoder().encode(body).byteLength;
    expect(bytes).toBeGreaterThan(80 * 1024); // more than the chat's own limit: why it has one of its own
    expect(bytes).toBeLessThanOrEqual(MAX_TIGHTEN_BODY_BYTES);
    expect((await post(body)).status).not.toBe(413);
    // padded to the limit itself, still read
    expect((await post(body + " ".repeat(MAX_TIGHTEN_BODY_BYTES - bytes))).status).not.toBe(413);
  }, 60_000);

  it("refuses one byte over the limit with the chat's words", async () => {
    const body = JSON.stringify(largest());
    const over = body + " ".repeat(MAX_TIGHTEN_BODY_BYTES + 1 - new TextEncoder().encode(body).byteLength);
    const r = await post(over);
    expect(r.status).toBe(413);
    expect(r.json).toEqual({ type: "too_large", title: "That is too much text", detail: "Send a shorter message." });
  });
});
