/**
 * The Thinking block (design PDF "Sodhsetu understanding, follow-ups and MCP", section "Thinking dikhana", milestone M2): status lines built by the server from what each stage really did, never a model's
 * chain of thought. One SSE event, `think`; the same `id` again replaces that line ("3 of 5 sources" becomes "5 of 5 sources"). Sent only while the Worker variable CHAT_THINK is "on" (off when unset);
 * with it off the stream is byte for byte what it was.
 *
 * Honesty rules, held by tests (apps/api/src/chat/think.test.ts, think-route.test.ts):
 *  - every number in a line's text is one of the values in its `counts` (the person's own words and the search words, which can hold a year, are always inside “ ” quotes and are not counted as the
 *    line's numbers: `thinkNumbers` reads only what is outside them);
 *  - a line says only what happened: "reading" is sent only when the reader stage really runs, "checked" only when the judge gave verdicts;
 *  - only the `understood` line carries words that a model may have written (the restated question); the page labels it "I understood";
 *  - no think line is written to a log.
 */
export const THINK_KINDS = ["understood", "searched", "found", "reading", "writing", "checked", "note"] as const;
export type ThinkKind = (typeof THINK_KINDS)[number];
export const THINK_ACTIONS = ["change", "exact_words"] as const;
export type ThinkAction = (typeof THINK_ACTIONS)[number];
export type ThinkLine = { id: string; kind: ThinkKind; text: string; counts?: Record<string, number>; actions?: ThinkAction[] };
/** The most lines a reply keeps (a stream that sent more is a bug; the rest are dropped). */
export const MAX_THINK_LINES = 20;

/** The text of a line outside its “ ” quotes: what the honesty rule reads. */
export const outsideQuotes = (text: string): string => text.replace(/“[^”]*”/g, "“”");
/** The numbers a line states (outside its quotes), as written: "1,234" is 1234. */
export function thinkNumbers(text: string): number[] {
  return [...outsideQuotes(text).matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => Number(m[0].replace(/,/g, "")));
}
/** Whether every number a line states is one of its counts (the honesty rule). */
export function thinkIsHonest(line: Pick<ThinkLine, "text" | "counts">): boolean {
  const have = new Set(Object.values(line.counts ?? {}));
  return thinkNumbers(line.text).every((n) => have.has(n));
}

/** A line applied to the lines a reply has: the same id replaces its line in place, a new id is added at the end; at most `MAX_THINK_LINES`. Pure. */
export function withThinkLine(lines: readonly ThinkLine[] | undefined, e: ThinkLine): ThinkLine[] {
  const now = lines ?? [];
  const line: ThinkLine = { id: e.id, kind: e.kind, text: e.text, ...(e.counts ? { counts: e.counts } : {}), ...(e.actions && e.actions.length ? { actions: e.actions } : {}) };
  const at = now.findIndex((l) => l.id === e.id);
  if (at >= 0) return now.map((l, i) => (i === at ? line : l));
  return now.length >= MAX_THINK_LINES ? [...now] : [...now, line];
}

/** The one line a finished block is folded into: "Thought for 14 s · 2 searches · 20 papers". Its numbers come from the reply itself (its time, its searched lines, the papers it lists). */
export function thinkSummary(o: { tookMs?: number; lines: readonly ThinkLine[]; papers: number }): string {
  const s = typeof o.tookMs === "number" && o.tookMs >= 0 ? Math.max(1, Math.round(o.tookMs / 1000)) : null;
  const searches = o.lines.filter((l) => l.kind === "searched").reduce((n, l) => n + (l.counts?.queries ?? 1), 0);
  const parts = [s === null ? "Thought" : `Thought for ${s} s`];
  if (searches > 0) parts.push(`${searches} ${searches === 1 ? "search" : "searches"}`);
  if (searches > 0) parts.push(`${o.papers} ${o.papers === 1 ? "paper" : "papers"}`);
  return parts.join(" · ");
}
