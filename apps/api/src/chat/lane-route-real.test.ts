import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatEvent } from "@scholar/shared";

/**
 * R4 on the REAL path of the route (no QA_STUB): the five public indexes and the model gateway are replaced by recorders that throw, so a lane reply that reached for either would fail here and not only
 * in the stand-in's bookkeeping (lane-route.test.ts). "No model call and no search for urgent, crisis and help" (docs/design/intent-and-state.md, 4.5): the person's words go nowhere.
 */
const seen = vi.hoisted(() => ({ search: 0, gateway: 0 }));
vi.mock("../search", async (importOriginal) => {
  const real = await importOriginal<typeof import("../search")>();
  return { ...real, runSearch: async () => (seen.search++, Promise.reject(new Error("a search was made"))) };
});
vi.mock("../llm", async (importOriginal) => {
  const real = await importOriginal<typeof import("../llm")>();
  return { ...real, gatewayFromEnv: () => (seen.gateway++, { complete: () => Promise.reject(new Error("a model was called")), stream: () => Promise.reject(new Error("a model was called")) }) };
});
import { chatRoutes } from "./routes";

const TOKEN = "t".repeat(40);
const sessionRow = { id: "user-1", name: "Test", email: "t@example.org", orcid: null, avatar_url: null, role: "scholar", privacy_ack: null, stale: 0, providers: "google" };
const db = {
  prepare: (sql: string) => ({ bind: () => ({ first: async () => (/FROM sessions/.test(sql) ? sessionRow : /SUM\(tokens_in/.test(sql) ? { t: 0 } : null), run: async () => ({}), all: async () => ({ results: [] }) }) }),
  batch: async () => [],
};
async function post(message: string, signedIn: boolean, env: Record<string, string>) {
  const res = await chatRoutes.request(
    "http://localhost/",
    { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...(signedIn ? { cookie: `sid=${TOKEN}` } : {}) }, body: JSON.stringify({ mode: "auto", message }) },
    { DB: db, CROSSREF_MAILTO: "t@example.org", ...env },
  );
  const text = await res.text();
  return text.split("\n\n").flatMap((b) => {
    const d = b.split("\n").find((l) => l.startsWith("data:"));
    return d ? [JSON.parse(d.slice(5)) as ChatEvent] : [];
  });
}

beforeEach(() => {
  seen.search = 0;
  seen.gateway = 0;
});

describe("the real route, with a search and a model that would throw", () => {
  for (const env of [{ CHAT_SAFETY: "core" }, { CHAT_SAFETY: "on" }]) {
    for (const signedIn of [true, false]) {
      it(`CHAT_SAFETY=${env.CHAT_SAFETY}, ${signedIn ? "signed in" : "a visitor"}: urgent, crisis and help reach neither the indexes nor a model`, async () => {
        for (const m of ["my father has chest pain and his left arm hurts right now", "I want to kill myself", "please help me I cant do this anymore", "मैं मरना चाहता हूँ"]) {
          const events = await post(m, signedIn, env);
          expect(events.map((e) => e.type), m).toEqual(["understood", "general", "done"]);
          expect(seen, m).toEqual({ search: 0, gateway: 0 });
        }
      });
    }
  }
  it("with the flag off, a plain search DOES go to the indexes: the recorders are live (and the rules of today take the crisis message for an idea, which is why it is not the control)", async () => {
    const events = await post("effect of yoga on blood pressure", false, {});
    expect(seen.search).toBe(1);
    expect(events.at(-1)!.type).toBe("error");
  });
});
