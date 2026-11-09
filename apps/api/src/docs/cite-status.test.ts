/**
 * The words on a citation card in the reader (apps/web/src/lib/citeStatus.ts; docs/design/reader-citations.md, 3): "Verified" only when the Reference Verifier said verified,
 * the verifier's own words for every other verdict, and the buttons (Ask, Save, Open) only for a verified entry with a DOI.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { RefVerdict } from "@scholar/shared";
import { CITE_LABEL, NOT_FOUND_HELP, cardRecord, citeStatus, metaLine } from "../../../web/src/lib/citeStatus";

// The verifier's own words are read from its source (lib/refStatus.ts imports browser-only modules that this package's compiler does not know).
const REF_STATUS = readFileSync(decodeURIComponent(new URL("../../../web/src/lib/refStatus.ts", import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"), "utf8");
const labelOf = (key: string): string | undefined => new RegExp(`\\b${key}:\\s*\\{[^}]*?label:\\s*"([^"]+)"`, "s").exec(REF_STATUS)?.[1];

const verdict = (status: RefVerdict["status"], o: Partial<RefVerdict> = {}): RefVerdict => ({
  input: "x",
  status,
  reason: "",
  confidence: 1,
  match: status === "verified" || status === "mismatch" ? { doi: "10.1/abc", title: "Attention Is All You Need", authors: ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar"], year: 2017, venue: "NeurIPS" } : null,
  checks: null,
  ...o,
});
const done = (v: RefVerdict) => ({ state: "done" as const, verdict: v });

describe("the status on a citation card", () => {
  it("says verified only for a finished check whose verdict is verified", () => {
    expect(citeStatus(done(verdict("verified")), true)).toBe("verified");
    for (const s of ["mismatch", "not_found", "unverifiable", "unparsed"] as const) expect(citeStatus(done(verdict(s)), true)).toBe(s);
    expect(citeStatus({ state: "checking" }, true)).toBe("checking");
    expect(citeStatus({ state: "queued" }, true)).toBe("checking");
    expect(citeStatus(undefined, true)).toBe("checking");
    // a request that failed is never a verdict about the reference
    expect(citeStatus({ state: "error" }, true)).toBe("error");
    expect(citeStatus({ state: "error" }, false)).toBe("offline");
    expect(citeStatus(undefined, false)).toBe("offline");
    // a verified verdict that was reached before going offline is still verified
    expect(citeStatus(done(verdict("verified")), false)).toBe("verified");
  });

  it("uses the Reference Verifier's own words for every other verdict", () => {
    for (const [k, label] of Object.entries(CITE_LABEL)) expect(label).toBe(labelOf(k));
    expect(REF_STATUS.replace(/\s+/g, " ")).toContain(`help: "${NOT_FOUND_HELP}"`);
  });

  it("offers Ask, Save and Open only for a verified entry with a DOI, as the matched record", () => {
    expect(cardRecord(done(verdict("verified")))?.paper).toMatchObject({ id: "doi:10.1/abc", doi: "10.1/abc", title: "Attention Is All You Need", retracted: false });
    expect(cardRecord(done(verdict("verified", { retracted: true })))?.paper.retracted).toBe(true);
    expect(cardRecord(done(verdict("mismatch")))).toBeNull();
    expect(cardRecord(done(verdict("not_found")))).toBeNull();
    expect(cardRecord(done(verdict("verified", { match: { doi: null, title: "T", authors: [], year: 2017, venue: null } })))).toBeNull();
    expect(cardRecord({ state: "checking" })).toBeNull();
  });

  it("writes the line under the title as surname, venue and year", () => {
    expect(metaLine({ authors: ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar"], venue: "NeurIPS", year: 2017 })).toBe("Vaswani et al., NeurIPS 2017");
    expect(metaLine({ authors: ["Smith, J.", "Jones, K."], venue: null, year: 2019 })).toBe("Smith and Jones, 2019");
    expect(metaLine({ authors: [], venue: "Nature", year: null })).toBe("Nature");
  });
});
