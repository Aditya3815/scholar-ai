import { useSyncExternalStore } from "react";
import { MAX_OA_ABSTRACT_CHARS, oaKey, refFromPaper, type Answer, type AskStage, type OaAskEvent, type OaIngestEvent, type OaPaperEvent, type Paper } from "@scholar/shared";
import { ApiError } from "./api/client";
import { endingOf, perFrame, postStream, readSse, type Ending } from "./api/stream";

/**
 * "Ask this paper" on any search result (W4). The sheet shows the questions asked about one paper at a time; they are kept for the visit (in memory, per paper) and nowhere else:
 * the server keeps no question, and the shared copy of the paper holds nobody's name.
 */
export type OaTurn = {
  id: string;
  question: string;
  status: "working" | "done" | "error" | "stopped";
  /** the paper is being read into the shared index (absent when it was there already) */
  ingest: OaIngestEvent | null;
  /** what the answer is made from */
  paper: OaPaperEvent | null;
  stage: AskStage | null;
  pages: number[];
  /** the answer as it is written: provisional, until the checked one arrives */
  live: string;
  answer: Answer | null;
  error: { code: string; title: string; detail?: string } | null;
};
type State = { open: boolean; paper: Paper | null; turns: ReadonlyMap<string, OaTurn[]> };

let state: State = { open: false, paper: null, turns: new Map() };
const listeners = new Set<() => void>();
const set = (next: Partial<State>) => {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
};
export const useOaAsk = (): State =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );

/** The key of the open paper in the shared index, or null if it has no DOI or arXiv number (then it cannot be asked). */
export const keyOf = (p: Paper): string | null => {
  const ref = refFromPaper(p);
  return ref ? oaKey(ref) : null;
};
export const canAsk = (p: Paper): boolean => keyOf(p) !== null;

/** The button that opened the sheet: the focus goes back to it when the sheet closes (the sheet is not a Radix trigger, so it has to be remembered). */
let opener: HTMLElement | null = null;
export const restoreFocus = () => {
  if (opener?.isConnected) opener.focus();
  opener = null;
};
export const openOaAsk = (paper: Paper) => {
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  set({ open: true, paper });
};
export const closeOaAsk = () => set({ open: false });

const controllers = new Map<string, AbortController>();
const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 16);

const patch = (key: string, id: string, fn: (t: OaTurn) => OaTurn) => {
  const turns = state.turns.get(key);
  if (!turns) return;
  set({ turns: new Map(state.turns).set(key, turns.map((t) => (t.id === id ? fn(t) : t))) });
};

export const reduceTurn = (t: OaTurn, e: OaAskEvent): OaTurn => {
  if (t.status !== "working") return t;
  switch (e.type) {
    case "ingest": return { ...t, ingest: e };
    case "paper": return { ...t, paper: e };
    case "stage": return { ...t, stage: e.stage };
    case "sources": return { ...t, pages: e.pages };
    case "delta": return { ...t, live: t.live + e.text };
    case "answer": return { ...t, status: "done", answer: e.answer, live: "", stage: null };
    case "error": return { ...t, status: "error", live: "", error: { code: e.code, title: e.title, ...(e.detail ? { detail: e.detail } : {}) } };
    // a critique belongs to the Paper Reader's drawer, never to a question about an open-access paper
    case "critique": return t;
  }
};

/** The sheet's words for a question the server refused, by status: signed out (401) and too many questions (429) have their own; anything they leave out is the server's problem. */
const OA_REFUSED: Partial<Record<number, { code: string; title: string; detail?: string }>> = {
  401: { code: "sign_in", title: "Sign in to ask this paper" },
  429: { code: "rate_limited", title: "Too many questions just now", detail: "Please wait a minute and try again." },
};
const refusal = (e: ApiError) => {
  const own = OA_REFUSED[e.status];
  const detail = own?.detail ?? e.detail;
  return { code: own?.code ?? e.type, title: own?.title ?? e.title, ...(detail ? { detail } : {}) };
};

/** The sheet's words for a stream that did not finish. */
const OA_ENDINGS: Record<Exclude<Ending, "stopped">, { code: string; title: string; detail: string }> = {
  cut_off: { code: "cut_off", title: "The answer was cut off", detail: "Ask again: a paper that was being read keeps being read." },
  connection_lost: { code: "network", title: "The connection was lost", detail: "Check your internet and ask again." },
  failed: { code: "network", title: "Something went wrong", detail: "Check your internet and ask again." },
};

/** Whether a question is being answered for this paper now (one at a time). */
export const isAsking = (key: string | null): boolean => !!key && (state.turns.get(key) ?? []).some((t) => t.status === "working");

export async function askPaper(paper: Paper, question: string, again?: string): Promise<"sent" | "busy" | "invalid"> {
  const ref = refFromPaper(paper);
  const key = ref && oaKey(ref);
  const q = question.replace(/\s+/g, " ").trim();
  if (!ref || !key || q.length < 3 || q.length > 600) return "invalid";
  if (isAsking(key)) return "busy";
  const id = again ?? newId();
  const fresh: OaTurn = { id, question: q, status: "working", ingest: null, paper: null, stage: null, pages: [], live: "", answer: null, error: null };
  const old = state.turns.get(key) ?? [];
  set({ turns: new Map(state.turns).set(key, again ? old.map((t) => (t.id === id ? fresh : t)) : [...old, fresh]) });

  const ctl = new AbortController();
  controllers.set(key, ctl);
  const frames = perFrame<OaAskEvent>((batch) => patch(key, id, (t) => batch.reduce(reduceTurn, t)));
  try {
    let res: Response;
    try {
      res = await postStream("/api/v1/papers/oa/ask", { ...ref, question: q, ...(paper.abstract ? { abstract: paper.abstract.slice(0, MAX_OA_ABSTRACT_CHARS) } : {}) }, { headers: { Accept: "text/event-stream" }, signal: ctl.signal, fallback: "That could not be sent" });
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      patch(key, id, (t) => reduceTurn(t, { type: "error", ...refusal(e) }));
      return "sent";
    }
    await readSse<OaAskEvent>(res, frames.push, ctl.signal);
    frames.flush();
    patch(key, id, (t) => (t.status === "working" ? reduceTurn(t, { type: "error", ...OA_ENDINGS.cut_off }) : t));
  } catch (e) {
    frames.flush();
    const end = endingOf(e);
    if (end === "stopped") patch(key, id, (t) => (t.status === "working" ? { ...t, status: "stopped", live: "" } : t));
    else patch(key, id, (t) => reduceTurn(t, { type: "error", ...OA_ENDINGS[end] }));
  } finally {
    controllers.delete(key);
  }
  return "sent";
}

export const stopAsking = (key: string | null) => {
  if (key) controllers.get(key)?.abort();
};

/** Signing out: nothing about what was asked stays on the screen. */
export function clearOaAsk() {
  for (const c of controllers.values()) c.abort();
  set({ open: false, paper: null, turns: new Map() });
}
