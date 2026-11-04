import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatEvent } from "@scholar/shared";
import { OWNER_MESSAGE } from "./clean-cases";

/**
 * R8, what happens when the cleaner itself fails (docs/design/intent-and-state.md, 4.0 and 8.4: "a throwing, hanging or huge-valued shadow function leaves the stream identical"). `readRequest` is made to throw, and
 * `checkReading` to refuse what it is given: in every position of the flag the stream is the same as with the flag off (the message is searched as written, no Reading on the wire, nothing counted), and nothing breaks.
 */
const calls = vi.hoisted(() => ({ mode: "ok" as "ok" | "throw" | "refuse", searches: [] as string[] }));

vi.mock("../understand/frame", async (importOriginal) => {
  const real = await importOriginal<typeof import("../understand/frame")>();
  return { ...real, readRequest: (...a: Parameters<typeof real.readRequest>) => { if (calls.mode === "throw") throw new Error("the cleaner failed"); return real.readRequest(...a); } };
});
vi.mock("../understand/reading-check", async (importOriginal) => {
  const real = await importOriginal<typeof import("../understand/reading-check")>();
  return { ...real, checkReading: (...a: Parameters<typeof real.checkReading>) => (calls.mode === "refuse" ? false : real.checkReading(...a)) };
});
vi.mock("./stub", async (importOriginal) => {
  const real = await importOriginal<typeof import("./stub")>();
  return { ...real, stubSearchFor: (query: string, scope: Parameters<typeof real.stubSearchFor>[1]) => (calls.searches.push(query), real.stubSearchFor(query, scope)) };
});

import { chatRoutes } from "./routes";

const TOKEN = "t".repeat(40);
const sessionRow = { id: "user-1", name: "Test", email: "t@example.org", orcid: null, avatar_url: null, role: "scholar", privacy_ack: null, stale: 0, providers: "google" };
function fakeDb() {
  const rows: unknown[][] = [];
  return {
    rows,
    db: {
      prepare(sql: string) {
        return { bind: (...args: unknown[]) => ({ first: async () => (/FROM sessions/.test(sql) ? sessionRow : /SUM\(tokens_in/.test(sql) ? { t: 0 } : null), run: async () => ({}), all: async () => ({ results: [] }), __args: args }) };
      },
      async batch(statements: { __args: unknown[] }[]) {
        for (const s of statements) rows.push(s.__args);
        return statements.map(() => ({}));
      },
    },
  };
}
async function stream(message: string, env: Record<string, string>) {
  const d = fakeDb();
  const res = await chatRoutes.request("http://localhost/", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", cookie: `sid=${TOKEN}` }, body: JSON.stringify({ mode: "auto", message }) }, { DB: d.db, ENABLE_DEV_ROUTES: "1", QA_STUB: "1", CROSSREF_MAILTO: "t@example.org", ...env });
  const text = (await res.text()).replace(/"tookMs":\d+/g, '"tookMs":0');
  const events = text.split("\n\n").flatMap((b) => {
    const data = b.split("\n").find((l) => l.startsWith("data:"));
    return data ? [JSON.parse(data.slice(5)) as ChatEvent] : [];
  });
  return { status: res.status, text, events, counted: d.rows.filter((r) => r[0] === "chat_input").map((r) => String(r[1])) };
}

beforeEach(() => {
  calls.mode = "ok";
  calls.searches.length = 0;
});
afterEach(() => vi.restoreAllMocks());

describe.each([["throw"], ["refuse"]] as const)("the cleaner %ss", (mode) => {
  it.each([["shadow"], ["on"]])("CHAT_CLEAN=%s: the stream is the one with the flag off, byte for byte, the message is searched as written, and nothing is counted for the cleaner", async (position) => {
    const off = await stream(OWNER_MESSAGE, {});
    calls.searches.length = 0;
    calls.mode = mode;
    const r = await stream(OWNER_MESSAGE, { CHAT_CLEAN: position, CHAT_COUNTERS: "on" });
    expect(r.status).toBe(200);
    expect(r.text).toBe(off.text);
    expect(calls.searches).toEqual([OWNER_MESSAGE]);
    expect(r.counted.filter((n) => n === "would_clean" || n === "clean_applied")).toEqual([]);
    expect(r.events.at(-1)).toMatchObject({ type: "done" });
  });
});

describe("with the cleaner healthy the same two requests do differ (the check above is not vacuous)", () => {
  it("on: the words are the topic; shadow: the words are as written", async () => {
    await stream(OWNER_MESSAGE, { CHAT_CLEAN: "on" });
    expect(calls.searches).toEqual(["convoluton nueral netwrk"]);
    calls.searches.length = 0;
    await stream(OWNER_MESSAGE, { CHAT_CLEAN: "shadow" });
    expect(calls.searches).toEqual([OWNER_MESSAGE]);
  });
});
