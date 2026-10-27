import type { ChatEvent } from "./chat";
import type { AskStreamEvent } from "./documents";
import type { IdeaCompareEvent, IdeaInsightsEvent, IdeaSearchEvent } from "./idea";
import type { OaAskEvent } from "./oa";

/**
 * The rule for every stream the server sends (docs/design/research-patterns.md, section 1): **progress and text are different event types.**
 *
 *   progress   says that work is moving: a step, a stage, a reading that is half done. It never carries the words of an answer.
 *   text       the words of an answer as they are written (provisional; the result event that follows replaces them). It carries nothing but the words.
 *   result     something the work produced (the papers, the checked answer, the final result). A result can end a stream or be followed by more events.
 *   meta       what the stream is about (what the message was taken to be, which paper is being read, which pages are used).
 *   notice     a plain sentence for the person (some sources did not answer).
 *   end        the one event that closes a stream; exactly one is sent and it is last.
 *
 * Every event type of every stream is classified below. The tables are typed against the event unions, so adding an event type without saying what it is does not compile.
 * \`streamShapeProblems\` checks a recorded stream against the rule (the endpoint tests run it on every stream they read; the unit tests run it on made-up streams, good and bad).
 * This file imports types only and uses no TypeScript that Node cannot strip, so the test scripts can load it as it is.
 */
export type EventKind = "progress" | "text" | "result" | "meta" | "notice" | "end";
export type StreamName = "chat" | "ask" | "idea";

type Spec = {
  kinds: Record<string, EventKind>;
  /** the event types that close the stream: exactly one, and last */
  end: string[];
  /** a text event type, and the final event that replaces what it wrote (nothing of that text may come after the final one) */
  replaced: Record<string, string>;
  /** the only fields a progress event may have (it must not carry words) */
  progressFields: Record<string, string[]>;
};

const CHAT: Record<ChatEvent["type"], EventKind> = {
  understood: "meta",
  step: "progress",
  papers: "result",
  notice: "notice",
  token: "text",
  answer: "result",
  general_token: "text",
  general: "result",
  done: "end",
  error: "end",
};

const ASK: Record<OaAskEvent["type"], EventKind> = {
  stage: "progress",
  ingest: "progress",
  sources: "meta",
  paper: "meta",
  delta: "text",
  answer: "end", // a question about a paper has no separate "done": the checked answer, or an error, closes the stream
  error: "end",
};

const IDEA: Record<(IdeaSearchEvent | IdeaCompareEvent | IdeaInsightsEvent)["type"], EventKind> = {
  stage: "progress",
  papers: "result",
  done: "end",
  error: "end",
};

export const STREAMS: Record<StreamName, Spec> = {
  chat: { kinds: CHAT, end: ["done", "error"], replaced: { token: "answer", general_token: "general" }, progressFields: { step: ["type", "step"] } },
  ask: { kinds: ASK, end: ["answer", "error"], replaced: { delta: "answer" }, progressFields: { stage: ["type", "stage"], ingest: ["type", "status", "progress", "source", "started"] } },
  idea: { kinds: IDEA, end: ["done", "error"], replaced: {}, progressFields: { stage: ["type", "stage"] } },
};

type Ev = { type?: unknown; [k: string]: unknown };

/** What is wrong with a recorded stream, one plain sentence each; an empty list means it follows the rule. */
export function streamShapeProblems(stream: StreamName, events: readonly Ev[]): string[] {
  const spec = STREAMS[stream];
  const out: string[] = [];
  let ends = 0;
  let lastIngest = -1;
  const finalSeen = new Set<string>();
  events.forEach((e, i) => {
    const type = typeof e.type === "string" ? e.type : "";
    const kind = Object.hasOwn(spec.kinds, type) ? spec.kinds[type] : undefined; // not the properties every object has ("constructor")
    const at = `event ${i + 1} (${type || "no type"})`;
    if (!kind) return void out.push(`${at}: not a known event of the ${stream} stream`);
    if (ends > 0) out.push(`${at}: comes after the end of the stream`);
    if (kind === "end") {
      ends++;
      if (i !== events.length - 1) out.push(`${at}: ends the stream but is not the last event`);
    }
    if (kind === "progress") {
      const allowed = spec.progressFields[type] ?? ["type"];
      const extra = Object.keys(e).filter((k) => !allowed.includes(k));
      if (extra.length) out.push(`${at}: a progress event may carry only ${allowed.join(", ")}, not ${extra.join(", ")} (words belong in a text event)`);
      if (type === "ingest") {
        const p = e.progress;
        if (typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 1) out.push(`${at}: progress must be a number from 0 to 1`);
        else {
          if (p + 1e-9 < lastIngest) out.push(`${at}: progress went back (${p} after ${lastIngest})`);
          lastIngest = Math.max(lastIngest, p);
        }
      }
    }
    if (kind === "text") {
      const extra = Object.keys(e).filter((k) => k !== "type" && k !== "text");
      if (typeof e.text !== "string" || e.text.length === 0) out.push(`${at}: a text event must carry some words in \`text\``);
      if (extra.length) out.push(`${at}: a text event carries only its words, not ${extra.join(", ")}`);
      const final = spec.replaced[type];
      if (final && finalSeen.has(final)) out.push(`${at}: more words after the final \`${final}\` that replaces them`);
    }
    if (Object.values(spec.replaced).includes(type)) finalSeen.add(type);
  });
  if (events.length === 0) out.push("the stream is empty");
  else if (ends === 0) out.push(`the stream has no end event (${spec.end.join(" or ")})`);
  else if (ends > 1) out.push(`the stream has ${ends} end events; it must have exactly one`);
  return out;
}
