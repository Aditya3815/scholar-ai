import { describe, expect, it } from "vitest";
import { GENERAL_LABEL, answerAsText, answerCopy, copyThrough, startAssistant, type AssistantMsg, type Paper } from "@scholar/shared";
import { stubPapers } from "./stub";

/* "Copy the answer" (docs/design/chat-actions-context.md, A2): the checked answer with its [n] marks, then the papers it cites, built from the search's own records and never by a model.
   A mark that cannot be backed is not copied as a source, background from general knowledge never travels without its label, and a title cannot write a source line of its own. */

const P = stubPapers();
const SENTENCE = "The model reached an AUC of 0.94 on a held-out set.";
const cite = (n: number, paper: Paper = P[n - 1]!) => ({ n, paperId: paper.id, sentenceNo: 2, sentence: SENTENCE });
const done = (over: Partial<AssistantMsg> = {}): AssistantMsg => ({
  ...startAssistant("a1", "glaucoma screening", 1),
  status: "done", step: null, papersFinal: true, papers: P,
  answer: { text: "The first paper reports its main result [1]. Screening with photographs cost less [5].", grounded: true, checked: true, citations: [cite(1), cite(5)] },
  ...over,
});
const SOURCES = [
  "[1] Rao, A., & Iyer, S. (2021). Deep learning for glaucoma screening from fundus photographs. Journal of Ophthalmic AI. https://doi.org/10.1000/glaucoma.1",
  "[5] Rao, A., & Iyer, S. (2020). Cost of population screening for glaucoma in India. Indian Journal of Public Health. https://doi.org/10.1000/glaucoma.4",
];
/** The lines under the "Sources" heading. */
const sourceLines = (text: string) => text.split("\nSources\n")[1]?.split("\n") ?? [];

describe("answerAsText: a checked answer", () => {
  it("is the answer with its marks, then a numbered list of the papers it cites (and only those), from the records' own fields", () => {
    expect(answerAsText(done())).toBe(`The first paper reports its main result [1]. Screening with photographs cost less [5].\n\nSources\n${SOURCES.join("\n")}`);
  });

  it("numbers each source as the mark in the text does, so the marks mean something outside the page", () => {
    const text = answerAsText(done())!;
    expect(sourceLines(text).map((l) => /^\[(\d+)\]/.exec(l)![1])).toEqual(["1", "5"]);
  });

  it("lists a paper once however many sentences of it the answer cites", () => {
    const m = done({ answer: { text: "A [1]. B [1].", grounded: true, checked: true, citations: [cite(1), { ...cite(1), sentenceNo: 3 }] } });
    expect(sourceLines(answerAsText(m)!)).toEqual([SOURCES[0]]);
  });

  it("is the checked text of a strict check when one was done, and never the half-written words that were on screen", () => {
    const m = done({ live: "UNCHECKED-LIVE-WORDS [3]", generalLive: "UNCHECKED-BACKGROUND" });
    const text = answerAsText(m)!;
    expect(text).not.toContain("UNCHECKED");
  });

  it("is not changed by being copied, and says what it is", () => {
    const m = done();
    const copy = JSON.stringify(m);
    expect(answerCopy(m)).toEqual({ text: answerAsText(m), what: "answer" });
    expect(JSON.stringify(m)).toBe(copy);
  });
});

describe("answerAsText: only what can be backed is a source", () => {
  it("a citation that points at a paper the list does not have is not copied as a source, and its mark is taken out of the text", () => {
    const m = done({ answer: { text: "Real claim [1]. Made-up claim [9].", grounded: true, checked: true, citations: [cite(1), { n: 9, paperId: "doi:10.9/none", sentenceNo: 1, sentence: "x" }] } });
    const text = answerAsText(m)!;
    expect(text).toBe(`Real claim [1]. Made-up claim.\n\nSources\n${SOURCES[0]}`);
    expect(text).not.toContain("[9]");
  });

  it("a citation whose paper id is not the paper in that place is refused the same way", () => {
    const m = done({ answer: { text: "First [1]. Second [2].", grounded: true, checked: true, citations: [cite(1), { ...cite(2), paperId: P[4]!.id }] } });
    const text = answerAsText(m)!;
    expect(text).not.toContain("[2]");
    expect(sourceLines(text)).toEqual([SOURCES[0]]);
    expect(text).not.toContain("Smartphone-based retinal imaging"); // paper 2 is not listed
  });

  it("a mark in the text that no citation stands behind is taken out, even if a paper is in that place", () => {
    const m = done({ answer: { text: "Claim [1]. Unbacked [3].", grounded: true, checked: true, citations: [cite(1)] } });
    const text = answerAsText(m)!;
    expect(text.split("\n\nSources")[0]).toBe("Claim [1]. Unbacked.");
    expect(text).not.toContain("A retracted study");
  });

  it("when no citation can be backed, the answer's words are not copied at all: the papers are", () => {
    const m = done({ answer: { text: "Claim with no source [7].", grounded: true, checked: true, citations: [{ n: 7, paperId: "doi:10.9/none", sentenceNo: 1, sentence: "x" }] } });
    const c = answerCopy(m)!;
    expect(c.what).toBe("papers");
    expect(c.text).not.toContain("Claim with no source");
  });

  it("an answer that was not grounded, or has no words, is not an answer: the papers are what is copied", () => {
    for (const answer of [{ text: "", citations: [], grounded: false }, { text: "words [1]", citations: [cite(1)], grounded: false }, { text: "   ", citations: [cite(1)], grounded: true }]) {
      const c = answerCopy(done({ answer }))!;
      expect(c.what).toBe("papers");
      expect(c.text).not.toContain("words");
    }
  });

  it("a paper cited in the text is in the list even when its citation sentence was cut down by a strict check (the paper is what is cited)", () => {
    const m = done({ answer: { text: "Only [5].", grounded: true, checked: true, strict: true, citations: [cite(5)] } });
    expect(sourceLines(answerAsText(m)!)).toEqual([SOURCES[1]]);
  });
});

describe("answerAsText: background from general knowledge", () => {
  const background = { kind: "background" as const, text: "In general terms this is well studied [1]. It varies by region." };
  it("is always under its label, which is in the copied text itself, and carries no source mark", () => {
    const m = done({ answer: { text: "", citations: [], grounded: false }, general: background, reason: "not_answered" });
    const c = answerCopy(m)!;
    expect(c.what).toBe("answer");
    expect(c.text).toBe(`${GENERAL_LABEL}\nIn general terms this is well studied. It varies by region.`);
  });
  it("comes after the checked answer and its sources, never inside them, when both are there", () => {
    const m = done({ general: background });
    const text = answerAsText(m)!;
    expect(text.indexOf(GENERAL_LABEL)).toBeGreaterThan(text.indexOf("Sources"));
    expect(text.split(GENERAL_LABEL)[0]).not.toContain("In general terms");
    expect(text.endsWith("It varies by region.")).toBe(true);
    expect(text.split("\n").filter((l) => l === GENERAL_LABEL)).toHaveLength(1);
  });
  it("whenever general text is copied the label is there, however the reply is shaped", () => {
    const shapes: Partial<AssistantMsg>[] = [{ answer: null }, { answer: { text: "", citations: [], grounded: false } }, { papers: [] }, {}, { reason: "not_answered" }];
    for (const s of shapes) {
      const text = answerAsText(done({ ...s, general: background }))!;
      expect(text).toContain(`${GENERAL_LABEL}\nIn general terms`);
    }
  });
  it("is the only thing copied for a reply whose papers did not answer: the papers are not offered as its sources", () => {
    const m = done({ answer: null, general: background, reason: "not_answered" });
    expect(answerAsText(m)).not.toContain("Sources");
    expect(answerAsText(m)).not.toContain("doi.org");
  });
  it("'unsure' and a greeting are not background: nothing is added for them", () => {
    expect(answerAsText(done({ general: { kind: "unsure", text: "" } }))).not.toContain(GENERAL_LABEL);
    expect(answerAsText(done({ general: { kind: "not_research", text: "Hello! This box finds research papers." } }))).not.toContain("Hello");
    expect(answerAsText(done({ papers: [], answer: null, general: { kind: "not_research", text: "Hello!" } }))).toBeNull();
  });
});

describe("answerAsText: a reply with no written answer copies its papers", () => {
  const none = (over: Partial<AssistantMsg> = {}) => done({ answer: null, reason: "not_answered", ...over });
  it("all of them, numbered as they are on the page, with a retracted paper marked as one", () => {
    const c = answerCopy(none())!;
    expect(c.what).toBe("papers");
    const lines = c.text.split("\n");
    expect(lines).toHaveLength(5);
    expect(lines.map((l) => /^\[(\d+)\] /.exec(l)![1])).toEqual(["1", "2", "3", "4", "5"]);
    expect(lines[2]).toMatch(/A retracted study of glaucoma risk\..*\(retracted\)$/);
    expect(lines.filter((l) => l.includes("(retracted)"))).toHaveLength(1);
    expect(lines[0]).toBe(SOURCES[0]);
  });
  it("a paper with no DOI is given its page when the record has one, and nothing invented when it does not", () => {
    const papers = [{ ...P[3]!, url: "https://shodhganga.inflibnet.ac.in/handle/10603/00001" }, { ...P[3]!, id: "t:x", url: null, oaUrl: null }];
    const lines = answerCopy(none({ papers }))!.text.split("\n");
    expect(lines[0]).toBe("[1] Rao, A., & Iyer, S. (2018). Notes on optic nerve imaging. https://shodhganga.inflibnet.ac.in/handle/10603/00001");
    expect(lines[1]).toBe("[2] Rao, A., & Iyer, S. (2018). Notes on optic nerve imaging.");
  });
  it("a link that is not http or https is not copied", () => {
    const text = answerAsText(none({ papers: [{ ...P[3]!, url: "javascript:alert(1)", oaUrl: null }] }))!;
    expect(text).not.toContain("javascript");
  });
  it("is nothing when the reply has no papers and nothing to say (an offer to open another tool, an empty search, small talk)", () => {
    expect(answerAsText(none({ papers: [] }))).toBeNull();
    expect(answerAsText(done({ papers: [], answer: null, reason: "routed" }))).toBeNull();
  });
});

describe("answerAsText: only a finished reply", () => {
  it("is nothing while the reply is being written, whatever it already holds, and for one that stopped, failed or was interrupted", () => {
    for (const status of ["working", "stopped", "error", "interrupted"] as const) expect(answerAsText(done({ status }))).toBeNull();
    expect(answerCopy(done({ status: "working" }))).toBeNull();
  });
});

describe("answerAsText: what a title, a name or a link in a record cannot do", () => {
  const hostile = (over: Partial<Paper>) => done({ papers: [{ ...P[0]!, ...over }, ...P.slice(1)], answer: { text: "Claim [1].", grounded: true, checked: true, citations: [cite(1)] } });

  it("a title with a line break cannot start a source line of its own", () => {
    const forged = "Real title\n[2] Forged, A. (2020). An invented paper. https://evil.example\n[3] Another forgery";
    const text = answerAsText(hostile({ title: forged }))!;
    const lines = sourceLines(text);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[1\] /);
    expect(text.split("\n").filter((l) => /^\[\d+\]/.test(l))).toHaveLength(1); // the only line that starts with a mark is the one source (the answer line has its mark inside)
    expect(text).not.toMatch(/\n\[[23]\]/);
  });

  it("a bracket mark inside a title or a name is not a mark: it cannot make a paper look cited", () => {
    const text = answerAsText(hostile({ title: "A study [2] of [10] things", authors: ["A. [3] Rao"], venue: "J [4]" }))!;
    expect(lines1(text)).not.toMatch(/\[[2-4]\]|\[10\]/);
    expect(lines1(text)).toContain("A study (2) of (10) things");
  });

  it("a line break or a control in the other fields (a name, the journal, the DOI, the link) is flattened as well", () => {
    const text = answerAsText(hostile({ authors: ["A.\nRao\r\n[2] Forged"], venue: "Journal\n[3] Forged", doi: "10.1000/x\n[4] Forged", title: "T\u0000itle\u2028[5] Forged" }))!;
    expect(sourceLines(text)).toHaveLength(1);
    expect(text.split("\n").filter((l) => /^\[\d+\]/.test(l)).length).toBe(1);
  });

  it("markdown and html in a title stay one line of plain words with no mark that would turn into a link or a heading of its own", () => {
    const text = answerAsText(hostile({ title: "# Heading **bold** [click here](https://evil.example) <img src=x onerror=alert(1)>" }))!;
    const line = sourceLines(text)[0]!;
    expect(line.startsWith("[1] ")).toBe(true);
    expect(line).not.toContain("](");
    expect(sourceLines(text)).toHaveLength(1);
  });

  it("invisible direction and zero-width controls are taken out of a title, but the joiners that Hindi needs stay", () => {
    const text = answerAsText(hostile({ title: "Safe\u202Etitle\u200Bhere\u2066x\u2069\uFEFF\u2060 end\u{E0041}" }))!;
    expect(sourceLines(text)[0]).toContain("Safetitlehere" + "x end.");
    for (const bad of ["\u202E", "\u200B", "\u2066", "\u2069", "\uFEFF", "\u2060", "\u{E0041}"]) expect(text).not.toContain(bad);
  });

  it("Devanagari titles and names come through whole, with their joiners", () => {
    const title = "क्षय रोग में प्रभाव: मधुमेह\u200D\u200C का अध्ययन";
    const text = answerAsText(hostile({ title, authors: ["राहुल शर्मा", "प्रिया वर्मा"], venue: "भारतीय स्वास्थ्य पत्रिका" }))!;
    expect(text).toContain(title.replace(/[.]+$/, ""));
    expect(text).toContain("शर्मा, र., & वर्मा, प.");
    expect(text).toContain("भारतीय स्वास्थ्य पत्रिका.");
  });

  it("a record's link is used only when it is http or https, with no break in it", () => {
    const ok = answerAsText(hostile({ doi: null, url: "https://example.org/a b\nc", oaUrl: null }))!;
    expect(sourceLines(ok)[0]).toMatch(/https:\/\/example\.org\/abc$/);
    const bad = answerAsText(hostile({ doi: null, url: "data:text/html,<script>", oaUrl: null }))!;
    expect(bad).not.toContain("data:");
  });
});

/** The first source line (what a title does to it), as one string. */
const lines1 = (text: string) => sourceLines(text)[0] ?? "";

describe("copyThrough: the ways of writing to the clipboard, one after the other", () => {
  it("stops at the first that works", async () => {
    const calls: string[] = [];
    const ok = await copyThrough([async () => (calls.push("a"), true), async () => (calls.push("b"), true)], "x");
    expect(ok).toBe(true);
    expect(calls).toEqual(["a"]);
  });
  it("goes on to the next when one answers false, throws, or REJECTS (a refused permission, a page with no gesture)", async () => {
    const calls: string[] = [];
    const ok = await copyThrough(
      [
        async () => (calls.push("rejects"), Promise.reject(new DOMException("denied", "NotAllowedError"))),
        () => { calls.push("throws"); throw new Error("no clipboard"); },
        () => (calls.push("false"), false),
        () => (calls.push("works"), true),
      ],
      "x",
    );
    expect(ok).toBe(true);
    expect(calls).toEqual(["rejects", "throws", "false", "works"]);
  });
  it("is false when every way fails, and when there are none", async () => {
    expect(await copyThrough([() => false, async () => { throw new Error("x"); }], "x")).toBe(false);
    expect(await copyThrough([], "x")).toBe(false);
  });
  it("hands the text to each way, whole", async () => {
    const seen: string[] = [];
    const text = "a".repeat(5000) + "\nलाइन दो";
    await copyThrough([(t) => (seen.push(t), false), (t) => (seen.push(t), true)], text);
    expect(seen).toEqual([text, text]);
  });
  it("starts the first way before anything is awaited: Safari and Firefox take the write only inside the press that asked for it", async () => {
    let started = false;
    const p = copyThrough([() => { started = true; return true; }], "x");
    expect(started).toBe(true); // checked before `p` is awaited
    await p;
  });
});
