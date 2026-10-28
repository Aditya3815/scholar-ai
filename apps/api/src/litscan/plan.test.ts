import { describe, expect, it } from "vitest";
import { LITSCAN_MAX_ITEMS } from "@scholar/shared";
import { ScanPlanError, buildScanPlanPrompt, planScan, planSystem, sanitizeApproved, sanitizeItems, tidySearchWords } from "./plan";

const item = (question: string, searchQuery: string, title?: string) => ({ question, searchQuery, ...(title !== undefined ? { title } : {}) });

describe("the plan the model proposes", () => {
  it("keeps two to six sub-questions, each with its question and its English search words", () => {
    const out = sanitizeItems({ items: [item("How strong is the link?", "air pollution asthma"), item("How is it measured?", "exposure assessment methods")] });
    expect(out).toEqual([item("How strong is the link?", "air pollution asthma", "Air pollution asthma"), item("How is it measured?", "exposure assessment methods", "Exposure assessment methods")]);
  });

  it("drops repeats (however they are cased), one-word searches, and entries that are not objects", () => {
    const out = sanitizeItems({ items: [item("A?", "Air Pollution Asthma"), item("B?", "air pollution asthma"), item("C?", "asthma"), "text", null, item("D?", "second topic words")] });
    expect(out.map((x) => x.searchQuery)).toEqual(["Air Pollution Asthma", "second topic words"]);
  });

  it("stops at six", () => {
    const many = Array.from({ length: 10 }, (_, i) => item(`Q${i}?`, `topic number ${i}`));
    expect(sanitizeItems({ items: many })).toHaveLength(LITSCAN_MAX_ITEMS);
  });

  it("takes e-mail addresses and links out of the search words, which are what reach the public indexes", () => {
    const [first] = sanitizeItems({ items: [item("Q?", 'cancer "mail me at a.b@example.com" https://secret.example/x www.lab.org'), item("R?", "other words here")] });
    expect(first!.searchQuery).not.toMatch(/@|https?:|www\./);
    expect(first!.searchQuery).toContain("cancer");
  });

  it("uses the search words as the question when the model gave none, and bounds the lengths", () => {
    const out = sanitizeItems({ items: [item("", "tuberculosis vaccine trials"), item("x".repeat(500), "yy ".repeat(200))] });
    expect(out[0]).toEqual(item("tuberculosis vaccine trials", "tuberculosis vaccine trials", "Tuberculosis vaccine trials"));
    expect(out[1]!.question.length).toBeLessThanOrEqual(200);
    expect(out[1]!.searchQuery.length).toBeLessThanOrEqual(160);
  });

  it("keeps each theme's name as a heading: the model's, without a question mark, bounded and scrubbed; the search words when there is none", () => {
    const out = sanitizeItems({ items: [item("Q?", "air pollution asthma", "Strength of the link?"), item("R?", "exposure methods", "x".repeat(90)), item("S?", "other words", "Mail a.b@example.com now")] });
    expect(out[0]!.title).toBe("Strength of the link");
    expect(out[1]!.title!.length).toBeLessThanOrEqual(60);
    expect(out[2]!.title).not.toMatch(/@/);
    expect(sanitizeApproved([item("Q?", "first words", "  "), item("R?", "second words", "Named")])!.map((x) => x.title)).toEqual(["First words", "Named"]);
  });

  it("fails plainly when fewer than two usable sub-questions are left", () => {
    expect(() => sanitizeItems({ items: [item("Q?", "only one here")] })).toThrow(ScanPlanError);
    expect(() => sanitizeItems(null)).toThrow(ScanPlanError);
    expect(() => sanitizeItems({ items: "no" })).toThrow(ScanPlanError);
  });
});

describe("the search words the model proposes", () => {
  it("are plain: typographic hyphens, punctuation and brackets out, at most seven words", () => {
    expect(tidySearchWords("air pollution exposure assessment methods children asthma personal monitoring land‑use regression")).toBe("air pollution exposure assessment methods children asthma");
    expect(tidySearchWords("land‑use regression (LUR), \"PM2.5\"; NO2/ozone")).toBe("land-use regression LUR PM2.5 NO2/ozone");
    expect(tidySearchWords("  - ... /  ")).toBe("");
  });
  it("are tidied in a proposed plan, and left exactly as written in the plan the person approved", () => {
    const raw = { items: [item("Q?", "ambient air pollution childhood asthma incidence systematic review meta‑analysis"), item("R?", "second topic words")] };
    expect(sanitizeItems(raw, 2, true)[0]!.searchQuery).toBe("ambient air pollution childhood asthma incidence systematic");
    expect(sanitizeApproved(raw.items)![0]!.searchQuery).toBe("ambient air pollution childhood asthma incidence systematic review meta‑analysis");
  });
});

describe("the plan the person approved", () => {
  it("is cleaned again (the browser's text is not trusted) and may use a single search word", () => {
    const out = sanitizeApproved([item("What about TB?", "tuberculosis"), item("And BCG? x@y.org", "BCG vaccine")]);
    expect(out).toEqual([item("What about TB?", "tuberculosis", "Tuberculosis"), item("And BCG?", "BCG vaccine", "BCG vaccine")]);
  });
  it("is refused when it is not a list of at least two usable entries", () => {
    expect(sanitizeApproved("x")).toBeNull();
    expect(sanitizeApproved([])).toBeNull();
    expect(sanitizeApproved([item("Q?", "one")])).toBeNull();
    expect(sanitizeApproved([item("Q?", "same words"), item("R?", "same words")])).toBeNull();
    expect(sanitizeApproved([item("Q?", "a"), item("R?", "b")])).toBeNull(); // a search of one letter is not a search
  });
});

describe("asking the model", () => {
  it("sends the topic as untrusted text, asks for the report language and says what must stay out of the search words", async () => {
    let seen: { system: string; user: string; label?: string } | null = null;
    const out = await planScan({
      topic: "air pollution and childhood asthma",
      language: "hinglish",
      complete: async (req) => {
        seen = req;
        return { model: "m", json: { items: [item("Air pollution aur asthma ka link kitna strong hai?", "air pollution asthma children"), item("Exposure kaise measure hota hai?", "exposure measurement asthma")] } };
      },
    });
    expect(out.items).toHaveLength(2);
    expect(seen!.user).toBe(buildScanPlanPrompt("air pollution and childhood asthma"));
    expect(seen!.user).toContain('"""');
    expect(seen!.label).toBe("litscan_plan");
    expect(seen!.system).toMatch(/untrusted/);
    expect(seen!.system).toMatch(/Hinglish/);
    expect(seen!.system).toMatch(/PRIVACY/);
    expect(seen!.system).toContain("title (its name as a review heading");
    expect(planSystem("en")).toMatch(/English/);
  });
});
