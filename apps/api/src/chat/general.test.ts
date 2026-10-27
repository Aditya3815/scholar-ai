import { describe, expect, it } from "vitest";
import type { ChatEvent } from "@scholar/shared";
import { GENERAL_SCHEMA, GENERAL_SYSTEM, answerGeneral, buildGeneralPrompt, checkGeneral, generalSystem, stripMarks } from "./general";

const TEXT = "A p-value is the probability of seeing data at least as extreme as what was observed if the null hypothesis were true. It does not say how likely the hypothesis itself is.";

describe("checkGeneral", () => {
  it("shows background as written, tidied", () => {
    expect(checkGeneral({ kind: "background", answer: `  ${TEXT}  ` })).toEqual({ kind: "background", text: TEXT });
  });

  it("removes source marks a model writes out of habit", () => {
    expect(checkGeneral({ kind: "background", answer: "It is generally understood that sleep helps memory [1]. This is widely accepted [2, 3][4]." })).toEqual({ kind: "background", text: "It is generally understood that sleep helps memory. This is widely accepted." });
    expect(stripMarks("a [1] b [12,13] c [1-3] d [x]")).toBe("a b c d [x]");
  });

  it.each([
    ["a DOI", "This was shown in work with the identifier 10.1038/nature14539 and is well known to everybody."],
    ["a web address", "You can read more at https://example.org/background about how this is generally understood."],
    ["a www address", "See www.example.org for what is generally understood about this question in the field."],
    ["et al.", "Smith et al. found that this is generally the case, and others have agreed with that finding."],
    ["an author and year in brackets", "This is generally understood to be so (Rao, 2019) and has been widely accepted since then."],
    ["two authors and a year", "This is generally understood to be so (Rao and Iyer 2020) and widely accepted since then."],
    ["'in a 2019 study'", "In a 2019 study the effect was found to be large, and this is now generally accepted by researchers."],
    ["'a 2018 meta-analysis'", "A 2018 meta-analysis showed that the effect is generally small, and this is widely accepted."],
  ])("throws away background that carries %s", (_label, answer) => {
    expect(checkGeneral({ kind: "background", answer })).toEqual({ kind: "unsure", text: "" });
  });

  it("keeps background that merely mentions a year or a number", () => {
    const ok = "The pandemic that began in 2020 changed how clinics work. Roughly speaking, most people recover without treatment, and screening is generally advised for older adults.";
    expect(checkGeneral({ kind: "background", answer: ok })).toEqual({ kind: "background", text: ok });
  });

  it("accepts Hinglish and Hindi background", () => {
    const hing = "P-value ka matlab hai ki agar null hypothesis sahi hoti to humein yeh data kitni baar dikhta. Yeh hypothesis ke sach hone ki probability nahi batata.";
    const hi = "पी-मान यह बताता है कि यदि शून्य परिकल्पना सही होती तो ऐसे आँकड़े कितनी बार मिलते। यह परिकल्पना के सच होने की संभावना नहीं बताता।";
    expect(checkGeneral({ kind: "background", answer: hing }).kind).toBe("background");
    expect(checkGeneral({ kind: "background", answer: hi }).text).toBe(hi);
  });

  it("'unsure' and anything that does not fit show nothing", () => {
    for (const raw of [{ kind: "unsure", answer: "I think maybe something" }, { kind: "background", answer: "" }, { kind: "background", answer: "too short" }, { kind: "banana", answer: TEXT }, { answer: TEXT }, { kind: "background" }, { kind: "background", answer: 5 }, null, undefined, "x", 5, []]) {
      expect(checkGeneral(raw)).toEqual({ kind: "unsure", text: "" });
    }
  });

  it("an answer that is far too long is not shown", () => {
    expect(checkGeneral({ kind: "background", answer: `${TEXT} `.repeat(30) })).toEqual({ kind: "unsure", text: "" });
  });

  it("not_research keeps one short sentence, and nothing when it is long or cites", () => {
    expect(checkGeneral({ kind: "not_research", answer: "This box finds research papers and answers from them." })).toEqual({ kind: "not_research", text: "This box finds research papers and answers from them." });
    expect(checkGeneral({ kind: "not_research", answer: "x".repeat(400) })).toEqual({ kind: "not_research", text: "" });
    expect(checkGeneral({ kind: "not_research", answer: "See https://example.org for more about what this box does." })).toEqual({ kind: "not_research", text: "" });
  });
});

describe("the prompt", () => {
  it("forbids naming papers, authors, years, DOIs and numbers, and sources marks; says what unsure and not_research are", () => {
    for (const w of [/specific paper, author, journal, year, DOI/, /Never write citations/, /"unsure"/, /"not_research"/, /untrusted/]) expect(GENERAL_SYSTEM).toMatch(w);
  });
  it("asks for the language of the question: Roman letters for Hinglish, Devanagari for Hindi", () => {
    expect(generalSystem("hinglish")).toMatch(/Hinglish.*Roman letters, not in Devanagari/);
    expect(generalSystem("hi")).toMatch(/in Devanagari/);
    expect(generalSystem("en")).toMatch(/language of the question/);
  });
  it("puts the question alone in the user message, and the schema has the two fields", () => {
    expect(buildGeneralPrompt("what is a p-value?")).toBe("Question: what is a p-value?");
    expect(GENERAL_SCHEMA.required).toEqual(["kind", "answer"]);
    expect(GENERAL_SCHEMA.properties.kind.enum).toEqual(["background", "unsure", "not_research"]);
  });
});

describe("answerGeneral", () => {
  const streaming = (json: unknown, pieces: string[]) => async (_req: unknown, hooks: { onContent?: (p: string) => void }) => {
    for (const p of pieces) hooks.onContent?.(p);
    return { json, model: "m" };
  };

  it("streams the words of the answer field as they come, in order, and returns the checked result", async () => {
    const events: ChatEvent[] = [];
    const json = { kind: "background", answer: TEXT };
    const text = JSON.stringify(json);
    const pieces = text.match(/.{1,9}/g)!;
    const r = await answerGeneral({ question: "what is a p-value?", stream: streaming(json, pieces) as never, emit: (e) => void events.push(e) });
    expect(r).toEqual({ kind: "background", text: TEXT });
    expect(events.every((e) => e.type === "general_token")).toBe(true);
    expect(events.map((e) => (e as { text: string }).text).join("")).toBe(TEXT);
  });

  it("passes the language into the instruction and the question into the prompt", async () => {
    let seen: { system: string; user: string; label?: string } | null = null;
    await answerGeneral({ question: "p-value kya hota hai", language: "hinglish", stream: (async (req: { system: string; user: string; label?: string }) => ((seen = req), { json: { kind: "unsure", answer: "" }, model: "m" })) as never, emit: () => {} });
    expect(seen!.system).toBe(generalSystem("hinglish"));
    expect(seen!.user).toBe("Question: p-value kya hota hai");
    expect(seen!.label).toBe("chat_general");
  });

  it("a model that cites something is thrown away after its words were streamed: the final result is 'unsure'", async () => {
    const json = { kind: "background", answer: "Smith et al. showed this is generally the case and it is widely accepted today." };
    const r = await answerGeneral({ question: "q", stream: streaming(json, [JSON.stringify(json)]) as never, emit: () => {} });
    expect(r).toEqual({ kind: "unsure", text: "" });
  });

  it("lets the model's failure through to the caller", async () => {
    await expect(answerGeneral({ question: "q", stream: (async () => { throw new Error("down"); }) as never, emit: () => {} })).rejects.toThrow("down");
  });
});
