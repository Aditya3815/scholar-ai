import { describe, expect, it } from "vitest";
import { MarkStreamFilter, normaliseMarks } from "./answer";

const run = (text: string, size: number) => {
  const f = new MarkStreamFilter();
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += size) parts.push(f.push(text.slice(i, i + size)));
  return parts;
};

describe("MarkStreamFilter: the answer as it is shown while it is written", () => {
  const written = "RAG joins retrieval with generation [1] (S3). It can still make things up [2] S4, [3] (S2-S4) when the papers are thin.";
  it("never shows a half-written mark, whatever the size of the pieces", () => {
    for (const size of [1, 2, 3, 5, 7]) {
      let shown = "";
      for (const p of run(written, size)) {
        shown += p;
        expect(shown, `size ${size}`).not.toMatch(/\(S|\bS\d|\[\d+\]\s*\(|\(\s*$|\[\s*$/);
      }
    }
  });
  it("ends with what the finished answer has, once the last piece has the words after the marks", () => {
    const parts = run(written + " ", 3);
    expect(parts.join("")).toBe(normaliseMarks(written + " "));
  });
  it("shows plain words at once", () => {
    expect(run("Retrieval helps models", 4).join("")).toBe("Retrieval helps models");
    const f = new MarkStreamFilter();
    expect(f.push("Retrieval ")).toBe("Retrieval");
  });
  it("never takes back what it showed", () => {
    const f = new MarkStreamFilter();
    let shown = "";
    for (const piece of ["Models ", "improve [1", "] ", "(S3", ") a lot. ", "More ", "(evidence 2, ", "S5) text."]) shown += f.push(piece);
    expect(shown.startsWith("Models improve [1]")).toBe(true);
    expect(shown).not.toMatch(/S3|S5|evidence/);
  });
});
