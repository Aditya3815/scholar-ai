import { describe, expect, it } from "vitest";
import { cosine, decodeVec, encodeVec, keywords, lexical, rank } from "./vector";

describe("vectors", () => {
  it("survives the int8 text encoding well enough to rank by cosine", () => {
    const v = Array.from({ length: 1024 }, (_, i) => Math.sin(i * 0.37) * (1 + (i % 5)));
    const w = Array.from({ length: 1024 }, (_, i) => Math.cos(i * 0.11));
    const back = decodeVec(encodeVec(v));
    expect(back).toHaveLength(1024);
    expect(cosine(v, back)).toBeGreaterThan(0.999);
    expect(Math.abs(cosine(v, w) - cosine(back, decodeVec(encodeVec(w))))).toBeLessThan(0.02);
    expect(encodeVec(v).length).toBeLessThan(1400); // ~1.3 KB of text instead of 4 KB of floats
  });

  it("encodes a zero vector without dividing by zero", () => {
    expect([...decodeVec(encodeVec([0, 0, 0]))]).toEqual([0, 0, 0]);
  });

  it("cosine is 1 for identical, 0 for orthogonal, and 0 for mismatched lengths", () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([1, 2], [1, 2, 3])).toBe(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });

  it("keywords drop stop words and duplicates", () => {
    expect(keywords("What is the sample size of the study and the sample?")).toEqual(["sample", "size"]);
  });

  it("lexical is the share of question keywords present", () => {
    expect(lexical(["sample", "size"], "The sample was large")).toBe(0.5);
    expect(lexical([], "anything")).toBe(0);
  });
});

describe("rank", () => {
  const e = (a: number[]) => Float32Array.from(a);
  const chunks = [
    { text: "Participants were recruited from three hospitals.", embedding: e([1, 0, 0]) },
    { text: "The loss function is cross entropy.", embedding: e([0, 1, 0]) },
    { text: "Limitations include a small sample.", embedding: e([0, 0, 1]) },
  ];

  it("puts the semantically closest chunk first", () => {
    const top = rank("how were participants recruited", [0.9, 0.1, 0], chunks, 2);
    expect(top[0]!.text).toMatch(/recruited/);
    expect(top).toHaveLength(2);
  });

  it("falls back to keywords when embeddings are missing or from another model", () => {
    const noVec = chunks.map((c) => ({ ...c, embedding: null }));
    expect(rank("what are the limitations", null, noVec, 1)[0]!.text).toMatch(/Limitations/);
    expect(rank("what are the limitations", [1, 2, 3, 4], chunks, 1)[0]!.text).toMatch(/Limitations/);
  });
});
