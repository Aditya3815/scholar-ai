import { beforeEach, describe, expect, it } from "vitest";
import { fakeNet, json, problem, sse, type Net } from "../test/fake-net";
import { askAgentStream, draftNotes } from "./agents-api";

/**
 * The reader's agents ask as they did before the one browser client (docs/design/untangle.md, F9): Explain and Critique POST the paper's question stream with their mode, the Note-taker
 * POSTs ask-highlights; a refusal and a stream's error event say the server's title and detail; a stream that closes without its result is cut off.
 */

let net: Net;
beforeEach(() => {
  net = fakeNet();
});

const answer = { id: "a1", question: "q", text: "t", found: true, verified: true, citations: [] };
const failureOf = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as { status?: number; message: string; name: string });

describe("askAgentStream", () => {
  it("POSTs Explain with the selection and its page, as JSON with the cookies, and resolves with the answer", async () => {
    net.reply = () => sse([{ type: "stage", stage: "retrieving" }, { type: "answer", answer }]);
    const seen: string[] = [];
    const r = await askAgentStream("d1", { mode: "explain", selection: "a passage", page: 3, question: "Explain it" }, (e) => seen.push(e.type), new AbortController().signal);
    expect(r).toEqual({ answer });
    expect(seen).toEqual(["stage", "answer"]);
    expect(net.calls).toEqual([
      {
        url: "/api/v1/documents/d1/ask?stream=1",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: { mode: "explain", question: "Explain it", selection: "a passage", page: 3 },
        credentials: "same-origin",
        keepalive: undefined,
        signal: true,
      },
    ]);
  });

  it("leaves out the selection when there is none, and the page when it is unknown", async () => {
    net.reply = () => sse([{ type: "answer", answer }]);
    await askAgentStream("d1", { mode: "explain", selection: "", page: 2, question: "An idea" }, () => {});
    await askAgentStream("d1", { mode: "explain", selection: "x", page: null, question: "q" }, () => {});
    expect(net.calls.map((c) => c.body)).toEqual([{ mode: "explain", question: "An idea" }, { mode: "explain", question: "q", selection: "x" }]);
  });

  it("resolves Critique with its points", async () => {
    const critique = { points: [] };
    net.reply = () => sse([{ type: "critique", critique }]);
    expect(await askAgentStream("d1", { mode: "critique", question: "Be hard" }, () => {})).toEqual({ critique });
    expect(net.calls[0]!.body).toEqual({ mode: "critique", question: "Be hard" });
  });

  it("says a refusal's title and detail, or the status when it carried no problem", async () => {
    net.reply = () => problem(429, { type: "rate_limited", title: "Too many requests", detail: "Try tomorrow" });
    expect(await failureOf(askAgentStream("d1", { mode: "critique", question: "q" }, () => {}))).toMatchObject({ status: 429, message: "Too many requests. Try tomorrow" });
    net.reply = () => problem(502, "bad gateway");
    expect(await failureOf(askAgentStream("d1", { mode: "critique", question: "q" }, () => {}))).toMatchObject({ status: 502, message: "The service answered 502" });
  });

  it("rejects with the stream's error event after the stream ends, and says a stream with no result was cut off", async () => {
    const seen: string[] = [];
    net.reply = () => sse([{ type: "error", code: "failed", title: "Something went wrong", detail: "Try again" }]);
    expect(await failureOf(askAgentStream("d1", { mode: "critique", question: "q" }, (e) => seen.push(e.type)))).toMatchObject({ status: 200, message: "Something went wrong. Try again" });
    expect(seen).toEqual(["error"]);
    net.reply = () => sse([{ type: "stage", stage: "writing" }]);
    const cut = await failureOf(askAgentStream("d1", { mode: "critique", question: "q" }, () => {}));
    expect(cut).toBeInstanceOf(TypeError);
    expect(cut!.message).toBe("The answer was cut off. Please try again.");
  });
});

describe("draftNotes", () => {
  it("POSTs the legend in notes mode and resolves with the draft", async () => {
    const reply = { draft: { title: "t", blocks: [] }, used: 2, total: 3, dropped: 0 };
    net.reply = () => json(reply);
    const legend = { yellow: "Key point" };
    expect(await draftNotes("d1", legend as never)).toEqual(reply);
    expect(net.calls).toEqual([
      { url: "/api/v1/documents/d1/ask-highlights", method: "POST", headers: { "content-type": "application/json" }, body: { mode: "notes", legend }, credentials: "same-origin", keepalive: undefined, signal: false },
    ]);
  });

  it("says a refusal's title and detail", async () => {
    net.reply = () => problem(403, { type: "forbidden", title: "Not yours", detail: "Ask the owner" });
    expect(await failureOf(draftNotes("d1", {} as never))).toMatchObject({ status: 403, message: "Not yours. Ask the owner" });
  });
});
