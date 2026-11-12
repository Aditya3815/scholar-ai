import type { Answer, AskStage } from "./documents";
import type { OaAskEvent, OaIngestEvent, OaPaperEvent } from "./oa";
import type { RefVerdict } from "./references";

/**
 * Tools run IN the conversation (CHAT_TOOLS "on", docs/design/chat-tools.md). The owner's rule (9 Nov 2026), "sasta tool khud, mehenga pooche":
 * - run in the reply, with no click:
 *   - a pasted list of references, checked at Crossref and OpenAlex (no AI);
 *   - DOIs with a word that asks about retraction, checked at Crossref;
 *   - a question about ONE paper of the chat's results, answered from its full text by "Ask this paper";
 *   - a question about ONE of the person's own uploaded papers, answered by the paper's own ask.
 * - still one click, a card as before: Idea Check and the literature scan.
 *
 * The server sends the events below only with the switch on. A page that does not know them keeps the reply as it was (`applyChatEvent`'s default).
 */
export const CHAT_TOOL_KINDS = ["verify", "retractions", "ask_paper", "ask_doc"] as const;

/** One reference of a list checked in the chat: the verdict the Check references page would give, or why there is none (never a verdict made up for it). */
export type ChatRefItem = { n: number; input: string; verdict: RefVerdict | null; error?: string };
export type ChatRetraction = { doi: string; status: "retracted" | "not_retracted" | "unknown"; notices: string[] };
/** The paper a question is about: a result of the chat (DOI or arXiv number) or one of the person's own papers (only its title is sent: its id stays on the server). */
export type ChatToolPaper = { title: string | null; doi?: string; arxivId?: string };
/** A question about one paper as it is answered: the same steps as "Ask this paper" (reading, what the answer is made from, the stages, the words so far, the checked answer). */
export type ChatAskState = {
  ingest: OaIngestEvent | null;
  paper: OaPaperEvent | null;
  stage: AskStage | null;
  pages: number[];
  /** the words so far: provisional, never kept */
  live: string;
  answer: Answer | null;
  error: { code: string; title: string; detail?: string } | null;
};

export type ChatToolResult =
  | { kind: "verify"; total: number; skipped: number; items: ChatRefItem[] }
  | { kind: "retractions"; dois: number; checked: ChatRetraction[]; invalid: string[]; final: boolean }
  | { kind: "ask_paper" | "ask_doc"; paper: ChatToolPaper; question: string; ask: ChatAskState };

export type ChatToolEvent =
  /** A tool starts: what it will do (how many references, how many DOIs, which paper and which question). */
  | { type: "tool"; tool: "verify"; total: number; skipped: number }
  | { type: "tool"; tool: "retractions"; dois: number }
  | { type: "tool"; tool: "ask_paper" | "ask_doc"; paper: ChatToolPaper; question: string }
  /** One reference's verdict, as it arrives (the list keeps the order of the paste). */
  | { type: "tool_ref"; item: ChatRefItem }
  | { type: "tool_retractions"; checked: ChatRetraction[]; invalid: string[] }
  /** One event of the paper's answer, exactly as the "Ask this paper" stream sends it. */
  | { type: "tool_ask"; event: OaAskEvent };

const emptyAsk = (): ChatAskState => ({ ingest: null, paper: null, stage: null, pages: [], live: "", answer: null, error: null });

/** One tool event applied to a reply's tool. Pure. An event that does not fit the tool that started (or comes before any started) changes nothing. */
export function applyToolEvent(t: ChatToolResult | undefined, e: ChatToolEvent): ChatToolResult | undefined {
  switch (e.type) {
    case "tool":
      if (e.tool === "verify") return { kind: "verify", total: e.total, skipped: e.skipped, items: [] };
      if (e.tool === "retractions") return { kind: "retractions", dois: e.dois, checked: [], invalid: [], final: false };
      return { kind: e.tool, paper: e.paper, question: e.question, ask: emptyAsk() };
    case "tool_ref": {
      if (t?.kind !== "verify") return t;
      const items = [...t.items.filter((i) => i.n !== e.item.n), e.item].sort((a, b) => a.n - b.n);
      return { ...t, items };
    }
    case "tool_retractions":
      return t?.kind === "retractions" ? { ...t, checked: e.checked, invalid: e.invalid, final: true } : t;
    case "tool_ask": {
      if (t?.kind !== "ask_paper" && t?.kind !== "ask_doc") return t;
      const a = t.ask;
      if (a.answer || a.error) return t;
      const x = e.event;
      const ask: ChatAskState =
        x.type === "ingest" ? { ...a, ingest: x }
        : x.type === "paper" ? { ...a, paper: x }
        : x.type === "stage" ? { ...a, stage: x.stage }
        : x.type === "sources" ? { ...a, pages: x.pages }
        : x.type === "delta" ? { ...a, live: a.live + x.text }
        : x.type === "answer" ? { ...a, answer: x.answer, live: "", stage: null }
        : { ...a, live: "", stage: null, error: { code: x.code, title: x.title, ...(x.detail ? { detail: x.detail } : {}) } };
      return { ...t, ask };
    }
  }
}

/** A tool's result as it is kept with the reply: nothing provisional. */
export function toolForStorage(t: ChatToolResult): ChatToolResult {
  if (t.kind === "ask_paper" || t.kind === "ask_doc") return { ...t, ask: { ...t.ask, live: "", stage: null } };
  return t;
}

/** What a verify run came to, for the summary line and the Thinking block: the four buckets of the Check references page. */
export function refTally(items: readonly ChatRefItem[]): { verified: number; mismatch: number; notFound: number; unchecked: number } {
  let verified = 0;
  let mismatch = 0;
  let notFound = 0;
  let unchecked = 0;
  for (const i of items) {
    const s = i.verdict?.status;
    if (s === "verified") verified++;
    else if (s === "mismatch") mismatch++;
    else if (s === "not_found") notFound++;
    else unchecked++;
  }
  return { verified, mismatch, notFound, unchecked };
}
