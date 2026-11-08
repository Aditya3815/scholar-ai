// The scorer of the Understand eval (docs/eval/understand/GUIDE.md): pure functions over the label files and the decisions `understandTurn` made. No model, no network.
import { readLedger, type LedgerTurn } from "../../src/understand/ledger-input";
import type { UnderstandDecision } from "../../src/understand/understand";
import type { UnderstandIntent } from "../../src/understand/understanding";

export type Label = {
  intent: UnderstandIntent;
  also?: UnderstandIntent[];
  search?: boolean;
  language?: "en" | "hi" | "hinglish";
  year_from?: number;
  year_to?: number;
  indian_sources?: boolean;
  tool?: "verify" | "idea" | "litscan";
  papers?: number[];
  guard?: "greeting" | "identifier" | "reference_list";
  leakWords?: string[];
  newTopicBefore?: boolean;
};
export type SingleItem = { id: string; group: string; text: string; labeller_1: Label; labeller_2: Label | null };
export type MultiTurn = { turn: number; user: string; labeller_1: Label; labeller_2: Label | null; ledger: unknown };
export type MultiChat = { id: string; note: string; turns: MultiTurn[] };
export type ChatItem = { id: string; message: string; language: "en" | "hi" | "hinglish"; kind: string; labeller_1: { intent: "chat" }; labeller_2: { intent: string } | null };

/** The label that counts, or null when the second labeller disagrees on the intent (the item is dropped, as the design asks). */
export function agreedLabel(l1: Label, l2: Label | null): Label | null {
  if (!l2) return l1;
  return l2.intent === l1.intent ? l1 : null;
}

export const intentOk = (label: Label, got: UnderstandIntent | null | undefined): boolean => !!got && (got === label.intent || (label.also ?? []).includes(got));

/** Field checks beyond the intent, applied only when the label states the field and the predicted intent is the labelled one. Each failure is named. */
export function fieldMisses(label: Label, d: UnderstandDecision): string[] {
  const u = d.understanding;
  if (!u || u.intent !== label.intent) return [];
  const miss: string[] = [];
  if (label.year_from !== undefined && u.search?.year_from !== label.year_from) miss.push("year_from");
  if (label.year_to !== undefined && u.search?.year_to !== label.year_to) miss.push("year_to");
  if (label.indian_sources !== undefined && u.search?.indian_sources !== label.indian_sources) miss.push("indian_sources");
  if (label.tool !== undefined && u.tool !== label.tool) miss.push("tool");
  if (label.language !== undefined && u.language !== label.language) miss.push("language");
  if (label.papers !== undefined) {
    const got = [...(u.refers_to?.papers ?? [])].sort().join(",");
    if (got !== [...label.papers].sort().join(",")) miss.push("papers");
  }
  return miss;
}

export const isSearch = (d: UnderstandDecision): boolean => d.understanding?.intent === "search" || d.understanding?.intent === "refine_search";

/** Words of an earlier topic in what this turn would search or hand to the writer. */
export function leaks(label: Label, d: UnderstandDecision): string[] {
  const words = label.leakWords ?? [];
  if (!words.length || !d.understanding) return [];
  const text = [d.understanding.standalone, ...(d.understanding.search?.queries ?? [])].join(" ").toLowerCase();
  return words.filter((w) => new RegExp(`\\b${w.toLowerCase()}`).test(text));
}

/** The gold ledger a multi-turn chat's turn k is read with: the ledgers of the turns before it, from the last New topic on. */
export function goldLedger(chat: MultiChat, index: number): LedgerTurn[] {
  let start = 0;
  for (let i = 0; i <= index; i++) if (chat.turns[i]!.labeller_1.newTopicBefore) start = i;
  const raw = chat.turns.slice(start, index).map((t) => t.ledger).filter(Boolean);
  const r = readLedger(raw);
  if (!r.ok) throw new Error(`${chat.id} turn ${index + 1}: gold ledger does not read: ${r.detail}`);
  return r.turns;
}

export const percentile = (xs: number[], p: number): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
};

/** The gates of the design (page 14), as numbers. Frozen with the sets; only the owner loosens one, in writing. */
export const UNDERSTAND_GATES = {
  singleIntentAccuracyAbove: 0.95,
  greetingSearchesMax: 0,
  multiTurnAccuracyMin: 0.9,
  newTopicLeaksMax: 0,
  chatLeaksMax: 0,
  latencyP50MsBelow: 1200,
  latencyP95MsBelow: 2500,
} as const;
