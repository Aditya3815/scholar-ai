import { describe, expect, it } from "vitest";
import { MAX_CHAT_CHARS, cleanChatMessage, type ChatEvent, type Paper } from "@scholar/shared";
import { CHAT_SYSTEM, MAX_EVIDENCE_PAPERS, answerFromResults, buildChatPrompt, normaliseMarks, papersOnTheSubject, pickEvidencePapers, verifyChatAnswer } from "./answer";
import { stubChatStream, stubPapers, stubSearchFor } from "./stub";

const paper = (i: number, over: Partial<Paper> = {}): Paper => ({
  id: `doi:10.1/${i}`, doi: `10.1/${i}`, pmid: null, title: `Paper ${i}`, authors: ["A. B"], year: 2020, venue: "J", abstract: `First sentence of paper ${i} is here and it is long enough to count as an abstract. Second sentence says the model reached ninety percent. Third sentence lists a limitation.`,
  citationCount: 1, oaUrl: null, retracted: false, retractionSources: [], sources: ["openalex"], score: 1, ...over,
});

describe("cleanChatMessage", () => {
  it("tidies spaces and control characters", () => expect(cleanChatMessage("  glaucoma \n\t screening \u0000 India ")).toBe("glaucoma screening India"));
  it("refuses what cannot be sent: not text, too short, too long, no letter or number", () => {
    for (const bad of [null, undefined, 5, {}, "", " ", "a", "??", "...", "x".repeat(MAX_CHAT_CHARS + 1)]) expect(cleanChatMessage(bad)).toBeNull();
    expect(cleanChatMessage("x".repeat(MAX_CHAT_CHARS))).not.toBeNull();
  });
  it("accepts two letters, numbers and Hindi", () => {
    expect(cleanChatMessage("AI")).toBe("AI");
    expect(cleanChatMessage("12")).toBe("12");
    expect(cleanChatMessage("मोतियाबिंद की जांच")).toBe("मोतियाबिंद की जांच");
  });
});

describe("pickEvidencePapers", () => {
  it("takes papers with a real abstract, not retracted, keeping their place in the list as their number", () => {
    const list = [paper(1), paper(2, { abstract: null }), paper(3, { retracted: true }), paper(4, { abstract: "too short" }), paper(5)];
    expect(pickEvidencePapers(list).map((p) => p.n)).toEqual([1, 5]);
  });
  it("reads at most eight, and only from the first twenty", () => {
    const many = Array.from({ length: 30 }, (_, i) => paper(i + 1));
    const picked = pickEvidencePapers(many);
    expect(picked).toHaveLength(MAX_EVIDENCE_PAPERS);
    expect(picked.at(-1)!.n).toBe(MAX_EVIDENCE_PAPERS);
    expect(pickEvidencePapers([...Array.from({ length: 20 }, (_, i) => paper(i + 1, { abstract: null })), paper(21)])).toEqual([]);
  });
});

describe("buildChatPrompt", () => {
  it("numbers the papers by their place and the sentences of each abstract, and puts the question first", () => {
    const p = buildChatPrompt("what is the accuracy?", pickEvidencePapers([paper(1), paper(2, { abstract: null }), paper(3)]));
    expect(p.startsWith("Question: what is the accuracy?")).toBe(true);
    expect(p).toContain("[1] Paper 1 (2020)");
    expect(p).toContain("[3] Paper 3 (2020)");
    expect(p).not.toContain("[2]");
    expect(p).toMatch(/S1 First sentence of paper 1/);
    expect(p).toMatch(/S2 Second sentence says/);
  });
  it("the rules say the papers are untrusted and the answer is in the language of the question", () => {
    expect(CHAT_SYSTEM).toMatch(/untrusted/);
    expect(CHAT_SYSTEM).toMatch(/language of the question/);
  });
});

describe("verifyChatAnswer", () => {
  const picked = pickEvidencePapers([paper(1), paper(2)]);
  it("turns a paper and sentence number into the sentence itself, and keeps the markers that are backed", () => {
    const a = verifyChatAnswer({ enough: true, answer: "The model reached 90 percent [2] and had a limitation [1].", evidence: [{ n: 2, s: 2 }, { n: 1, s: 3 }] }, picked);
    expect(a.grounded).toBe(true);
    expect(a.citations.map((c) => [c.n, c.sentenceNo])).toEqual([[1, 3], [2, 2]]);
    expect(a.citations[1]!.sentence).toBe("Second sentence says the model reached ninety percent.");
    expect(a.citations[1]!.paperId).toBe("doi:10.1/2");
    expect(a.text).toBe("The model reached 90 percent [2] and had a limitation [1].");
  });
  it("drops a sentence number that is not one, a paper that was not shown, and takes out the markers that point at nothing", () => {
    const a = verifyChatAnswer({ enough: true, answer: "A [1] and B [2] and C [7].", evidence: [{ n: 1, s: 2 }, { n: 2, s: 99 }, { n: 7, s: 1 }, { n: 1, s: 3 }] }, picked);
    expect(a.citations.map((c) => c.n)).toEqual([1]);
    expect(a.text).toBe("A [1] and B and C.");
  });
  it("adds the markers when the model forgot them", () => {
    expect(verifyChatAnswer({ enough: true, answer: "It worked.", evidence: [{ n: 1, s: 2 }] }, picked).text).toBe("It worked. [1]");
  });
  it("is not grounded when nothing it cites is real, or the model says the papers do not answer", () => {
    expect(verifyChatAnswer({ enough: true, answer: "Made up [1].", evidence: [{ n: 1, s: 50 }] }, picked)).toMatchObject({ grounded: false, text: "", citations: [], enough: true });
    expect(verifyChatAnswer({ enough: false, answer: "", evidence: [] }, picked)).toMatchObject({ grounded: false, text: "", enough: false });
    // an answer with no sentence behind it is not shown, whatever the model thinks of it
    expect(verifyChatAnswer({ enough: false, answer: "I think so.", evidence: [] }, picked)).toMatchObject({ grounded: false, text: "", enough: false });
  });
  it("what decides is the evidence, not the model's own 'enough': a careful model may say false about a supported answer", () => {
    const a = verifyChatAnswer({ enough: false, answer: "Only partly [1].", evidence: [{ n: 1, s: 2 }] }, picked);
    expect(a).toMatchObject({ grounded: true, enough: false });
    expect(a.citations).toHaveLength(1);
  });
  it("marks that carry the sentence number or several papers are put right", () => {
    const a = verifyChatAnswer({ enough: true, answer: "A [1 (2)] and B [1, 2] and C [2; 1].", evidence: [{ n: 1, s: 2 }, { n: 2, s: 3 }] }, picked);
    expect(a.text).toBe("A [1] and B [1][2] and C [2][1].");
  });
  it("never throws on odd output", () => {
    for (const raw of [null, undefined, "x", 5, [], {}, { enough: true }, { enough: true, answer: 5, evidence: "no" }, { enough: true, answer: "ok", evidence: [null, 1, { n: "1", s: "2" }, { n: 1.9, s: 2.2 }] }]) {
      expect(() => verifyChatAnswer(raw, picked)).not.toThrow();
    }
    // a number that is not a whole number is not a sentence number
    expect(verifyChatAnswer({ enough: true, answer: "ok [1]", evidence: [{ n: 1.9, s: 2.2 }] }, picked).grounded).toBe(false);
    expect(verifyChatAnswer({ enough: true, answer: "ok [1]", evidence: [{ n: 1.9, s: 2 }] }, picked).grounded).toBe(true);
  });
  it("a model's own citation marks are removed", () => {
    expect(verifyChatAnswer({ enough: true, answer: "It worked 【31†L1-L3】 [1].", evidence: [{ n: 1, s: 2 }] }, picked).text).toBe("It worked [1].");
  });
  it("a cited sentence longer than the limit is cut at a word, still word for word", () => {
    const long = paper(1, { abstract: `${"word ".repeat(120)}end. Second one is short enough to be a sentence of its own here.` });
    const a = verifyChatAnswer({ enough: true, answer: "x [1]", evidence: [{ n: 1, s: 1 }] }, pickEvidencePapers([long]));
    expect(a.citations[0]!.sentence.length).toBeLessThanOrEqual(300);
    expect(long.abstract!.startsWith(a.citations[0]!.sentence)).toBe(true);
  });
});

describe("coverage", () => {
  const picked = pickEvidencePapers([paper(1), paper(2)]);
  it("'none' is not answered, 'partial' and 'full' are answers when a sentence stands behind them", () => {
    expect(verifyChatAnswer({ coverage: "none", answer: "", evidence: [] }, picked)).toMatchObject({ grounded: false, enough: false });
    expect(verifyChatAnswer({ coverage: "partial", answer: "Part of it [1].", evidence: [{ n: 1, s: 2 }] }, picked)).toMatchObject({ grounded: true, enough: true });
    expect(verifyChatAnswer({ coverage: "full", answer: "All of it [1].", evidence: [{ n: 1, s: 2 }] }, picked)).toMatchObject({ grounded: true });
  });
  it("an answer with a sentence behind it is shown even if the model said 'none'", () => {
    expect(verifyChatAnswer({ coverage: "none", answer: "Something [1].", evidence: [{ n: 1, s: 2 }] }, picked).grounded).toBe(true);
  });
  it("a made-up evidence with 'full' is 'not grounded', not 'not answered'", () => {
    expect(verifyChatAnswer({ coverage: "full", answer: "x [1].", evidence: [{ n: 1, s: 50 }] }, picked)).toMatchObject({ grounded: false, enough: true });
  });
});

describe("answerFromResults", () => {
  it("streams the text as it is written, in order, then returns the checked answer", async () => {
    const events: ChatEvent[] = [];
    const picked = pickEvidencePapers(stubPapers());
    const a = await answerFromResults({ question: "what did they find?", picked, stream: stubChatStream, emit: (e) => void events.push(e) });
    expect(a.grounded).toBe(true);
    const tokens = events.filter((e) => e.type === "token").map((e) => (e as { text: string }).text).join("");
    expect(tokens).toBe("The first paper reports its main result [1].");
    expect(events.find((e) => e.type === "step" && e.step === "write")).toBeTruthy();
    expect(a.text).toBe("The first paper reports its main result [1].");
  });
  it("a made-up sentence number is not grounded, and 'unanswerable' is not answered", async () => {
    const picked = pickEvidencePapers(stubPapers());
    expect((await answerFromResults({ question: "hallucinate this", picked, stream: stubChatStream, emit: () => {} })).grounded).toBe(false);
    expect(await answerFromResults({ question: "an unanswerable one", picked, stream: stubChatStream, emit: () => {} })).toMatchObject({ grounded: false, enough: false });
  });
  it("the retracted paper of the stub is never one the model reads", () => {
    const picked = pickEvidencePapers(stubPapers());
    expect(picked.some((p) => p.paper.retracted)).toBe(false);
    expect(picked.map((p) => p.n)).toEqual([1, 2, 5]);
  });
});

describe("stub search", () => {
  it("'nothing' finds no papers, 'partial' makes a source fail", () => {
    expect(stubSearchFor("nothing here").results).toEqual([]);
    expect(Object.values(stubSearchFor("partial results").providers).some((p) => !p.ok)).toBe(true);
    expect(Object.values(stubSearchFor("glaucoma").providers).every((p) => p.ok)).toBe(true);
  });
});

describe("papersOnTheSubject and the one retry", () => {
  const mk = (title: string) => paper(1, { title, abstract: `${title} is studied here in a long enough abstract to be read by a model, in detail.` });
  it("counts the papers that use at least two of the question's key words", () => {
    const picked = pickEvidencePapers([mk("Glaucoma screening with smartphone fundus photographs"), mk("Tuberculosis vaccines"), { ...mk("Smartphone fundus imaging"), id: "x" }]);
    expect(papersOnTheSubject("glaucoma screening with smartphone fundus photographs in rural India", picked)).toBe(2);
    expect(papersOnTheSubject("hi", picked)).toBe(0);
  });
  it("tries once more when the model says 'none' about papers that use the question's words, and keeps what it then answers", async () => {
    const picked = pickEvidencePapers([mk("Glaucoma screening with smartphone fundus photographs"), { ...mk("Smartphone fundus glaucoma imaging"), id: "y" }]);
    let calls = 0;
    const users: string[] = [];
    const stream = async (req: { user: string }) => {
      users.push(req.user);
      calls++;
      return { model: "fake", json: calls === 1 ? { coverage: "none", answer: "", evidence: [] } : { coverage: "partial", answer: "They screen [1].", evidence: [{ n: 1, s: 1 }] } };
    };
    const a = await answerFromResults({ question: "glaucoma screening smartphone fundus", picked, stream, emit: () => {} });
    expect(calls).toBe(2);
    expect(users[1]).toMatch(/^Note: several of the papers/);
    expect(a.grounded).toBe(true);
  });
  it("does not try again when the papers are not about the subject, or when the second answer is no better", async () => {
    let calls = 0;
    const none = async () => ((calls++), { model: "fake", json: { coverage: "none", answer: "", evidence: [] } });
    await answerFromResults({ question: "quantum chromodynamics lattice simulations", picked: pickEvidencePapers([paper(1), paper(2)]), stream: none, emit: () => {} });
    expect(calls).toBe(1);
    calls = 0;
    const picked = pickEvidencePapers([mk("Glaucoma screening with smartphone fundus photographs"), { ...mk("Smartphone fundus glaucoma imaging"), id: "z" }]);
    const a = await answerFromResults({ question: "glaucoma screening smartphone fundus", picked, stream: none, emit: () => {} });
    expect(calls).toBe(2);
    expect(a.grounded).toBe(false);
  });
});

describe("normaliseMarks", () => {
  it.each([
    ["Worked 【1】(9).", "Worked [1]."],
    ["Worked [1] (4) and [6] (3).", "Worked [1] and [6]."],
    ["Worked (1) (4) and (6) (3).", "Worked [1] and [6]."],
    ["Worked [1 (4)].", "Worked [1]."],
    ["Worked [1, 6] and [2; 3].", "Worked [1][6] and [2][3]."],
    ["Worked [6] (5-8).", "Worked [6]."],
    ["Worked 【12†S1-S7】[2].", "Worked [12][2]."],
    ["Worked 【no digits here】[2].", "Worked [2]."],
    ["Worked (1 S2-S4) and (3 S5).", "Worked [1] and [3]."],
    ["Worked (evidence 1 S7). Also (source 2, S6-S8) and (paper 3).", "Worked [1]. Also [2] and [3]."],
    ["Worked (evidence 1:S9). And (evidence: 1:S1, 6:S5, 6:S7).", "Worked [1]. And [1][6]."],
    ["Worked (evidence: see the first abstract).", "Worked."],
    ["Sensitivities of 83‑97 % (12 S1‑S6; 14 S1‑S8).", "Sensitivities of 83‑97 % [12][14]."],
    ["It may help [7], S7‑S9. Next.", "It may help [7]. Next."],
    ["Worked [1]S4; [7]S9.", "Worked [1]; [7]."],
    ["Worked [1](S2)[3](S3).", "Worked [1][3]."],
    ["Worked [1] (S5-8) and [2] (S1).", "Worked [1] and [2]."],
    ["Rat models improved[2][S11][S13]. Next [4][S10][S11][S12].", "Rat models improved[2]. Next [4]."],
    ["Used for brain graphs [1] [1] and diagnosis [1] [1]. Also [7] [7] aur [19] [19].", "Used for brain graphs [1] and diagnosis [1]. Also [7] aur [19]."],
    ["A range [S3-S5] and [S2] go.", "A range and go."],
    ["Two different marks stay [1] [2].", "Two different marks stay [1] [2]."],
    ["Specificity in several studies [12:S6][14:S8][18:S9‑S10]. Next.", "Specificity in several studies [12][14][18]. Next."],
    ["as several Indian studies [1 S4‑S5]. A review [3 S1, 5 S2].", "as several Indian studies [1]. A review [3][5]."],
    ["Worked [12S6] and [7: S2; 9: S3].", "Worked [12] and [7][9]."],
    ["A range [1-3] and a year [2020] stay.", "A range [1-3] and a year [2020] stay."],
    ["Two  spaces   go.", "Two spaces go."],
  ])("%s", (input, want) => expect(normaliseMarks(input)).toBe(want));
  it("a round bracket with a real remark in it is left alone", () => {
    expect(normaliseMarks("Rates fell (by 12 points, p < 0.01) in S1 patients [3].")).toBe("Rates fell (by 12 points, p < 0.01) in S1 patients [3].");
  });
  it("a label S1 in the text itself, not right after a mark, is left", () => {
    expect(normaliseMarks("See Figure S1 for the setup [2].")).toBe("See Figure S1 for the setup [2].");
  });
  it("leaves a year, a count and a plain number in round brackets alone", () => {
    expect(normaliseMarks("Smith [1] (2019) enrolled 40 people (n = 40) over (12) weeks.")).toBe("Smith [1] (2019) enrolled 40 people (n = 40) over (12) weeks.");
  });
});
