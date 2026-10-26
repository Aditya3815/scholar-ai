import { useSyncExternalStore } from "react";
import { oaKey, refFromPaper, type Answer, type AskStage, type OaAskEvent, type OaIngestEvent, type OaPaperEvent, type Paper } from "@scholar/shared";
import { readSse } from "./sse";

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
  }
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
  let queue: OaAskEvent[] = [];
  let raf = 0;
  const flush = () => {
    raf = 0;
    const batch = queue;
    queue = [];
    if (batch.length) patch(key, id, (t) => batch.reduce(reduceTurn, t));
  };
  try {
    const res = await fetch("/api/v1/papers/oa/ask", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ ...ref, question: q, ...(paper.abstract ? { abstract: paper.abstract.slice(0, 4000) } : {}) }),
      signal: ctl.signal,
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => null)) as { type?: string; title?: string; detail?: string } | null;
      const code = res.status === 401 ? "sign_in" : res.status === 429 ? "rate_limited" : (j?.type ?? "error");
      const title = res.status === 401 ? "Sign in to ask this paper" : res.status === 429 ? "Too many questions just now" : (j?.title ?? "That could not be sent");
      patch(key, id, (t) => reduceTurn(t, { type: "error", code, title, ...(res.status === 429 ? { detail: "Please wait a minute and try again." } : j?.detail ? { detail: j.detail } : {}) }));
      return "sent";
    }
    await readSse<OaAskEvent>(res, (e) => {
      queue.push(e);
      if (!raf) raf = requestAnimationFrame(flush);
    }, ctl.signal);
    if (raf) cancelAnimationFrame(raf);
    flush();
    patch(key, id, (t) => (t.status === "working" ? reduceTurn(t, { type: "error", code: "cut_off", title: "The answer was cut off", detail: "Ask again: a paper that was being read keeps being read." }) : t));
  } catch (e) {
    if (raf) cancelAnimationFrame(raf);
    flush();
    if (e instanceof DOMException && e.name === "AbortError") patch(key, id, (t) => (t.status === "working" ? { ...t, status: "stopped", live: "" } : t));
    else patch(key, id, (t) => reduceTurn(t, { type: "error", code: "network", title: e instanceof TypeError ? "The connection was lost" : "Something went wrong", detail: "Check your internet and ask again." }));
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
