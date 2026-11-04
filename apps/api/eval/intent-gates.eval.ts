// The gates file of the intent eval (docs/eval/intent-gates.json) is a FROZEN-BEFORE-FIRST-RUN artefact (plan P14, section 8.5 line 784): a wrong number in it is worse than a missing one.
// So this test holds a SECOND, independent transcription of the plan's table (EXPECTED below, typed from the table rows, not copied from the JSON); a typo in either copy makes them differ.
// It also checks the shape of the file, that every release of plan 4.1 has an entry, and that evaluateGate can read every gate.
import { afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { evaluateGate, type Gate, type Observed } from "./lib/metrics";
// @ts-expect-error plain .mjs helper, also used by the hash script
import { canonicalFromText } from "../scripts/lib/canonical-json.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const FILE = HERE + "../../../docs/eval/intent-gates.json";
const HASH_SCRIPT = HERE + "../scripts/intent-gates-hash.mjs";
const text = readFileSync(FILE, "utf8");
const doc = JSON.parse(text) as { version: number; frozen: boolean; reading_rules: string[]; owner_loosening: string; gates: Gate[] };
const gates = doc.gates;
const byId = new Map(gates.map((g) => [g.id, g]));

const KINDS = ["rate_max", "rate_min", "paired_no_worse", "count_equals", "floor", "tests_pass", "report_only"];
const COUNTED = ["rate_max", "rate_min", "paired_no_worse", "count_equals", "floor"];
/** Every release row of plan 4.1 (lines 218-244), plus the 'Always' row of 8.5. */
const RELEASES = ["E0", "H0", "R1", "R2", "R3", "T1", "R4", "R5", "R6a", "R6b", "R7", "R8", "R9", "R10", "R11", "R12", "R13", "R14", "R15", "R16", "R17", "R18", "R19", "R20", "R21", "R22", "R23"];

describe("the file", () => {
  it("has the top-level fields the plan asks for", () => {
    expect(doc.version).toBe(1);
    expect(typeof doc.frozen).toBe("boolean"); // false until the lead freezes the file at the commit that carries the hash; true after, and the suite stays green
    expect(doc.owner_loosening).toBe("only the owner, in writing");
    expect(Array.isArray(doc.reading_rules)).toBe(true);
    expect(doc.reading_rules.length).toBeGreaterThanOrEqual(6);
    for (const r of doc.reading_rules) expect(typeof r === "string" && r.length > 10).toBe(true);
    expect(Array.isArray(gates)).toBe(true);
    expect(gates.length).toBeGreaterThan(80);
  });

  // The plan's "Baseline today" cells use double quote marks; the file uses single ones (9 gates of R4 and R7), and says so instead of claiming to be verbatim.
  it("says that a baseline is the plan's cell verbatim except for its quote marks, and holds no double quote mark", () => {
    const note = (JSON.parse(text) as { baseline_note: string }).baseline_note;
    expect(note).toContain("verbatim except");
    expect(note).toContain("quote");
    expect(gates.filter((g) => g.baseline !== null && g.baseline.includes(String.fromCharCode(34))).map((g) => g.id)).toEqual([]);
  });

  it("has unique ids of lower-case letters, digits, dots and underscores", () => {
    const seen = new Set<string>();
    for (const g of gates) {
      expect(typeof g.id).toBe("string");
      for (const ch of g.id) expect("abcdefghijklmnopqrstuvwxyz0123456789._".includes(ch), g.id).toBe(true);
      expect(seen.has(g.id), "duplicate id " + g.id).toBe(false);
      seen.add(g.id);
    }
  });

  it("gives every gate the same fields, with the right types", () => {
    for (const g of gates) {
      const where = g.id;
      expect(typeof g.release, where).toBe("string");
      expect(typeof g.metric, where).toBe("string");
      expect(g.metric.length, where).toBeGreaterThan(2);
      expect(KINDS, where).toContain(g.kind);
      expect(g.threshold === null || (typeof g.threshold === "number" && Number.isFinite(g.threshold)), where + " threshold").toBe(true);
      expect(g.n_min === null || (Number.isInteger(g.n_min) && (g.n_min as number) > 0), where + " n_min").toBe(true);
      expect(g.baseline === null || typeof g.baseline === "string", where + " baseline").toBe(true);
      expect(Number.isInteger(g.source) && g.source > 0 && g.source < 1100, where + " source").toBe(true);
      expect(["proposed", "needs_owner"], where).toContain(g.status);
      expect(typeof g.note === "string" && g.note.length > 0 && g.note.length <= 700, where + " note").toBe(true);
      if (g.also_releases !== undefined) expect(Array.isArray(g.also_releases), where).toBe(true);
      if (g.n_min_reason !== undefined) expect(typeof g.n_min_reason === "string" && g.n_min_reason.length > 5, where).toBe(true);
    }
  });

  it("has no NaN and no infinity anywhere in a threshold or n_min (a NaN threshold would never fail)", () => {
    for (const g of gates) {
      if (g.threshold !== null) expect(Number.isNaN(g.threshold), g.id).toBe(false);
      if (g.n_min !== null) expect(Number.isNaN(g.n_min), g.id).toBe(false);
    }
    expect(text.includes("NaN")).toBe(false);
    expect(text.includes("Infinity")).toBe(false);
  });

  it("names every release of plan 4.1, and the Always row, and no release that is not in the plan", () => {
    const named = new Set<string>();
    for (const g of gates) {
      named.add(g.release);
      for (const r of g.also_releases ?? []) named.add(r);
    }
    for (const r of RELEASES) expect(named.has(r), "no gate names release " + r).toBe(true);
    expect(named.has("always")).toBe(true);
    for (const r of named) expect([...RELEASES, "always"], "unknown release " + r).toContain(r);
  });

  it("gives every counted gate an n_min or a stated reason, and never lets a rate with no stated n pass", () => {
    for (const g of gates) {
      if (!COUNTED.includes(g.kind)) continue;
      expect(g.n_min !== null || (typeof g.n_min_reason === "string" && g.n_min_reason.length > 5), g.id + " has neither n_min nor n_min_reason").toBe(true);
      if (["rate_max", "rate_min", "paired_no_worse"].includes(g.kind) && g.n_min === null) {
        expect(g.status, g.id + ": a rate with no stated n needs the owner").toBe("needs_owner");
      }
    }
  });

  // A floor or a count that is read from one run (a size, a timing, a count of calls, the fixed G5 and G6 sets) needs no n. A mean over a sample does, and a gate with no stated n can never pass.
  it("lets a floor or count with no n_min be proposed only if it is a quantity of one run: the list is exact, so a mean over a sample cannot slip in", () => {
    const proposed = gates.filter((g) => (g.kind === "floor" || g.kind === "count_equals") && g.n_min === null && g.status === "proposed").map((g) => g.id);
    expect(proposed.sort()).toEqual([
      "r13.lookup_calls",
      "r18.first_load_budget",
      "r19.fold_call_time",
      "r1.g5_floor",
      "r1.g6_floor",
      "r22.first_load_budget",
      "r3.statements_per_message",
      "r4.long_message_read_time",
      "r6a.continue_from_strings",
      "r6a.first_load_script",
      "r6a.first_load_style",
    ].sort());
  });

  it("the R8 oracle-overlap gate states no n, so it needs the owner and cannot pass on a mean alone; it reads the filler class only", () => {
    const g = byId.get("r8.oracle_overlap_20_filler")!;
    expect(g.status).toBe("needs_owner");
    expect(g.note).toContain("filler class");
    expect(g.note).toContain("cleanOracle");
    expect(evaluateGate(g, { value: 0.9 }).status).toBe("needs_owner");
    expect(evaluateGate(g, { value: 0.9, n: 1000 }).status).toBe("needs_owner");
  });

  it("marks a gate without a number needs_owner unless it is a report or a test", () => {
    for (const g of gates) {
      if (g.threshold === null && g.kind !== "report_only" && g.kind !== "tests_pass") expect(g.status, g.id).toBe("needs_owner");
    }
  });

  it("says what is ambiguous in every needs_owner gate, and says 'not a gate' in every report_only target", () => {
    for (const g of gates) {
      if (g.status === "needs_owner") expect(g.note.length, g.id).toBeGreaterThan(30);
      if (g.kind === "report_only") expect(g.note.toLowerCase().includes("report") || g.note.toLowerCase().includes("not a gate"), g.id).toBe(true);
    }
  });

  it("gives every floor a direction, and every relative floor a threshold", () => {
    for (const g of gates) {
      if (g.kind === "floor") expect(["at_least", "at_most", "under"], g.id).toContain(g.direction);
      if (g.relative_to !== undefined) {
        expect(g.kind, g.id).toBe("floor");
        expect(typeof g.relative_to === "string" && g.relative_to.length > 3, g.id).toBe(true);
        expect(g.threshold, g.id).not.toBeNull();
      }
    }
  });

  it("keeps a rate between 0 and 1", () => {
    for (const g of gates) {
      if (g.kind === "rate_max" || g.kind === "rate_min") {
        expect(g.threshold as number, g.id).toBeGreaterThanOrEqual(0);
        expect(g.threshold as number, g.id).toBeLessThanOrEqual(1);
      }
    }
  });
});

/** [id, release, kind, threshold, n_min], typed from the plan's table (lines 788-811, and 207, 250, 449, 620-625 where a cell points there). `null` is a number the plan does not give. */
const EXPECTED: [string, string, string, number | null, number | null][] = [
  // E0 (4.2, line 250): no numbers, three yes-or-no conditions
  ["e0.gates_committed_with_hash", "E0", "tests_pass", null, null],
  ["e0.holdout_hash_recorded", "E0", "tests_pass", null, null],
  ["e0.safety_sets_complete_sealed", "E0", "tests_pass", null, null],
  ["h0.no_gate_row", "H0", "report_only", null, null],
  // R1
  ["r1.g5_g6_paired_worse", "R1", "paired_no_worse", 0, 50],
  ["r1.prior_art_unchanged", "R1", "tests_pass", null, null],
  ["r1.twin_first", "R1", "count_equals", 0, 12],
  ["r1.g5_floor", "R1", "floor", 0.9, null],
  ["r1.g6_floor", "R1", "floor", 0.85, null],
  // R2
  ["r2.entities", "R2", "count_equals", 0, 200],
  ["r2.control_white_space", "R2", "count_equals", 0, 200],
  ["r2.g1_g6_unchanged", "R2", "tests_pass", null, null],
  // R3
  ["r3.counted_names_closed_list", "R3", "tests_pass", null, null],
  ["r3.no_message_text", "R3", "tests_pass", null, null],
  ["r3.statements_per_message", "R3", "floor", 8, null],
  ["r3.production_read_7d", "R3", "report_only", null, 300],
  // T1
  ["t1.pinned_text_tests", "T1", "tests_pass", null, null],
  ["t1.routing_no_model_call", "T1", "count_equals", 0, 20],
  // R4
  ["r4.urgent_recall", "R4", "rate_min", 0.9, 40],
  ["r4.crisis_recall", "R4", "rate_min", 0.9, 40],
  ["r4.help_recall", "R4", "rate_min", 0.9, 15],
  ["r4.unmistakable_misses", "R4", "count_equals", 0, 10],
  ["r4.false_replies", "R4", "rate_max", 0, 260],
  ["r4.decision_care_wrong_note", "R4", "rate_max", 0.05, 100],
  ["r4.long_message_read_time", "R4", "floor", 10, null],
  ["r4.helpline_checked", "R4", "tests_pass", null, null],
  // R5
  ["r5.failure_modes", "R5", "tests_pass", null, 5],
  ["r5.followup_unread_share", "R5", "report_only", null, null],
  // R6a
  ["r6a.isolation_test_states", "R6a", "tests_pass", null, 3],
  ["r6a.continue_from_strings", "R6a", "count_equals", 0, null],
  ["r6a.first_load_script", "R6a", "floor", 0, null],
  ["r6a.first_load_style", "R6a", "floor", 0, null],
  // R6b
  ["r6b.new_pins_pass", "R6b", "tests_pass", null, null],
  ["r6b.old_pins_rewritten_red_first", "R6b", "tests_pass", null, null],
  ["r6b.reader_file_line", "R6b", "tests_pass", null, null],
  ["r6b.owner_read", "R6b", "tests_pass", null, null],
  // R7
  ["r7.component_tests", "R7", "tests_pass", null, 3],
  // R8
  ["r8.changed_on_controls", "R8", "rate_max", 0, 300],
  ["r8.anchors_kept", "R8", "rate_min", 0.98, null],
  ["r8.frame_removed", "R8", "rate_min", 0.8, null],
  ["r8.oracle_overlap_20_filler", "R8", "floor", 0.6, null],
  ["r8.messy_precision_10_paired", "R8", "paired_no_worse", null, 80],
  ["r8.messy_precision_10_target", "R8", "report_only", 0.6, null],
  ["r8.one_provider_lists", "R8", "report_only", 0.2, null],
  ["r8.no_relevant_top5", "R8", "report_only", 0.15, null],
  ["r8.note_kind_recall", "R8", "rate_min", 0.8, null],
  ["r8.note_kind_false", "R8", "rate_max", 0.01, 400],
  ["r8.decision_first_person_clause", "R8", "tests_pass", null, null],
  // R9
  ["r9.confident_wrong_lists", "R9", "rate_max", 0, null],
  ["r9.g6_landmarks_strong", "R9", "rate_min", 0.95, 20],
  ["r9.g6_landmarks_weak", "R9", "count_equals", 0, 20],
  ["r9.weak_tier_relevant", "R9", "rate_max", 0.05, null],
  ["r9.strong_tier_irrelevant", "R9", "rate_max", 0.1, null],
  ["r9.false_no_close_match", "R9", "rate_max", 0.05, null],
  // R10
  ["r10.non_research_caught", "R10", "rate_min", 0.9, 60],
  ["r10.research_wrongly_refused", "R10", "rate_max", 0.01, 400],
  // R11
  ["r11.scrubbed", "R11", "rate_min", 1, 40],
  ["r11.protected_changed", "R11", "rate_max", 0, 200],
  // R12 and R14
  ["r12.suggestion_right", "R12", "rate_min", 0.8, 40],
  ["r12.suggestion_wrong", "R12", "rate_max", 0.05, 40],
  ["r12.false_on_clean_controls", "R12", "rate_max", 0, 300],
  ["r12.false_on_protected_tokens", "R12", "rate_max", 0, null],
  ["r12.false_on_rare_valid_words", "R12", "rate_max", 0, 100],
  ["r12.doi_recall_after_repair", "R12", "floor", 0.85, null],
  ["r12.typo_precision_10_paired", "R12", "paired_no_worse", null, null],
  ["r12.typo_precision_10_target", "R12", "report_only", 0.6, null],
  ["r12.first_paper_p90", "R12", "floor", 2, null],
  ["r12.final_list_wait_p95", "R12", "floor", 3, null],
  ["r12.hard_cap", "R12", "floor", null, null],
  // R13
  ["r13.ids_exact", "R13", "rate_min", 1, 30],
  ["r13.non_ids", "R13", "rate_max", 0, 100],
  ["r13.p95_latency", "R13", "floor", 3, null],
  ["r13.lookup_calls", "R13", "floor", 2, null],
  // R15
  ["r15.cue_recall", "R15", "rate_min", 0.9, null],
  ["r15.false_cues", "R15", "rate_max", 0, 160],
  ["r15.c2_pastes", "R15", "tests_pass", null, 3],
  ["r15.want_to_read_to_search", "R15", "rate_min", 1, 10],
  ["r15.ideas_stay_ideas", "R15", "rate_min", 1, 10],
  // R16
  ["r16.year_phrases", "R16", "rate_min", 1, 40],
  ["r16.numbers_misread", "R16", "rate_max", 0, 100],
  // R17 (the 8.5 cell says "section 6.7": lines 620-625)
  ["r17.ask_rate_dev", "R17", "rate_max", 0.03, 400],
  ["r17.ask_rate_holdout", "R17", "report_only", null, 20],
  ["r17.ask_rate_production", "R17", "rate_max", 0.04, null],
  ["r17.ask_share_vs_dev_factor", "R17", "floor", 2, null],
  ["r17.ask_recall", "R17", "rate_min", 0.7, 30],
  ["r17.no_ask_with_cue", "R17", "rate_max", 0, 40],
  ["r17.introduction_fires", "R17", "rate_min", 0.8, 20],
  ["r17.introduction_false", "R17", "rate_max", 0.01, 400],
  ["r17.breaker_threshold", "R17", "report_only", 0.05, null],
  // R18
  ["r18.two_tab_violations", "R18", "count_equals", 0, 300],
  ["r18.fail_open_cases", "R18", "tests_pass", null, 5],
  ["r18.first_load_budget", "R18", "floor", 0, null],
  // R19
  ["r19.invariant_violations", "R19", "count_equals", 0, 80000],
  ["r19.fold_call_time", "R19", "floor", 1, null],
  ["r19.fold_equals_context_before", "R19", "tests_pass", null, null],
  // R20 and R21
  ["r20.blind_decisions_wrong", "R20", "rate_max", 0, 30],
  ["r20.model_resolver_agree", "R20", "rate_min", 0.95, null],
  ["r20.wrong_continue", "R20", "rate_max", 0.03, null],
  // R22
  ["r22.browser_suite", "R22", "tests_pass", null, 5],
  ["r22.first_load_budget", "R22", "floor", 0, null],
  // R23 (the 8.5 cell says "the E1 gates in 4.20": line 449)
  ["r23.e1_valid", "R23", "rate_min", 0.97, null],
  ["r23.e1_false_correction_clean", "R23", "rate_max", 0.02, null],
  ["r23.e1_false_correction_names_acronyms", "R23", "rate_max", 0, null],
  ["r23.e1_p95_latency", "R23", "floor", 2.5, null],
  ["r23.e1_extra_tokens", "R23", "floor", 1000, null],
  ["r23.e1_overlap_typo_filler", "R23", "floor", 0.7, null],
  // Always (and the shadow rule of 4.0, line 207)
  ["always.router_eval_203", "always", "floor", 0, 203],
  ["always.followup_read_trigger", "always", "report_only", 5, 113],
  ["always.followup_paired", "always", "paired_no_worse", 5, 113],
  ["always.g1_g6_prior_art", "always", "tests_pass", null, null],
  ["always.first_turn_golden", "always", "tests_pass", null, null],
  ["always.shadow_agreement", "always", "floor", 2, 300],
];

describe("the numbers, against a second transcription of the plan's table", () => {
  it("has exactly the gates the table lists, no more and no fewer", () => {
    expect(gates.map((g) => g.id).sort()).toEqual(EXPECTED.map((e) => e[0]).sort());
  });

  for (const [id, release, kind, threshold, nMin] of EXPECTED) {
    it(id, () => {
      const g = byId.get(id);
      expect(g, "missing " + id).toBeDefined();
      expect(g!.release).toBe(release);
      expect(g!.kind).toBe(kind);
      expect(g!.threshold).toBe(threshold);
      expect(g!.n_min).toBe(nMin);
    });
  }

  it("keeps the R4 recall sets in the order the plan names them: URGENT 40, CRISIS 40, HELP 15", () => {
    expect([byId.get("r4.urgent_recall")!.n_min, byId.get("r4.crisis_recall")!.n_min, byId.get("r4.help_recall")!.n_min]).toEqual([40, 40, 15]);
  });

  it("carries the floors the plan words as 'under', 'at most' and 'at least' with that direction", () => {
    const dir = (id: string) => byId.get(id)!.direction;
    expect(dir("r1.g5_floor")).toBe("at_least");
    expect(dir("r1.g6_floor")).toBe("at_least");
    expect(dir("r3.statements_per_message")).toBe("at_most");
    expect(dir("r4.long_message_read_time")).toBe("under"); // "in under 10 ms"
    expect(dir("r19.fold_call_time")).toBe("under"); // "under 1 ms a call"
    expect(dir("r6a.first_load_script")).toBe("under"); // "below their pre-release sizes"
    expect(dir("r6a.first_load_style")).toBe("under");
    expect(dir("r18.first_load_budget")).toBe("at_most"); // "unchanged or lower"
    expect(dir("r22.first_load_budget")).toBe("at_most");
    expect(dir("r13.lookup_calls")).toBe("at_most");
    expect(dir("r13.p95_latency")).toBe("at_most");
    expect(dir("r12.first_paper_p90")).toBe("at_most");
    expect(dir("r12.final_list_wait_p95")).toBe("at_most");
    expect(dir("r12.hard_cap")).toBe("under"); // "under the hard cap"
    expect(dir("r23.e1_p95_latency")).toBe("at_most");
    expect(dir("r23.e1_extra_tokens")).toBe("at_most");
    expect(dir("r23.e1_overlap_typo_filler")).toBe("at_least");
    expect(dir("r12.doi_recall_after_repair")).toBe("at_least");
    expect(dir("r8.oracle_overlap_20_filler")).toBe("at_least");
    expect(dir("always.router_eval_203")).toBe("at_least");
    expect(dir("always.shadow_agreement")).toBe("at_most");
    expect(dir("r17.ask_share_vs_dev_factor")).toBe("at_most");
  });

  it("states the relative floors against what they are relative to", () => {
    for (const id of ["r6a.first_load_script", "r6a.first_load_style", "r18.first_load_budget", "r22.first_load_budget", "r12.first_paper_p90", "always.router_eval_203"]) {
      expect(byId.get(id)!.relative_to, id).toBeTruthy();
    }
    expect(byId.get("r12.first_paper_p90")!.relative_to!.toLowerCase()).toContain("p90");
  });

  it("points every gate at a plan line in the part of the file it comes from", () => {
    const tableRows = gates.filter((g) => EXPECTED.some((e) => e[0] === g.id) && !g.id.startsWith("e0.") && !g.id.startsWith("h0.") && !g.id.startsWith("r17.") && !g.id.startsWith("r23.") && g.id !== "always.shadow_agreement");
    for (const g of tableRows) expect(g.source, g.id).toBeGreaterThanOrEqual(788);
    for (const g of tableRows) expect(g.source, g.id).toBeLessThanOrEqual(811);
    for (const g of gates.filter((x) => x.id.startsWith("r17."))) expect(g.source, g.id).toBeGreaterThanOrEqual(620);
    for (const g of gates.filter((x) => x.id.startsWith("r17."))) expect(g.source, g.id).toBeLessThanOrEqual(625);
    expect(byId.get("r23.e1_valid")!.source).toBe(449);
    expect(byId.get("always.shadow_agreement")!.source).toBe(207);
    expect(byId.get("e0.gates_committed_with_hash")!.source).toBe(250);
  });

  it("R1 row sits on line 788, R4 on 792, R8 on 797, R12 on 801, Always on 811", () => {
    expect(byId.get("r1.twin_first")!.source).toBe(788);
    expect(byId.get("r4.false_replies")!.source).toBe(792);
    expect(byId.get("r8.changed_on_controls")!.source).toBe(797);
    expect(byId.get("r12.suggestion_right")!.source).toBe(801);
    expect(byId.get("always.g1_g6_prior_art")!.source).toBe(811);
  });
});

/** An observation that meets the gate exactly, for any gate in the file. */
function perfect(g: Gate, n: number): Observed {
  switch (g.kind) {
    case "rate_max":
      return { k: 0, n };
    case "rate_min":
      return { k: n, n };
    case "paired_no_worse":
      return { worse: 0, better: 0, n };
    case "count_equals":
      return { count: g.threshold ?? 0, n };
    case "floor": {
      const reference = g.relative_to ? 100 : undefined;
      const limit = (reference ?? 0) + (g.threshold ?? 0);
      return { value: g.direction === "under" ? limit - 1 : limit, n, reference };
    }
    case "tests_pass":
      return { passed: n, failed: 0 };
    default:
      return { k: 0, n };
  }
}

describe("evaluateGate reads every gate in the file", () => {
  it("passes a perfect observation unless the owner has to decide first (and never throws)", () => {
    for (const g of gates) {
      const r = evaluateGate(g, perfect(g, g.n_min ?? 10));
      if (g.kind === "report_only") expect(r.status, g.id).toBe("report_only");
      else if (g.status === "needs_owner" || (g.threshold === null && g.kind !== "tests_pass")) expect(r.status, g.id).toBe("needs_owner");
      else expect(r.status, g.id).toBe("pass");
    }
  });

  it("never passes one case short of n_min", () => {
    for (const g of gates) {
      if (g.n_min === null || g.n_min < 2 || g.kind === "report_only") continue;
      const r = evaluateGate(g, perfect(g, g.n_min - 1));
      expect(r.status, g.id).not.toBe("pass");
      expect(["insufficient_n", "needs_owner"], g.id).toContain(r.status);
    }
  });

  it("fails an observation that is clearly over a limit", () => {
    for (const g of gates) {
      if (g.status === "needs_owner" || g.threshold === null) continue;
      const n = g.n_min ?? 10;
      let obs: Observed | null = null;
      if (g.kind === "rate_max") obs = { k: n, n };
      else if (g.kind === "rate_min") obs = { k: 0, n };
      else if (g.kind === "paired_no_worse") obs = { worse: g.threshold + 1, better: 0, n: Math.max(n, g.threshold + 1) };
      else if (g.kind === "count_equals") obs = { count: g.threshold + 1, n };
      else if (g.kind === "tests_pass") obs = { passed: n, failed: 1 };
      else if (g.kind === "floor") {
        const reference = g.relative_to ? 100 : undefined;
        const limit = (reference ?? 0) + g.threshold;
        obs = { value: g.direction === "at_least" ? limit - 1 : limit + 1, n, reference };
      }
      if (obs === null) continue;
      const r = evaluateGate(g, obs);
      expect(r.status, g.id).toBe("fail");
    }
  });

  it("reads the plan's own sign-test vectors through the Always gate (needs the owner, but reports p)", () => {
    const g = byId.get("always.followup_paired")!;
    expect(g.status).toBe("needs_owner");
    const r = evaluateGate(g, { worse: 6, better: 0, n: 113 });
    expect(r.status).toBe("needs_owner");
    expect(r.p!.toFixed(3)).toBe("0.016");
    expect(evaluateGate(g, { worse: 6, better: 1, n: 113 }).p!.toFixed(3)).toBe("0.063");
    expect(evaluateGate(g, { worse: 5, better: 1, n: 113 }).p!.toFixed(3)).toBe("0.109");
  });

  it("reads the R4 false-reply gate as the plan does: 0 of 260 passes with an upper bound of about 1.2%", () => {
    const g = byId.get("r4.false_replies")!;
    const r = evaluateGate(g, { k: 0, n: 260 });
    expect(r.status).toBe("pass");
    expect(r.bound!.value).toBeGreaterThan(0.011);
    expect(r.bound!.value).toBeLessThan(0.012);
    expect(evaluateGate(g, { k: 1, n: 260 }).status).toBe("fail");
    expect(evaluateGate(g, { k: 0, n: 100 }).status).toBe("insufficient_n");
  });
});

describe("the hash script", () => {
  const LF = String.fromCharCode(10);
  const CR = String.fromCharCode(13);
  const run = (args: string[] = []) => execFileSync(process.execPath, [HASH_SCRIPT, ...args], { encoding: "utf8" });
  const hashOf = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
  const dirs: string[] = [];
  const scratch = () => {
    const d = mkdtempSync(tmpdir() + "/gates-hash-");
    dirs.push(d);
    return d;
  };
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it("prints the SHA-256 of the canonical form and nothing else", () => {
    const out = run();
    expect(out.length).toBe(65);
    expect(out.endsWith(LF)).toBe(true);
    for (const ch of out.slice(0, 64)) expect("0123456789abcdef".includes(ch)).toBe(true);
    expect(out.slice(0, 64)).toBe(hashOf(canonicalFromText(text)));
  });

  it("is the same for a CRLF copy and an indented-differently copy of the file", () => {
    const dir = scratch();
    const crlf = dir + "/crlf.json";
    writeFileSync(crlf, text.split(CR + LF).join(LF).split(LF).join(CR + LF));
    const compact = dir + "/compact.json";
    writeFileSync(compact, JSON.stringify(doc));
    expect(run([crlf])).toBe(run());
    expect(run([compact])).toBe(run());
  });

  it("changes when one number changes", () => {
    const dir = scratch();
    const changed = JSON.parse(text);
    changed.gates[0].note = changed.gates[0].note + " ";
    const f = dir + "/changed.json";
    writeFileSync(f, JSON.stringify(changed));
    expect(run([f])).not.toBe(run());
    const t = JSON.parse(text);
    const g = t.gates.find((x: Gate) => x.id === "r4.false_replies");
    g.n_min = 259;
    const f2 = dir + "/changed2.json";
    writeFileSync(f2, JSON.stringify(t));
    expect(run([f2])).not.toBe(run());
  });

  it("--verbose says more (the path, the gate count, whether it is frozen) and still starts with the hash", () => {
    const out = run(["--verbose"]);
    expect(out.startsWith(run())).toBe(true);
    expect(out.length).toBeGreaterThan(65);
    expect(out).toContain("gates: " + gates.length);
    expect(out).toContain("frozen: " + doc.frozen);
  });

  // The plan says "the file's SHA-256" in the commit message. The script hashes the canonical form (sorted keys, fixed indent), which is not what sha256sum gives for the file: say so where a reader looks.
  it("says in --verbose, and in the gate that asks for it, that the hash is of the canonical form and not of the file's bytes", () => {
    const out = run(["--verbose"]);
    expect(out).toContain("canonical SHA-256");
    expect(out).toMatch(/sha256sum/);
    const note = byId.get("e0.gates_committed_with_hash")!.note;
    expect(note).toContain("canonical");
    expect(note).toContain("intent-gates-hash.mjs");
    expect(note).toMatch(/sha256sum|file's bytes/);
  });
});
