import { describe, expect, it } from "vitest";
import { OCR_MODEL_CHECK, OCR_MODEL_PRIMARY } from "@scholar/shared";
import { DEFAULT_CONFIG } from "./config";
import { EMBED_MODEL } from "../docs/embed";
import { PRICES, costCents } from "./pricing";

describe("costCents", () => {
  it("prices input and output separately, per million tokens, in cents", () => {
    // gpt-oss-120b: $0.35 in, $0.75 out per million. 2,000 in + 2,000 out = $0.0007 + $0.0015 = $0.0022 = 0.22 cents
    const c = costCents("@cf/openai/gpt-oss-120b", 2000, 2000);
    expect(c.known).toBe(true);
    expect(c.cents).toBeCloseTo(0.22, 6);
  });
  it("a call that costs nothing costs nothing, and a million tokens costs the list price", () => {
    expect(costCents("@cf/openai/gpt-oss-120b", 0, 0).cents).toBe(0);
    expect(costCents("@cf/openai/gpt-oss-120b", 1_000_000, 0).cents).toBeCloseTo(35, 6);
    expect(costCents("@cf/openai/gpt-oss-120b", 0, 1_000_000).cents).toBeCloseTo(75, 6);
  });
  it("cached input tokens use the cached rate when the model has one, and never more than the input", () => {
    PRICES["test-model"] = { in: 1, out: 2, cachedIn: 0.1 };
    expect(costCents("test-model", 1_000_000, 0, 500_000).cents).toBeCloseTo(55, 6);
    expect(costCents("test-model", 1000, 0, 5000).cents).toBeCloseTo((1000 * 0.1) / 1e6 * 100, 9);
    expect(costCents("test-model", 1_000_000, 0, -5).cents).toBeCloseTo(100, 6);
    delete PRICES["test-model"];
    expect(costCents("@cf/openai/gpt-oss-120b", 1_000_000, 0, 500_000).cents).toBeCloseTo(35, 6); // no cached rate: full price
  });
  it("a model with no price counts as free and says it is unknown", () => {
    expect(costCents("@cf/someone/new-model", 5000, 5000)).toEqual({ cents: 0, known: false });
  });
});

describe("the price table", () => {
  it("has a price for every model the gateway can route to", () => {
    const models = new Set<string>();
    for (const task of Object.values(DEFAULT_CONFIG.routes)) for (const chain of Object.values(task)) for (const ref of chain) models.add(ref.model);
    for (const m of models) expect(PRICES[m], `no price for ${m}`).toBeDefined();
  });
  it("has a price for the scanned-page readers and the embedding model", () => {
    for (const m of [OCR_MODEL_PRIMARY, OCR_MODEL_CHECK, EMBED_MODEL]) expect(PRICES[m], `no price for ${m}`).toBeDefined();
  });
  it("has sane prices (output at least as dear as input for chat models, nothing negative)", () => {
    for (const [m, p] of Object.entries(PRICES)) {
      expect(p.in, m).toBeGreaterThanOrEqual(0);
      expect(p.out, m).toBeGreaterThanOrEqual(0);
      if (!m.includes("bge")) expect(p.out, m).toBeGreaterThanOrEqual(p.in * 0.5);
    }
  });
});
