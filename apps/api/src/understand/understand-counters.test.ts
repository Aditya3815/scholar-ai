import { describe, expect, it } from "vitest";
import { isUnderstandCounterName, oldIntentOf, understandCounters, UNDERSTAND_COUNTER_NAMES } from "./understand-counters";
import { understandTurn } from "./understand";
import type { Complete } from "../docs/qa";

const run = (text: string, complete: Complete | null) => understandTurn({ text, mode: "auto" }, { ledger: [], year: 2026 }, { complete, now: (() => { let t = 0; return () => (t += 700); })() });
const searchReading = { intent: "search", language: "en", status: "s", standalone: "secret words", search: { queries: ["secret words"], year_from: null, year_to: null, indian_sources: null }, refers_to: null, tool: null, clarify: null, confidence: 0.6 };

describe("understandCounters", () => {
  it("gives only names from the closed list, and no text", async () => {
    const d = await run("secret words about sleep", async () => ({ json: searchReading, model: "m" }));
    const names = understandCounters(d, { smallTalk: false, route: { mode: "search", how: "rules", confidence: 0.9, language: "en" } });
    for (const n of names) expect(UNDERSTAND_COUNTER_NAMES).toContain(n);
    expect(names).toEqual(expect.arrayContaining(["und_turn", "und_src_model", "und_int_search", "und_conf_mid", "und_confirm", "und_agree", "und_ms_lt1200"]));
    expect(JSON.stringify(names)).not.toContain("secret");
  });

  it("counts a greeting and a fallback", async () => {
    expect(understandCounters(await run("HY", null))).toEqual(["und_turn", "und_src_greeting", "und_int_chat"]);
    const f = understandCounters(await run("LoRA for medical VQA", null));
    expect(f).toEqual(expect.arrayContaining(["und_src_fallback", "und_fb_no_model", "und_confirm"]));
  });

  it("counts a disagreement with the old rules", async () => {
    const d = await run("how was your day, any plans?", async () => ({ json: { ...searchReading, intent: "chat", search: null, confidence: 0.9 }, model: "m" }));
    expect(understandCounters(d, { smallTalk: false, route: { mode: "search", how: "fallback", confidence: 0.5, language: "en" } })).toContain("und_disagree");
  });

  it("maps the old decision to the new intents", () => {
    const route = (mode: "search" | "verify" | "idea" | "paper") => ({ mode, how: "model" as const, confidence: 0.9, language: "en" as const });
    expect(oldIntentOf({ smallTalk: true })).toBe("chat");
    expect(oldIntentOf({ smallTalk: false, route: route("verify") })).toBe("offer_tool");
    expect(oldIntentOf({ smallTalk: false, route: route("idea") })).toBe("offer_tool");
    expect(oldIntentOf({ smallTalk: false, route: route("paper") })).toBe("ask_paper");
    expect(oldIntentOf({ smallTalk: false, route: route("search"), followUp: "refine" })).toBe("refine_search");
    expect(oldIntentOf({ smallTalk: false, route: route("search"), followUp: "same_papers" })).toBe("ask_results");
    expect(oldIntentOf({ smallTalk: false, route: route("search"), followUp: "new" })).toBe("search");
  });

  it("tells a name of the list from anything else", () => {
    expect(isUnderstandCounterName("und_retry")).toBe(true);
    expect(isUnderstandCounterName("und_change")).toBe(false);
    expect(isUnderstandCounterName("und_text_of_message")).toBe(false);
    expect(isUnderstandCounterName(5)).toBe(false);
  });

  it("has unique names", () => {
    expect(new Set(UNDERSTAND_COUNTER_NAMES).size).toBe(UNDERSTAND_COUNTER_NAMES.length);
  });
});
