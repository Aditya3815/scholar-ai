import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { outcomeTotal } from "@scholar/shared";
import { FOLLOW_UP_OUTCOMES, OUTCOME_FEATURES, UNREAD_OUTCOMES } from "./outcomes";
import { INPUT_SHAPE_NAMES, SUBJECT_NAMES } from "./understand/input-shape";

/**
 * /admin tells the owner what the counts are (apps/web/src/components/admin/AdminOps.tsx). The page is a React file this workspace does not render, so this reads it as source, as legal-text.test.ts
 * reads the privacy page: every name that the code can count has one plain label there, the label of a name is never the name itself, and a label for a name nothing can count is a leftover.
 * (docs/design/intent-and-state.md, 4.4: "AdminOps.tsx OUTCOME_TEXT gets one plain label per name".)
 */
const SOURCE = readFileSync(fileURLToPath(new URL("../../web/src/components/admin/AdminOps.tsx", import.meta.url)), "utf8");

/** The entries of `const NAME: Record<string, string> = { key: "text", ... };` (a key per line, a double-quoted text, no escapes in it). */
function table(name: string): Record<string, string> {
  const start = SOURCE.indexOf(`const ${name}: Record<string, string> = {`);
  if (start < 0) throw new Error(`no table ${name} in AdminOps.tsx`);
  const body = SOURCE.slice(SOURCE.indexOf("{", start) + 1, SOURCE.indexOf("\n};", start));
  const out: Record<string, string> = {};
  for (const line of body.split("\n")) {
    const m = /^\s*([a-z][a-z_0-9]*):\s*"([^"\\]*)",?\s*$/.exec(line);
    if (m) {
      if (m[1]! in out) throw new Error(`${name}: ${m[1]} is there twice`);
      out[m[1]!] = m[2]!;
    }
  }
  return out;
}

const OUTCOME_TEXT = table("OUTCOME_TEXT");
const INPUT_TEXT = table("INPUT_TEXT");
const FEATURE_NAME = table("FEATURE_NAME");

const plainly = (label: string) => {
  expect(label.trim(), label).toBe(label);
  expect(label.length, label).toBeGreaterThanOrEqual(8);
  expect(label.length, label).toBeLessThanOrEqual(200);
  expect(label, label).toMatch(/^[A-Z]/);
  expect(label, label).not.toMatch(/_/);
  expect(label, label).not.toMatch(/TODO|undefined|null/);
};

describe("the labels of /admin", () => {
  it("every name of the shape of a message has one plain label, and there is none for a name the list does not have", () => {
    for (const name of INPUT_SHAPE_NAMES) {
      expect(INPUT_TEXT[name], `no label for ${name}`).toBeTypeOf("string");
      plainly(INPUT_TEXT[name]!);
    }
    expect(Object.keys(INPUT_TEXT).sort()).toEqual([...INPUT_SHAPE_NAMES].sort());
    // two names that read the same would be two rows nobody can tell apart
    expect(new Set(Object.values(INPUT_TEXT)).size).toBe(INPUT_SHAPE_NAMES.length);
  });

  it("every follow-up outcome name has one plain label, the two of the failure policy included", () => {
    for (const name of [...Object.values(FOLLOW_UP_OUTCOMES), ...Object.values(UNREAD_OUTCOMES)]) {
      expect(OUTCOME_TEXT[name], `no label for ${name}`).toBeTypeOf("string");
      plainly(OUTCOME_TEXT[name]!);
    }
    expect(OUTCOME_TEXT.followup_unread).toMatch(/no answer was written/);
    expect(OUTCOME_TEXT.followup_unread_shadow).toMatch(/answer was written as before/);
  });

  it("the three endings of the safety lane (urgent, safety, decision: the reasons of ChatNoAnswer) have a plain label of their own in the table of the prompt box, and so does what it would have done (would_*)", () => {
    for (const name of ["urgent", "safety", "decision"]) {
      expect(OUTCOME_TEXT[name], `no label for ${name}`).toBeTypeOf("string");
      plainly(OUTCOME_TEXT[name]!);
    }
    for (const name of INPUT_SHAPE_NAMES.filter((n) => n.startsWith("would_"))) expect(INPUT_TEXT[name], name).toMatch(/not yet acted on/);
    for (const name of INPUT_SHAPE_NAMES.filter((n) => n.startsWith("lane_"))) expect(INPUT_TEXT[name], name).toMatch(/^[A-Z]/);
  });

  it("the shape of messages has a caption of its own, like every feature that is counted, and the caption says what the share is of", () => {
    for (const f of OUTCOME_FEATURES) expect(FEATURE_NAME[f], `no caption for ${f}`).toBeTypeOf("string");
    expect(FEATURE_NAME.chat_input).toMatch(/messages counted/);
  });

  it("the page reads the labels of the shape of messages from their own table, so that a name of one feature can never take the words of another's", () => {
    expect(SOURCE).toMatch(/f === "chat_input" \? INPUT_TEXT : OUTCOME_TEXT/);
  });
});

describe("the share of a name is of the messages counted (not of the sum of all names, which is a message several times over)", () => {
  const rows = [
    { outcome: "subj0", n: 10 },
    { outcome: "subj1", n: 20 },
    { outcome: "subj2_6", n: 60 },
    { outcome: "subj7p", n: 10 },
    { outcome: "frame", n: 40 },
    { outcome: "year", n: 5 },
    { outcome: "one_source", n: 30 },
  ];
  it("for chat_input the total is the four subject counts, which add up to the messages counted", () => {
    expect(SUBJECT_NAMES).toEqual(["subj0", "subj1", "subj2_6", "subj7p"]);
    expect(outcomeTotal("chat_input", rows)).toBe(100);
  });
  it("for any other feature it is the sum of the rows, as it was", () => {
    expect(outcomeTotal("chat", [{ outcome: "answered", n: 3 }, { outcome: "not_grounded", n: 1 }])).toBe(4);
    expect(outcomeTotal("oa_ask", [])).toBe(0);
  });
  it("for chat_input with no subject count (only `anyway` so far) it is 0, and the page then shows no share", () => {
    expect(outcomeTotal("chat_input", [{ outcome: "anyway", n: 4 }])).toBe(0);
    expect(SOURCE).toMatch(/total > 0/);
  });
});
