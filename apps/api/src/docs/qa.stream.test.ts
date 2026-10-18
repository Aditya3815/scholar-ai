import { describe, expect, it } from "vitest";
import type { AskStreamEvent } from "@scholar/shared";
import { hashEmbedder } from "./embed";
import { answerQuestionStream, type StoredChunk, type StreamComplete } from "./qa";
import { stubStream } from "./stub";

const chunks: StoredChunk[] = [
  { idx: 1000, page: 1, text: "Abstract. We study glaucoma screening with deep learning on retinal photographs.", embedding: null },
  { idx: 2000, page: 2, text: "Participants were recruited from three hospitals in Pune between 2019 and 2021.", embedding: null },
  { idx: 5000, page: 5, text: "The loss function is cross entropy with label smoothing.", embedding: null },
];
const meta = { id: "a", createdAt: 1 };

async function run(question: string, stream: StreamComplete = stubStream) {
  const events: AskStreamEvent[] = [];
  const answer = await answerQuestionStream({ question, chunks, embed: hashEmbedder, stream, meta, emit: (e) => void events.push(e) });
  return { events, answer };
}

describe("answerQuestionStream", () => {
  it("reports retrieval, the pages it will read, thinking, the answer being written, checking, and ends with the verified answer", async () => {
    const { events, answer } = await run("How were participants recruited?");
    const kinds = events.map((e) => (e.type === "stage" ? `stage:${e.stage}` : e.type));
    expect(kinds[0]).toBe("stage:retrieving");
    expect(kinds[1]).toBe("sources");
    expect(kinds.indexOf("stage:thinking")).toBeGreaterThan(1);
    expect(kinds.indexOf("stage:writing")).toBeGreaterThan(kinds.indexOf("stage:thinking"));
    expect(kinds.filter((k) => k === "stage:thinking")).toHaveLength(1);
    expect(kinds.filter((k) => k === "stage:writing")).toHaveLength(1);
    expect(kinds.lastIndexOf("delta")).toBeLessThan(kinds.indexOf("stage:checking"));
    expect(answer).toMatchObject({ found: true, verified: true });
  });

  it("announces the pages before the model has said anything", async () => {
    const { events } = await run("How were participants recruited?");
    const sources = events.find((e) => e.type === "sources");
    expect(sources).toBeDefined();
    expect((sources as { pages: number[] }).pages).toEqual([1, 2, 5]); // sorted, unique
    expect(events.findIndex((e) => e.type === "sources")).toBeLessThan(events.findIndex((e) => e.type === "stage" && e.stage === "thinking"));
  });

  it("the streamed text adds up to the final answer text (minus markers it hides)", async () => {
    const { events, answer } = await run("How were participants recruited?");
    const streamed = events.filter((e): e is Extract<AskStreamEvent, { type: "delta" }> => e.type === "delta").map((e) => e.text).join("");
    expect(streamed.replace(/\s*\[\d+\]/g, "").trim()).toBe(answer.answer.replace(/\s*\[\d+\]/g, "").trim());
  });

  it("the final answer is verified even when the streamed text was not: an invented quote is caught after the fact", async () => {
    const { events, answer } = await run("please hallucinate something");
    expect(events.some((e) => e.type === "delta")).toBe(true);
    expect(answer.verified).toBe(false);
    expect(answer.citations).toEqual([]);
    expect(answer.answer).not.toMatch(/\[\d+\]/);
  });

  it("an unanswerable question streams nothing invented and ends as 'not found'", async () => {
    const { answer } = await run("an unanswerable question");
    expect(answer).toMatchObject({ found: false, citations: [] });
  });

  it("emits events in order even when the consumer is slow", async () => {
    const seen: string[] = [];
    const slowEmit = async (e: AskStreamEvent) => {
      await new Promise((r) => setTimeout(r, e.type === "delta" ? 3 : 0));
      seen.push(e.type === "delta" ? "delta" : e.type === "stage" ? e.stage : e.type);
    };
    await answerQuestionStream({ question: "How were participants recruited?", chunks, embed: hashEmbedder, stream: stubStream, meta, emit: slowEmit });
    expect(seen.at(-1)).toBe("checking");
    expect(seen.indexOf("writing")).toBeLessThan(seen.indexOf("delta"));
    expect(seen.indexOf("sources")).toBeLessThan(seen.indexOf("thinking"));
  });

  it("works with a model that never reports thinking and writes the evidence before the answer", async () => {
    const odd: StreamComplete = async (_req, hooks) => {
      const json = { found: true, evidence: [{ excerpt: 2, quote: "recruited from three hospitals in Pune between 2019" }], answer: "Three hospitals in Pune [1]." };
      hooks.onContent?.(JSON.stringify(json));
      return { json, model: "x" };
    };
    const { events, answer } = await run("How were participants recruited?", odd);
    expect(events.some((e) => e.type === "stage" && e.stage === "thinking")).toBe(false);
    expect(events.filter((e) => e.type === "delta")).toHaveLength(1);
    expect(answer.found).toBe(true);
  });

  it("still streams when the embedding service is down", async () => {
    const answer = await answerQuestionStream({ question: "What is the loss function?", chunks, embed: async () => { throw new Error("down"); }, stream: stubStream, meta, emit: () => {} });
    expect(answer.found).toBe(true);
  });
});
