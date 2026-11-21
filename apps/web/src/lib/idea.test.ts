import { beforeEach, describe, expect, it } from "vitest";
import { compareIdea, insightsIdea, planIdea, searchIdea } from "./idea";
import { fakeNet, json, problem, sse, type Net } from "../test/fake-net";

/** Idea Check's requests and streams, as they were before the one browser client (docs/design/untangle.md, F9): the client must make the same requests and say the same things. */

let net: Net;
beforeEach(() => {
  net = fakeNet();
});

const POST = (url: string, body: unknown) => ({ url, method: "POST", headers: { "content-type": "application/json" }, body, credentials: "same-origin", keepalive: undefined, signal: true });

describe("Idea Check's requests", () => {
  it("plan: POST /api/v1/idea/plan with the idea and the question; resolves with the plan", async () => {
    net.reply = () => json({ plan: { p: 1 } });
    expect(await planIdea("an idea", "a question", new AbortController().signal)).toEqual({ p: 1 });
    expect(net.calls).toEqual([POST("/api/v1/idea/plan", { text: "an idea", question: "a question" })]);
  });

  it("a refused request is an ApiError with the problem's status, type, title and detail", async () => {
    net.reply = () => problem(429, { type: "quota", title: "Today's allowance is used", detail: "It comes back tomorrow" });
    const e = await planIdea("x", "y").catch((x) => x);
    expect(e).toMatchObject({ status: 429, type: "quota", message: "Today's allowance is used. It comes back tomorrow" });
    expect(e.constructor.name).toBe("ApiError");
  });

  it("a reply with no problem in it says the status", async () => {
    net.reply = () => problem(502, "<html>bad gateway</html>");
    expect(await planIdea("x", "y").catch((x) => x)).toMatchObject({ status: 502, type: "error", message: "The service answered 502" });
  });

  it("search: every event goes to onEvent; resolves with the done event's result", async () => {
    net.reply = () => sse([{ type: "stage", stage: "searching" }, { type: "papers", papers: [] }, { type: "done", result: { r: 1 } }]);
    const seen: unknown[] = [];
    const req = { plan: {} } as never;
    expect(await searchIdea(req, (e) => seen.push(e))).toEqual({ r: 1 });
    expect(seen.map((e) => (e as { type: string }).type)).toEqual(["stage", "papers", "done"]);
    expect(net.calls).toEqual([{ ...POST("/api/v1/idea/search", { plan: {} }), signal: false }]);
  });

  it("search: an error event rejects with it as an ApiError (after onEvent saw it); a stream with neither is cut off", async () => {
    net.reply = () => sse([{ type: "stage", stage: "searching" }, { type: "error", code: "ai_failed", title: "The search failed", detail: "Try again" }]);
    const seen: unknown[] = [];
    const e = await searchIdea({} as never, (x) => seen.push(x)).catch((x) => x);
    expect(e).toMatchObject({ status: 200, message: "The search failed. Try again" });
    expect(e.constructor.name).toBe("ApiError");
    expect(seen).toHaveLength(2);
    net.reply = () => sse([{ type: "stage", stage: "searching" }]);
    const cut = await searchIdea({} as never, () => {}).catch((x) => x);
    expect(cut).toBeInstanceOf(TypeError);
    expect(cut.message).toBe("The search was cut off. Please try again.");
  });

  it("compare: stages go to onStage; resolves with the comparison; an error or a cut stream rejects", async () => {
    net.reply = () => sse([{ type: "stage", stage: "reading" }, { type: "stage", stage: "comparing" }, { type: "done", comparison: { c: 1 } }]);
    const stages: string[] = [];
    expect(await compareIdea({ x: 1 } as never, (s) => stages.push(s))).toEqual({ c: 1 });
    expect(stages).toEqual(["reading", "comparing"]);
    expect(net.calls[0]).toEqual({ ...POST("/api/v1/idea/compare", { x: 1 }), signal: false });
    net.reply = () => sse([{ type: "error", code: "internal_error", title: "Something went wrong" }]);
    expect(await compareIdea({} as never, () => {}).catch((x) => x)).toMatchObject({ message: "Something went wrong" });
    net.reply = () => sse([]);
    expect((await compareIdea({} as never, () => {}).catch((x) => x)).message).toBe("The comparison was cut off. Please try again.");
    net.reply = () => problem(400, { type: "invalid_compare", title: "That comparison cannot be made" });
    expect(await compareIdea({} as never, () => {}).catch((x) => x)).toMatchObject({ status: 400, type: "invalid_compare", message: "That comparison cannot be made" });
  });

  it("insights: the same, with its own cut-off words", async () => {
    net.reply = () => sse([{ type: "stage", stage: "analysing" }, { type: "done", insights: { i: 1 } }]);
    const stages: string[] = [];
    expect(await insightsIdea({} as never, (s) => stages.push(s))).toEqual({ i: 1 });
    expect(stages).toEqual(["analysing"]);
    expect(net.calls[0]!.url).toBe("/api/v1/idea/insights");
    net.reply = () => sse([{ type: "stage", stage: "reading" }]);
    expect((await insightsIdea({} as never, () => {}).catch((x) => x)).message).toBe("Reading the papers was cut off. Please try again.");
  });
});
