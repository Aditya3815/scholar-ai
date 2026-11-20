import { LIVE_ACTIVE_MS, LIVE_CARET_MAX, LIVE_CARET_SEND_MS, LIVE_CLOSE, LIVE_HEARTBEAT_MS, LIVE_IDLE_MS, LIVE_RECONNECT_LINE_MS, readLiveServer, type LiveHere, type LiveKind, type LivePerson, type LiveRole } from "@scholar/shared";

/**
 * The page's side of a paper's room (docs/design/paper-live.md): one WebSocket to /api/v1/documents/:id/live, which says where this window is (on a change, and every 20 s) and hears who
 * else is here and what changed. It carries no content: a `changed` makes the reader fetch the thing through its route. Reconnects by itself (1 s, then longer, up to 30 s), and says
 * "Reconnecting…" only after 5 s without a connection. Closed with 4403, it stops and asks the reader to check the paper (access ended). A plain object with its socket and clock handed in,
 * so it is tested in node (live.test.ts); part of the lazy "live" chunk.
 */

export type LiveStatus = "connecting" | "open" | "reconnecting" | "noaccess" | "stopped";
export type LiveState = {
  status: LiveStatus;
  /** The others (never this person: all of their own windows are left out). */
  people: LivePerson[];
  /** This person's account id and role, once the room said hello. */
  me: string | null;
  role: LiveRole | null;
  /** "Reconnecting…" is shown: the connection has been gone for LIVE_RECONNECT_LINE_MS. */
  line: boolean;
};
export type LiveChange = { kind: LiveKind; id?: string; rev?: number; by: string };

/** What the client needs of a WebSocket (the browser's has all of it). */
export type WsLike = {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((e: unknown) => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: ((e: { code: number }) => void) | null;
  onerror: ((e: unknown) => void) | null;
};
export type LiveDeps = {
  socket: (url: string) => WsLike;
  timers: { set: (fn: () => void, ms: number) => number; clear: (id: number) => void; now: () => number };
  /** The tab is hidden (counts as idle). */
  hidden: () => boolean;
  random?: () => number;
};
export type LiveHandlers = {
  onChanged?: (c: LiveChange) => void;
  /** The connection came back after it was lost: fetch what was missed. */
  onReconnected?: () => void;
  /** The room closed this window with 4403: the reader checks whether the paper is still open to this person. */
  onAccessEnded?: () => void;
};

export type Where = Omit<LiveHere, "t" | "active" | "idle" | "caret" | "caretEnd">;

const OPEN = 1;
export const liveUrl = (docId: string, loc: { protocol: string; host: string }) => `${loc.protocol === "https:" ? "wss" : "ws"}://${loc.host}/api/v1/documents/${encodeURIComponent(docId)}/live`;
/** The wait before the n-th try again (n from 1): 1, 2, 4, 8, 16, then 30 s, with up to a fifth of it at random, so a room's people do not all come back at once. */
export const backoffMs = (n: number, random = Math.random) => {
  const base = Math.min(30_000, 1000 * 2 ** Math.max(0, n - 1));
  return Math.round(base + base * 0.2 * random());
};

export type LiveClient = ReturnType<typeof createLiveClient>;

export function createLiveClient(url: string, deps: LiveDeps, on: LiveHandlers = {}) {
  let state: LiveState = { status: "connecting", people: [], me: null, role: null, line: false };
  const listeners = new Set<() => void>();
  let ws: WsLike | null = null;
  let tries = 0;
  let everOpen = false;
  let retryTimer = 0;
  let lineTimer = 0;
  let beatTimer = 0;
  let stopped = false;
  let where: Where = { view: "paper" };
  let lastActivity = deps.timers.now();
  let lastSent = "";
  let rawPeople: LivePerson[] = [];
  let lastBeat = 0;
  // where the cursor is in the block typed in (sent with it, at most every LIVE_CARET_SEND_MS)
  let caret: { block: string; at: number; end: number } | null = null;
  let caretTimer = 0;
  let caretSent = -Infinity;

  const set = (patch: Partial<LiveState>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };
  const others = () => (state.me ? rawPeople.filter((p) => p.id !== state.me) : rawPeople);

  const activity = () => {
    const quiet = deps.timers.now() - lastActivity;
    const idle = deps.hidden() || quiet >= LIVE_IDLE_MS;
    return { active: !idle && quiet < LIVE_ACTIVE_MS, idle };
  };
  const caretOf = (): Pick<LiveHere, "caret" | "caretEnd"> =>
    caret && where.editingBlock === caret.block ? { caret: caret.at, ...(caret.end > caret.at ? { caretEnd: caret.end } : {}) } : {};
  const message = (): string => JSON.stringify({ t: "here", ...where, ...caretOf(), ...activity() } satisfies LiveHere);
  const sendHere = (force: boolean) => {
    if (!ws || ws.readyState !== OPEN) return;
    const m = message();
    if (!force && m === lastSent) return;
    lastSent = m;
    try {
      ws.send(m);
    } catch {
      /* closing: the close handler tries again */
    }
  };
  const beat = () => {
    deps.timers.clear(beatTimer);
    // the heartbeat, and a look every 10 s at whether this person became active or idle
    beatTimer = deps.timers.set(() => {
      const due = deps.timers.now() - lastBeat >= LIVE_HEARTBEAT_MS;
      if (due) lastBeat = deps.timers.now();
      sendHere(due);
      beat();
    }, 10_000);
  };

  const lost = () => {
    if (stopped) return;
    deps.timers.clear(beatTimer);
    if (state.status === "open" || state.status === "connecting") set({ status: everOpen ? "reconnecting" : "connecting", people: [] });
    rawPeople = [];
    if (!lineTimer && !state.line) lineTimer = deps.timers.set(() => ((lineTimer = 0), !stopped && state.status !== "open" && set({ line: true })), LIVE_RECONNECT_LINE_MS);
    deps.timers.clear(retryTimer);
    tries += 1;
    retryTimer = deps.timers.set(connect, backoffMs(tries, deps.random));
  };

  function connect() {
    if (stopped) return;
    deps.timers.clear(retryTimer);
    let s: WsLike;
    try {
      s = deps.socket(url);
    } catch {
      return lost();
    }
    ws = s;
    s.onopen = () => {
      if (ws !== s) return;
      const back = everOpen;
      everOpen = true;
      tries = 0;
      deps.timers.clear(lineTimer);
      lineTimer = 0;
      set({ status: "open", line: false });
      lastSent = "";
      lastBeat = deps.timers.now();
      sendHere(true);
      beat();
      if (back) on.onReconnected?.();
    };
    s.onmessage = (e) => {
      if (ws !== s) return;
      const m = readLiveServer(e.data);
      if (!m) return;
      if (m.t === "hello") set({ me: m.you, role: m.role, people: others() });
      else if (m.t === "presence") {
        rawPeople = m.people;
        set({ people: others() });
      } else on.onChanged?.({ kind: m.kind, by: m.by, ...(m.id !== undefined ? { id: m.id } : {}), ...(m.rev !== undefined ? { rev: m.rev } : {}) });
    };
    s.onerror = () => {};
    s.onclose = (e) => {
      if (ws !== s) return;
      ws = null;
      if (stopped) return;
      if (e.code === LIVE_CLOSE.noAccess) {
        deps.timers.clear(beatTimer);
        rawPeople = [];
        set({ status: "noaccess", people: [] });
        on.onAccessEnded?.();
        return;
      }
      if (e.code === LIVE_CLOSE.reconnect) {
        // the role changed: straight back in, with the new one
        tries = 0;
        set({ status: "reconnecting" });
        retryTimer = deps.timers.set(connect, 0);
        return;
      }
      lost();
    };
  }

  return {
    get: (): LiveState => state,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    start() {
      stopped = false;
      connect();
    },
    /** After a 4403, the paper still opens for this person (they kept the link, say): connect again. */
    restart() {
      if (state.status !== "noaccess") return;
      set({ status: "connecting" });
      connect();
    },
    /** Where this window is now; sent when it changed. */
    setWhere(w: Where) {
      where = w;
      sendHere(false);
    },
    /** Where the cursor is in the block typed in (an offset into its Markdown, and a selection's end), or null: sent with the block, at most every LIVE_CARET_SEND_MS, the last one always. */
    setCaret(block: string | null, at = 0, end = at) {
      const clamp = (n: number) => Math.max(0, Math.min(LIVE_CARET_MAX, Math.trunc(n) || 0));
      caret = block ? { block, at: clamp(at), end: clamp(Math.max(at, end)) } : null;
      if (caretTimer) return;
      const send = () => {
        caretTimer = 0;
        caretSent = deps.timers.now();
        sendHere(false);
      };
      const wait = caretSent + LIVE_CARET_SEND_MS - deps.timers.now();
      if (wait <= 0) send();
      else caretTimer = deps.timers.set(send, wait);
    },
    /** The person did something (a key, a pointer, a scroll): active for 30 s. */
    touch() {
      const was = activity();
      lastActivity = deps.timers.now();
      const now = activity();
      if (was.active !== now.active || was.idle !== now.idle) sendHere(false);
    },
    /** The tab was hidden or shown. */
    visibility() {
      sendHere(false);
    },
    stop() {
      stopped = true;
      deps.timers.clear(retryTimer);
      deps.timers.clear(lineTimer);
      deps.timers.clear(beatTimer);
      deps.timers.clear(caretTimer);
      const s = ws;
      ws = null;
      try {
        s?.close(1000, "left");
      } catch {
        /* already closed */
      }
      set({ status: "stopped", people: [] });
      listeners.clear();
    },
  };
}
