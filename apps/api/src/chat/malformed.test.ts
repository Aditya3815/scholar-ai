import { describe, expect, it } from "vitest";
import type { ChatEvent } from "@scholar/shared";
import { AllProvidersFailedError } from "../llm";
import { pickEvidencePapers } from "./answer";
import { answerFromResults } from "./answer";
import { answerGeneral } from "./general";
import { isMalformedReply } from "./malformed";
import { stubChatStream, stubPapers } from "./stub";

const failed = (...errors: string[]) => new AllProvidersFailedError(errors.map((error) => ({ provider: "workersai", model: "m", ok: false, ms: 1, error })));

describe("isMalformedReply", () => {
  it("is true when every attempt failed because the reply was not JSON", () => {
    for (const e of ["no JSON in output", "unterminated JSON", "Unterminated string in JSON at position 486", 'Unexpected token \'a\', "[assistant]"... is not valid JSON', "Unexpected end of JSON input"]) expect(isMalformedReply(failed(e))).toBe(true);
    expect(isMalformedReply(failed("no JSON in output", "unterminated JSON"))).toBe(true);
  });
  it("is false for a timeout, a refusal, a quota, a mixed failure, or anything that is not a provider failure", () => {
    for (const e of [failed("timed out"), failed("HTTP 429"), failed("no JSON in output", "timed out"), new AllProvidersFailedError([]), new Error("no JSON in output"), null, "no JSON"]) expect(isMalformedReply(e)).toBe(false);
  });
});

describe("a malformed reply is asked for again once, and only if no word of it reached the screen", () => {
  const picked = pickEvidencePapers(stubPapers());

  it("the answer from papers: the second try is the one that is shown", async () => {
    let calls = 0;
    const events: ChatEvent[] = [];
    const stream = (async (req: unknown, hooks: unknown) => {
      if (++calls === 1) throw failed('Unexpected token \'a\', "[assistant]"... is not valid JSON');
      return stubChatStream(req as never, hooks as never);
    }) as never;
    const a = await answerFromResults({ question: "what did they find?", picked, stream, emit: (e) => void events.push(e) });
    expect(calls).toBe(2);
    expect(a.grounded).toBe(true);
    expect(events.filter((e) => e.type === "token").map((e) => (e as { text: string }).text).join("")).toBe("The first paper reports its main result [1].");
  });

  it("the answer from papers: not asked again when the words had begun to arrive (they would be shown twice), nor for a timeout", async () => {
    let calls = 0;
    const halfWritten = (async (_req: unknown, hooks: { onContent?: (p: string) => void }) => {
      calls++;
      hooks.onContent?.('{"coverage":"full","answer":"The first paper ');
      throw failed("unterminated JSON");
    }) as never;
    await expect(answerFromResults({ question: "q", picked, stream: halfWritten, emit: () => {} })).rejects.toThrow();
    expect(calls).toBe(1);
    calls = 0;
    await expect(answerFromResults({ question: "q", picked, stream: (async () => { calls++; throw failed("timed out"); }) as never, emit: () => {} })).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it("two malformed replies in a row are a failure (it is asked once more, not forever)", async () => {
    let calls = 0;
    await expect(answerFromResults({ question: "q", picked, stream: (async () => { calls++; throw failed("no JSON in output"); }) as never, emit: () => {} })).rejects.toBeInstanceOf(AllProvidersFailedError);
    expect(calls).toBe(2);
  });

  it("the general background follows the same rule", async () => {
    let calls = 0;
    const ok = { kind: "background", answer: "In general terms this is a well studied question, and the answer depends on the setting." };
    const flaky = (async (_req: unknown, hooks: { onContent?: (p: string) => void }) => {
      if (++calls === 1) throw failed("no JSON in output");
      hooks.onContent?.(JSON.stringify(ok));
      return { json: ok, model: "m" };
    }) as never;
    const r = await answerGeneral({ question: "q", stream: flaky, emit: () => {} });
    expect(calls).toBe(2);
    expect(r.kind).toBe("background");
    calls = 0;
    const partial = (async (_req: unknown, hooks: { onContent?: (p: string) => void }) => {
      calls++;
      hooks.onContent?.('{"kind":"background","answer":"In general ');
      throw failed("unterminated JSON");
    }) as never;
    await expect(answerGeneral({ question: "q", stream: partial, emit: () => {} })).rejects.toThrow();
    expect(calls).toBe(1);
  });
});
