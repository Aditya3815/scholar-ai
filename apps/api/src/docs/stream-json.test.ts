import { describe, expect, it } from "vitest";
import { AnswerFieldStreamer } from "./stream-json";

const run = (pieces: string[]) => {
  const s = new AnswerFieldStreamer();
  return pieces.map((p) => s.push(p));
};
const join = (pieces: string[]) => run(pieces).join("");

describe("AnswerFieldStreamer", () => {
  const doc = '{\n  "found": true,\n  "answer": "Participants were recruited from three hospitals [1].",\n  "evidence": [{"excerpt": 1, "quote": "x"}]\n}';

  it("returns only the answer text, never the surrounding JSON", () => {
    expect(join([doc])).toBe("Participants were recruited from three hospitals [1].");
  });

  it("gives the same result however the JSON is split into pieces", () => {
    for (const size of [1, 2, 3, 5, 7, 11, 64]) {
      const pieces = doc.match(new RegExp(`[\\s\\S]{1,${size}}`, "g"))!;
      expect(join(pieces)).toBe("Participants were recruited from three hospitals [1].");
    }
  });

  it("emits text as it arrives, before the evidence has been written", () => {
    const out = run(['{"found": true, "ans', 'wer": "Hello wor', 'ld', '", "evidence": []}']);
    expect(out).toEqual(["", "Hello wor", "ld", ""]);
  });

  it("decodes escapes, including ones cut in half between pieces", () => {
    expect(join(['{"answer": "line one\\', 'nline \\"two\\" and \\u00', 'e9 and back\\\\slash"}'])).toBe('line one\nline "two" and é and back\\slash');
  });

  it("copes with the key appearing split across pieces and with spaces around the colon", () => {
    expect(join(['{"found":true,"ans', 'wer"  :  ', '"ok"}'])).toBe("ok");
  });

  it("ignores everything after the closing quote, even another quoted string", () => {
    expect(join(['{"answer":"a","evidence":[{"quote":"b"}]}'])).toBe("a");
  });

  it("stays empty when there is no answer field", () => {
    expect(join(['{"found": false, "evidence": []}'])).toBe("");
  });

  it("handles an answer that is long and multi-byte", () => {
    const text = "यह अध्ययन ग्रामीण क्लीनिकों में किया गया था। ".repeat(20);
    const json = JSON.stringify({ found: true, answer: text, evidence: [] });
    const pieces = json.match(/[\s\S]{1,9}/g)!;
    expect(join(pieces)).toBe(text);
  });
});
