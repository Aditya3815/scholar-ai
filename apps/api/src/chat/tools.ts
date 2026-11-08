import { MAX_QUESTION_CHARS, MAX_REFERENCES, MAX_REFERENCE_CHARS, cleanDoi, looksLikeReference, looksLikeReferenceList, oaKey, refFromPaper, refTally, splitReferences, type Answer, type AskStreamEvent, type ChatEvent, type ChatRefItem, type ChatRetraction, type Lang, type OaAskEvent, type OaRef, type Paper, type RefVerdict, type RouteMode } from "@scholar/shared";

/**
 * Tools run IN the conversation (CHAT_TOOLS "on"; docs/design/chat-tools.md). The owner's rule (9 Nov 2026): "sasta tool khud, mehenga pooche".
 * - Run here, with no click:
 *   - a pasted list of references, checked at Crossref and OpenAlex (no AI);
 *   - DOIs with a word that asks about a retraction, checked at Crossref;
 *   - a question about ONE paper of the chat's results, answered from its full text ("Ask this paper": a signed-in person, 20 new papers a day);
 *   - a question about ONE of the person's own uploaded papers, answered by that paper's own ask.
 * - Still a card, one click away (nothing here): Idea Check and the literature scan.
 *
 * How the tool is chosen: by what already decides a message, so that it works with the Understand step off.
 * - The rules: a pasted list and DOIs.
 * - The private router for a signed-in person: Check references, Ask a paper.
 * - The Understand step when it is on: ask_results about one paper, ask_paper, offer_tool verify.
 * No model is asked to call a function. The tool is run by the same service functions the page and the MCP server call (references/service.ts, search/retraction-service.ts,
 * oa/service.ts, docs/qa.ts), never through the MCP protocol.
 *
 * A search chosen by hand never reaches this file: only Auto does.
 */

/** A word that asks about a retraction: English, Hinglish, Hindi. */
export const RETRACT_CUE = /\b(?:retract(?:ed|ion|ions)?|withdrawn|withdrawal)\b|वापस\s*लि(?:या|ये|ए)|रिट्रैक्ट/i;
/** DOIs inside any text (a .bib file, a list, a sentence). Trailing punctuation is not part of a DOI. */
const DOI_IN_TEXT = /\b10\.\d{4,9}\/[^\s"'<>{}]+/gi;
/** The most DOIs one message checks (the MCP tool's limit). */
export const MAX_CHAT_RETRACTION_DOIS = 200;

export type ToolPlan =
  | { kind: "verify"; refs: string[]; skipped: number }
  | { kind: "retractions"; dois: string[] }
  | { kind: "ask_paper"; paper: Paper; ref: OaRef; key: string; question: string }
  | { kind: "ask_doc"; question: string };

/** The mode the `understood` event says for a tool that runs: Check references for the two checks, Ask a paper for the two questions. */
export const modeOfPlan = (p: ToolPlan): RouteMode => (p.kind === "verify" || p.kind === "retractions" ? "verify" : "paper");

/** The DOIs of a text, in order, each once (lower case). */
export function doisIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(DOI_IN_TEXT)) {
    // a DOI at the end of a sentence or a question: the stop, the question mark and a closing bracket are the sentence's
    const d = cleanDoi(m[0].replace(/[.,;:!?)\]]+$/, ""));
    if (d && !out.includes(d)) out.push(d);
  }
  return out;
}

export type PlanInput = {
  /** The message as written (Auto). */
  text: string;
  /** What the rules, the router or the Understand step decided. */
  mode: RouteMode;
  /** The Understand step's intent, when it decided. */
  intent: string | null;
  /** M5: the papers of the chat a question is about, looked up again by DOI (ask_results). */
  preset: Paper[] | null;
  /** The question as it stands alone (the Understand step's `standalone`, else the message). */
  question: string;
  signedIn: boolean;
};

/**
 * Which tool runs, or null: the card, the search or the answer from abstracts stays exactly what it was. Pure.
 * - A list of references: only when the text looks like one (three entries or more), or is one or two entries that each look like a reference. A request with no list ("check my references")
 *   keeps the card, whose page takes the list.
 * - Retractions: DOIs, and a word that asks about a retraction. A list of references that asks it is checked as references (each verdict marks a retraction too).
 * - A question about one paper of the results: signed in (Ask this paper needs it), exactly one paper, with a DOI or arXiv number. A visitor keeps the answer from the abstracts.
 * - The person's own paper: signed in; which paper is decided where the papers are (`pickDoc`).
 */
export function planTool(p: PlanInput): ToolPlan | null {
  const question = p.question.replace(/\s+/g, " ").trim().slice(0, MAX_QUESTION_CHARS);
  const list = looksLikeReferenceList(p.text);
  if (!list && RETRACT_CUE.test(p.text)) {
    const dois = doisIn(p.text);
    if (dois.length > 0) return { kind: "retractions", dois: dois.slice(0, MAX_CHAT_RETRACTION_DOIS) };
  }
  if (p.mode === "verify") {
    const entries = splitReferences(p.text);
    const ok = list || (entries.length >= 1 && entries.length <= 2 && entries.every(looksLikeReference));
    if (!ok) return null;
    return { kind: "verify", refs: entries.slice(0, MAX_REFERENCES), skipped: Math.max(0, entries.length - MAX_REFERENCES) };
  }
  if (p.intent === "ask_results" && p.preset?.length === 1 && p.signedIn && question.length >= 3) {
    const paper = p.preset[0]!;
    const ref = refFromPaper(paper);
    const key = ref && oaKey(ref);
    if (ref && key) return { kind: "ask_paper", paper, ref, key, question };
  }
  if (p.mode === "paper" && p.signedIn && question.length >= 3) return { kind: "ask_doc", question };
  return null;
}

/** Words that say nothing about which paper (so they never pick one). */
const NOT_A_TITLE_WORD = new Set("about paper papers what does this that which with from into have their there they your mine my the and for are was were how why when where uploaded upload pdf workspace mera meri mere kya hai hain mein main ka ki ke ko".split(" "));
const words = (s: string) => [...new Set(s.toLowerCase().normalize("NFKC").split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4 && !NOT_A_TITLE_WORD.has(w)))];

/**
 * Which of the person's own papers a question is about: the only one that is ready, or the one whose title shares the most words with the question (two at least, and more than any other).
 * Null when it cannot be told: the card stays, and its page lets the person choose.
 */
export function pickDoc(question: string, docs: readonly { id: string; title: string }[]): { id: string; title: string } | null {
  if (docs.length === 1) return docs[0]!;
  const asked = new Set(words(question));
  const scored = docs.map((d) => ({ d, n: words(d.title).filter((w) => asked.has(w)).length })).sort((a, b) => b.n - a.n);
  const best = scored[0];
  if (!best || best.n < 2 || (scored[1] && scored[1].n === best.n)) return null;
  return best.d;
}

/* ---------------------------------------------------------------- running a tool */

export type ToolSend = (e: ChatEvent) => Promise<void>;
export type ToolDeps = {
  /** One reference, as the Check references page checks it. Throws when a database could not be reached. */
  verify: (text: string) => Promise<RefVerdict>;
  /** Per-minute limit per address, one unit per reference (as the page counts): false when it is used up. */
  verifyAllowed: () => Promise<boolean>;
  retractions: (dois: string[]) => Promise<{ checked: ChatRetraction[]; invalid: string[] }>;
  /** "Ask this paper": its events, as its own stream sends them. */
  askPaper: (a: { ref: OaRef; key: string; question: string; clientAbstract: string }, send: (e: OaAskEvent) => Promise<void>) => Promise<void>;
  /** The person's own paper: its events, as its own stream sends them. */
  askDoc: (docId: string, question: string, send: (e: AskStreamEvent) => Promise<void>) => Promise<void>;
  askAllowed: () => Promise<boolean>;
  gone: () => boolean;
};

/** How many references are checked at once (as the MCP tool). */
export const VERIFY_PARALLEL = 6;

async function pool<T>(items: T[], n: number, fn: (t: T, i: number) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i]!, i);
      }
    }),
  );
}

/** A list of references, checked one by one; each verdict is sent as it arrives. A reference that could not be checked says why and never gets a verdict. Returns the items, in order. */
export async function runVerify(refs: string[], deps: ToolDeps, send: ToolSend): Promise<ChatRefItem[]> {
  const items: ChatRefItem[] = new Array(refs.length);
  await pool(refs, VERIFY_PARALLEL, async (raw, i) => {
    if (deps.gone()) return;
    const input = raw.replace(/\s+/g, " ").trim();
    let item: ChatRefItem;
    if (input.length > MAX_REFERENCE_CHARS) item = { n: i + 1, input: input.slice(0, MAX_REFERENCE_CHARS), verdict: null, error: `A single reference can be at most ${MAX_REFERENCE_CHARS} characters.` };
    else if (!(await deps.verifyAllowed())) item = { n: i + 1, input, verdict: null, error: "Too many references were checked in the last minute. Check this one again in a minute." };
    else {
      try {
        item = { n: i + 1, input, verdict: await deps.verify(input) };
      } catch {
        item = { n: i + 1, input, verdict: null, error: "Crossref or OpenAlex could not be reached for this reference." };
      }
    }
    items[i] = item;
    if (!deps.gone()) await send({ type: "tool_ref", item });
  });
  return items.filter(Boolean);
}

/** What one paper's answer came to, for the Thinking block: null when it ended without one. */
export type AskEnd = { answer: Answer | null; error: boolean };

/** Turns the events of an ask into the chat's, and notes how it ended. */
export async function relayAsk(run: (send: (e: OaAskEvent) => Promise<void>) => Promise<void>, send: ToolSend): Promise<AskEnd> {
  const end: AskEnd = { answer: null, error: false };
  await run(async (e) => {
    if (e.type === "answer") end.answer = e.answer;
    if (e.type === "error") end.error = true;
    await send({ type: "tool_ask", event: e });
  });
  if (!end.answer && !end.error) {
    // the ask ended with neither (it was left): say so plainly, never leave a reply that seems to be still writing
    end.error = true;
    await send({ type: "tool_ask", event: { type: "error", code: "cut_off", title: "The answer was not finished" } });
  }
  return end;
}

export const tallyOf = refTally;
export type { Lang };
