import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_OA_ABSTRACT_CHARS, type Paper } from "@scholar/shared";
import { fakeNet, problem, sse, type Net } from "../test/fake-net";

/**
 * "Ask this paper" on a search result (lib/oa-ask.ts), as it was before the one browser client (docs/design/untangle.md, F9): the request, the words of a refusal (401, 429 and the rest), the
 * events applied once per frame, and the three endings of a stream that did not finish: cut off, stopped, the connection lost.
 */

vi.mock("react", async () => (await import("../test/fake-react")).react);
const oa = await import("./oa-ask");

const g = globalThis as unknown as Record<string, unknown>;
let net: Net;
let frames: number;
beforeEach(() => {
  net = fakeNet();
  frames = 0;
  g.document = { activeElement: null };
  g.requestAnimationFrame = (cb: () => void) => (frames++, setTimeout(cb, 0) as unknown as number);
  g.cancelAnimationFrame = (t: number) => clearTimeout(t as unknown as ReturnType<typeof setTimeout>);
  oa.clearOaAsk();
});
afterEach(() => vi.restoreAllMocks());

const paper = { id: "p", doi: "10.1000/xyz", title: "A paper", abstract: "a".repeat(MAX_OA_ABSTRACT_CHARS + 50), oaUrl: null } as unknown as Paper;
const turn = () => oa.useOaAsk().turns.get("doi:10.1000/xyz")!.at(-1)!;

describe("asking a paper", () => {
  it("POSTs the paper's reference, the question and the abstract cut at the limit, as an event stream", async () => {
    net.reply = () => sse([{ type: "answer", answer: { text: "A" } }]);
    expect(await oa.askPaper(paper, "  what   is it? ")).toBe("sent");
    expect(net.calls).toEqual([
      { url: "/api/v1/papers/oa/ask", method: "POST", headers: { "content-type": "application/json", accept: "text/event-stream" }, body: { doi: "10.1000/xyz", question: "what is it?", abstract: "a".repeat(MAX_OA_ABSTRACT_CHARS) }, credentials: "same-origin", keepalive: undefined, signal: true },
    ]);
  });

  it("the events are applied together, once per frame, into the turn", async () => {
    net.reply = () => sse([{ type: "stage", stage: "reading" }, { type: "delta", text: "Hel" }, { type: "delta", text: "lo" }, { type: "answer", answer: { text: "Hello" } }]);
    await oa.askPaper(paper, "what is it?");
    expect(turn()).toMatchObject({ status: "done", answer: { text: "Hello" }, live: "", stage: null });
    expect(frames).toBe(1);
  });

  it("a refusal's words: signed out, too many questions, the problem, a reply with no problem", async () => {
    const cases: [Response, unknown][] = [
      [problem(401, { type: "unauthorized", title: "x" }), { code: "sign_in", title: "Sign in to ask this paper" }],
      [problem(429, { type: "rate_limited", title: "x", detail: "y" }), { code: "rate_limited", title: "Too many questions just now", detail: "Please wait a minute and try again." }],
      [problem(400, { type: "invalid_question", title: "That question is too long", detail: "Use fewer words" }), { code: "invalid_question", title: "That question is too long", detail: "Use fewer words" }],
      [problem(500, "x"), { code: "error", title: "That could not be sent" }],
    ];
    for (const [res, error] of cases) {
      net.reply = () => res;
      expect(await oa.askPaper(paper, "what is it?")).toBe("sent");
      expect(turn()).toMatchObject({ status: "error", error });
      expect(Object.keys(turn().error!)).toEqual(Object.keys(error as object));
    }
  });

  it("an error event ends the turn with its words", async () => {
    net.reply = () => sse([{ type: "delta", text: "Hel" }, { type: "error", code: "no_text", title: "There is nothing to read", detail: "Add the PDF" }]);
    await oa.askPaper(paper, "what is it?");
    expect(turn()).toMatchObject({ status: "error", live: "", error: { code: "no_text", title: "There is nothing to read", detail: "Add the PDF" } });
  });

  it("a stream that ended without its end event was cut off", async () => {
    net.reply = () => sse([{ type: "delta", text: "Hel" }]);
    await oa.askPaper(paper, "what is it?");
    expect(turn()).toMatchObject({ status: "error", error: { code: "cut_off", title: "The answer was cut off", detail: "Ask again: a paper that was being read keeps being read." } });
  });

  it("stopped: the turn is stopped; the connection lost, or anything else: their words", async () => {
    net.reply = () => Promise.reject(new DOMException("aborted", "AbortError"));
    await oa.askPaper(paper, "what is it?");
    expect(turn()).toMatchObject({ status: "stopped", live: "", error: null });
    net.reply = () => Promise.reject(new TypeError("Failed to fetch"));
    await oa.askPaper(paper, "what is it?");
    expect(turn()).toMatchObject({ status: "error", error: { code: "network", title: "The connection was lost", detail: "Check your internet and ask again." } });
    net.reply = () => Promise.reject(new Error("odd"));
    await oa.askPaper(paper, "what is it?");
    expect(turn()).toMatchObject({ status: "error", error: { code: "network", title: "Something went wrong", detail: "Check your internet and ask again." } });
  });
});
