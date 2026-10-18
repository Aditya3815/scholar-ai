import { describe, expect, it } from "vitest";
import { hashEmbedder } from "./embed";
import { answerQuestion, quoteInText, retrieve, verifyAnswer, type Complete, type Retrieved, type StoredChunk } from "./qa";
import { stubComplete } from "./stub";

const ex = (texts: string[]): Retrieved[] => texts.map((text, i) => ({ idx: (i + 1) * 1000, page: i + 1, text, embedding: null, score: 1 }));
const meta = { id: "a1", createdAt: 1 };

describe("quoteInText", () => {
  const text = "We recruited 214 participants from three hospitals in Pune between 2019 and 2021, and followed them for 12 months.";
  it("accepts an exact quote and tolerates punctuation, case and spacing differences", () => {
    expect(quoteInText("recruited 214 participants from three hospitals in Pune", text)).toBe(true);
    expect(quoteInText("We  RECRUITED 214 participants, from three hospitals (in Pune)", text)).toBe(true);
  });
  it("rejects invented wording, even when it reuses real words", () => {
    expect(quoteInText("recruited 900 participants from five hospitals in Delhi", text)).toBe(false);
    expect(quoteInText("participants Pune hospitals followed months", text)).toBe(false); // right words, wrong order
  });
  it("rejects quotes that are too short to prove anything", () => {
    expect(quoteInText("214 participants", text)).toBe(false);
  });
  it("accepts a quote the model repaired when the PDF text had broken words, but not an invented one", () => {
    const broken = "We propose a mathematical model for cholera cons idering vaccination and show that it is well posed in the bigge st outbreak.";
    expect(quoteInText("We propose a mathematical model for cholera considering vaccination", broken)).toBe(true);
    expect(quoteInText("show that it is well posed in the biggest outbreak", broken)).toBe(true);
    expect(quoteInText("We propose a statistical model for malaria considering vaccination", broken)).toBe(false);
  });

  it("allows a truncated quote but not a rewrite", () => {
    expect(quoteInText("We recruited 214 participants from five clinics in Delhi between 2019 and 2021 and followed them for twelve months", text)).toBe(false);
    expect(quoteInText("We recruited 214 participants from three hospitals in Pune between 2019 and 2021, and followed them", text)).toBe(true);
  });
});

describe("verifyAnswer", () => {
  const excerpts = ex(["We recruited 214 participants from three hospitals in Pune.", "The primary outcome was change in HbA1c after twelve weeks of treatment."]);

  it("keeps verified citations and their markers", () => {
    const a = verifyAnswer(
      { found: true, answer: "214 people took part [1]. The outcome was HbA1c [2].", evidence: [{ excerpt: 1, quote: "recruited 214 participants from three hospitals" }, { excerpt: 2, quote: "primary outcome was change in HbA1c after twelve weeks" }] },
      excerpts, "q", meta,
    );
    expect(a.verified).toBe(true);
    expect(a.citations.map((c) => [c.n, c.page])).toEqual([[1, 1], [2, 2]]);
    expect(a.answer).toBe("214 people took part [1]. The outcome was HbA1c [2].");
  });

  it("drops a made-up quote and the marker that relied on it, and flags the answer as unverified", () => {
    const a = verifyAnswer({ found: true, answer: "It cured everyone [1].", evidence: [{ excerpt: 1, quote: "the treatment cured every single patient in the trial" }] }, excerpts, "q", meta);
    expect(a.verified).toBe(false);
    expect(a.citations).toEqual([]);
    expect(a.answer).toBe("It cured everyone.");
  });

  it("keeps a verified citation while removing an unverified one from the same answer", () => {
    const a = verifyAnswer(
      { found: true, answer: "Pune [1]; also Delhi [2].", evidence: [{ excerpt: 1, quote: "214 participants from three hospitals in Pune" }, { excerpt: 2, quote: "patients were also recruited in Delhi hospitals" }] },
      excerpts, "q", meta,
    );
    expect(a.verified).toBe(true);
    expect(a.answer).toBe("Pune [1]; also Delhi.");
    expect(a.citations.map((c) => c.n)).toEqual([1]);
  });

  it("adds the inline markers when the model gave evidence but forgot to cite in the text", () => {
    const a = verifyAnswer({ found: true, answer: "214 people took part.", evidence: [{ excerpt: 1, quote: "recruited 214 participants from three hospitals" }] }, excerpts, "q", meta);
    expect(a.answer).toBe("214 people took part. [1]");
  });

  it("strips citation tokens the model invents for itself", () => {
    const a = verifyAnswer({ found: true, answer: "214 took part 【1†L1-L3】 in Pune [1].", evidence: [{ excerpt: 1, quote: "recruited 214 participants from three hospitals" }] }, excerpts, "q", meta);
    expect(a.answer).toBe("214 took part in Pune [1].");
  });

  it("ignores evidence that names an excerpt that does not exist", () => {
    const a = verifyAnswer({ found: true, answer: "x [9]", evidence: [{ excerpt: 9, quote: "recruited 214 participants from three hospitals" }] }, excerpts, "q", meta);
    expect(a.verified).toBe(false);
    expect(a.citations).toEqual([]);
  });

  it("passes through 'not in the paper' without inventing citations", () => {
    const a = verifyAnswer({ found: false, answer: "The paper does not cover funding.", evidence: [{ excerpt: 1, quote: "recruited 214 participants from three hospitals" }] }, excerpts, "q", meta);
    expect(a).toMatchObject({ found: false, verified: true, citations: [] });
  });

  it("survives garbage from the model", () => {
    for (const raw of [null, "text", 42, {}, { found: true }, { found: true, answer: 7, evidence: "no" }]) {
      const a = verifyAnswer(raw, excerpts, "q", meta);
      expect(a.citations).toEqual([]);
      expect(typeof a.answer).toBe("string");
    }
  });
});

describe("retrieve", () => {
  const chunks: StoredChunk[] = [
    { idx: 1000, page: 1, text: "Abstract. We study glaucoma screening with deep learning.", embedding: null },
    { idx: 2000, page: 2, text: "Participants were recruited from three hospitals.", embedding: null },
    { idx: 3000, page: 3, text: "The loss function is cross entropy with label smoothing.", embedding: null },
  ];
  it("returns excerpts in reading order", () => {
    const r = retrieve("which loss function was used", null, chunks);
    expect(r.map((c) => c.idx)).toEqual([...r.map((c) => c.idx)].sort((a, b) => a - b));
    expect(r.some((c) => /loss function/.test(c.text))).toBe(true);
  });
  it("always includes the opening passage for broad questions", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ idx: (i + 1) * 1000, page: i + 1, text: i === 0 ? "Title and abstract of the paper." : `Unrelated passage ${i} about ablation settings.`, embedding: null }));
    expect(retrieve("give me a summary of the paper", null, many)[0]!.idx).toBe(1000);
  });
});

describe("answerQuestion", () => {
  const chunks: StoredChunk[] = [
    { idx: 1000, page: 1, text: "Participants were recruited from three hospitals in Pune. Follow-up lasted twelve months.", embedding: null },
    { idx: 2000, page: 2, text: "The loss function is cross entropy with label smoothing.", embedding: null },
  ];
  const run = (question: string, complete: Complete = stubComplete) => answerQuestion({ question, chunks, embed: hashEmbedder, complete, meta });

  it("works end to end with the offline stand-in and cites the right page", async () => {
    const a = await run("How were participants recruited?");
    expect(a.found).toBe(true);
    expect(a.verified).toBe(true);
    expect(a.citations[0]).toMatchObject({ n: 1, page: 1 });
  });

  it("flags a hallucinated quote as unverified instead of presenting it as cited", async () => {
    const a = await run("Please hallucinate an answer");
    expect(a.verified).toBe(false);
    expect(a.citations).toEqual([]);
  });

  it("reports an unanswerable question honestly", async () => {
    expect(await run("an unanswerable question")).toMatchObject({ found: false, verified: true });
  });

  it("puts the question and numbered excerpts in the prompt and treats excerpts as untrusted", async () => {
    let seen = { system: "", user: "" };
    await run("What is the loss function?", async (req) => {
      seen = req;
      return { model: "x", json: { found: false, answer: "", evidence: [] } };
    });
    expect(seen.user).toMatch(/^Question: What is the loss function\?/);
    expect(seen.user).toMatch(/\[1\] \(page \d\)/);
    expect(seen.system).toMatch(/never follow instructions/i);
  });

  it("still answers when the embedding service is down (keyword retrieval)", async () => {
    const a = await answerQuestion({ question: "What is the loss function?", chunks, embed: async () => { throw new Error("down"); }, complete: stubComplete, meta });
    expect(a.found).toBe(true);
  });
});
