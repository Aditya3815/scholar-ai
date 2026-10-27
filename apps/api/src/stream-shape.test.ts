import { describe, expect, it } from "vitest";
import { STREAMS, streamShapeProblems } from "@scholar/shared";

const ev = (type: string, rest: Record<string, unknown> = {}) => ({ type, ...rest });

describe("the event rule: progress and text are different events", () => {
  it("accepts a chat stream that searches, writes and answers", () => {
    const events = [
      ev("understood", { mode: "search", query: "q", language: "en", auto: false, how: "chosen", confidence: 1 }),
      ev("step", { step: "search" }),
      ev("papers", { results: [], final: false }),
      ev("notice", { kind: "partial", text: "one source did not answer" }),
      ev("step", { step: "write" }),
      ev("token", { text: "The " }),
      ev("token", { text: "answer" }),
      ev("papers", { results: [], final: true }),
      ev("answer", { answer: {} }),
      ev("done", { answered: true, tookMs: 10 }),
    ];
    expect(streamShapeProblems("chat", events)).toEqual([]);
  });

  it("accepts the other shapes a chat stream takes: small talk, background, an error", () => {
    expect(streamShapeProblems("chat", [ev("understood"), ev("general", { kind: "not_research", text: "Hello" }), ev("done", { answered: false })])).toEqual([]);
    expect(streamShapeProblems("chat", [ev("step", { step: "general" }), ev("general_token", { text: "In general" }), ev("general", { kind: "background", text: "In general..." }), ev("done", { answered: false })])).toEqual([]);
    expect(streamShapeProblems("chat", [ev("understood"), ev("error", { code: "x", title: "t" })])).toEqual([]);
  });

  it("accepts a question about a paper: the reading, the paper, the stages, the words, the checked answer", () => {
    const events = [
      ev("ingest", { status: "fetching", progress: 0.1, started: true }),
      ev("ingest", { status: "embedding", progress: 0.6, source: "europepmc" }),
      ev("ingest", { status: "ready", progress: 1, source: "europepmc" }),
      ev("paper", { key: "doi:x", title: "t", source: "europepmc", license: null, permissive: true }),
      ev("stage", { stage: "retrieving" }),
      ev("sources", { pages: [1, 2] }),
      ev("stage", { stage: "writing" }),
      ev("delta", { text: "Some" }),
      ev("stage", { stage: "checking" }),
      ev("answer", { answer: {} }),
    ];
    expect(streamShapeProblems("ask", events)).toEqual([]);
  });

  it("accepts an Idea Check stream", () => {
    expect(streamShapeProblems("idea", [ev("stage", { stage: "searching" }), ev("papers", { papers: [], searched: [] }), ev("done", { result: {} })])).toEqual([]);
  });

  it("refuses words in a progress event (the rule the research note sets)", () => {
    expect(streamShapeProblems("chat", [ev("step", { step: "write", text: "The answer so far" }), ev("done")])).toEqual([expect.stringMatching(/progress event may carry only type, step, not text/)]);
    expect(streamShapeProblems("ask", [ev("ingest", { status: "reading", progress: 0.2, message: "Reading the methods section" }), ev("answer")])).toEqual([expect.stringMatching(/not message/)]);
  });

  it("refuses a text event that carries anything but its words, or no words", () => {
    expect(streamShapeProblems("chat", [ev("token", { text: "a", progress: 0.5 }), ev("done")])).toEqual([expect.stringMatching(/carries only its words, not progress/)]);
    expect(streamShapeProblems("chat", [ev("token", { text: "" }), ev("done")])).toEqual([expect.stringMatching(/must carry some words/)]);
    expect(streamShapeProblems("chat", [ev("token"), ev("done")])).toEqual([expect.stringMatching(/must carry some words/)]);
  });

  it("refuses more words after the final event that replaces them", () => {
    expect(streamShapeProblems("chat", [ev("token", { text: "a" }), ev("answer"), ev("token", { text: "b" }), ev("done")])).toEqual([expect.stringMatching(/more words after the final `answer`/)]);
    expect(streamShapeProblems("chat", [ev("general", { kind: "background", text: "x" }), ev("general_token", { text: "y" }), ev("done")])).toEqual([expect.stringMatching(/after the final `general`/)]);
    expect(streamShapeProblems("ask", [ev("delta", { text: "a" }), ev("answer")])).toEqual([]);
  });

  it("wants exactly one end event, and it last", () => {
    expect(streamShapeProblems("chat", [ev("step", { step: "search" })])).toEqual([expect.stringMatching(/no end event \(done or error\)/)]);
    expect(streamShapeProblems("chat", [ev("done"), ev("done")])).toEqual(expect.arrayContaining([expect.stringMatching(/2 end events/)]));
    expect(streamShapeProblems("chat", [ev("done"), ev("step", { step: "search" })])).toEqual(expect.arrayContaining([expect.stringMatching(/not the last event/), expect.stringMatching(/comes after the end/)]));
    expect(streamShapeProblems("chat", [])).toEqual(["the stream is empty"]);
  });

  it("refuses a type the stream does not have, including the names every object has", () => {
    expect(streamShapeProblems("chat", [ev("delta", { text: "x" }), ev("done")])).toEqual([expect.stringMatching(/delta\): not a known event of the chat stream/)]);
    expect(streamShapeProblems("chat", [ev("constructor"), ev("done")])).toEqual([expect.stringMatching(/not a known event/)]);
    expect(streamShapeProblems("chat", [{ nothing: 1 }, ev("done")])).toEqual([expect.stringMatching(/no type/)]);
  });

  it("wants the reading progress to be a number from 0 to 1 that never goes back", () => {
    const at = (p: unknown) => ev("ingest", { status: "embedding", progress: p });
    expect(streamShapeProblems("ask", [at(0.5), at(0.4), ev("answer")])).toEqual([expect.stringMatching(/progress went back \(0.4 after 0.5\)/)]);
    expect(streamShapeProblems("ask", [at(1.2), ev("answer")])).toEqual([expect.stringMatching(/from 0 to 1/)]);
    expect(streamShapeProblems("ask", [at(Number.NaN), ev("answer")])).toEqual([expect.stringMatching(/from 0 to 1/)]);
    expect(streamShapeProblems("ask", [at("half"), ev("answer")])).toEqual([expect.stringMatching(/from 0 to 1/)]);
    expect(streamShapeProblems("ask", [at(0.5), at(0.5), at(1), ev("answer")])).toEqual([]);
  });

  it("classifies every event type of every stream, and every stream names the events that end it", () => {
    for (const [name, spec] of Object.entries(STREAMS)) {
      expect(spec.end.every((t) => spec.kinds[t] === "end"), `${name}: ends`).toBe(true);
      expect(Object.entries(spec.kinds).filter(([, k]) => k === "end").map(([t]) => t).sort(), `${name}: only the ending events are of kind end`).toEqual([...spec.end].sort());
      for (const [textType, finalType] of Object.entries(spec.replaced)) {
        expect(spec.kinds[textType], `${name}: ${textType}`).toBe("text");
        expect(spec.kinds[finalType], `${name}: ${finalType}`).not.toBe("progress");
      }
      for (const type of Object.keys(spec.progressFields)) expect(spec.kinds[type], `${name}: ${type}`).toBe("progress");
    }
  });
});
