import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { liveDoing, type LivePerson } from "@scholar/shared";
import { createLiveClient, liveUrl, type LiveClient, type LiveHandlers, type LiveState, type WsLike } from "../../../../lib/live";
import "./live.css";

/**
 * Live presence in a shared paper (docs/design/paper-live.md, 1 and 5), the lazy "live" chunk: the client and the pieces the reader draws with it. Fetched only when the server says
 * `features.live` for the paper; while LIVE is off nothing of it is downloaded.
 *   PresenceRow   the avatars in the header (up to 4, then +N; one with a count on a phone), a button "3 people here" that opens the list ("Editing Methods", "Viewing p. 3", "In Comments",
 *                 with "Go to where Ravi is"), and the quiet "Reconnecting…" after 5 s without a connection. It keeps its width, so nothing moves when people come and go.
 *   Dots          the small avatars on a notes page tab and on a paper thumbnail.
 *   EditingLabel  "Ravi is editing", on the block another person is typing in.
 */

export type { LiveClient, LiveState };

/** The client of this paper's room, with the browser's socket, clock and page. */
export function startLive(docId: string, on: LiveHandlers): LiveClient {
  const client = createLiveClient(liveUrl(docId, location), {
    // the browser's WebSocket has every member the client uses (its handlers take a narrower event type)
    socket: (u) => new WebSocket(u) as unknown as WsLike,
    timers: { set: (fn, ms) => window.setTimeout(fn, ms), clear: (id) => window.clearTimeout(id), now: () => Date.now() },
    hidden: () => document.visibilityState === "hidden",
  }, on);
  client.start();
  return client;
}

const NOTHING: LiveState = { status: "stopped", people: [], me: null, role: null, line: false };
const noop = () => () => {};
export function useLive(client: LiveClient | null): LiveState {
  return useSyncExternalStore(client?.subscribe ?? noop, client?.get ?? (() => NOTHING), () => NOTHING);
}

export function Avatar({ p, title }: { p: LivePerson; title?: string }) {
  return (
    <span className={`lv-av lv-c${p.colour}`} data-idle={p.idle} data-active={p.active && !p.idle} title={title} aria-hidden="true">
      {p.initial}
    </span>
  );
}

const count = (n: number) => `${n} ${n === 1 ? "person" : "people"} here`;

export type PresenceRowProps = {
  state: LiveState;
  wide: boolean;
  /** The title of a notes page, for "Editing Methods". */
  pageTitle: (id: string) => string | null;
  /** "Go to where Ravi is": the reader shows the page of the paper, the notes page and block, or the comments. Never done by itself. */
  onFollow: (p: LivePerson) => void;
};

export function PresenceRow({ state, wide, pageTitle, onFollow }: PresenceRowProps) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const id = useId();
  const people = state.people;
  const n = people.length;
  useEffect(() => {
    if (n === 0) setOpen(false);
  }, [n]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      btn.current?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", key, true);
    pop.current?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", key, true);
    };
  }, [open]);
  const shown = wide ? people.slice(0, n > 4 ? 3 : 4) : people.slice(0, 1);
  const rest = n - shown.length;
  const doing = (p: LivePerson) => liveDoing(p, pageTitle);
  return (
    <div className="lv" data-wide={wide}>
      {n > 0 && (
        <button ref={btn} type="button" className="lv-row" aria-label={count(n)} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen((o) => !o)}>
          {shown.map((p) => (
            <Avatar key={p.id} p={p} title={`${p.name} · ${doing(p)}`} />
          ))}
          {wide && rest > 0 && <span className="lv-more" aria-hidden="true">+{rest}</span>}
          {!wide && n > 1 && <span className="lv-count" aria-hidden="true">{n}</span>}
        </button>
      )}
      {open && n > 0 && (
        <div ref={pop} id={id} className="lv-pop" role="dialog" aria-label="People on this paper">
          <p className="lv-pop-h">{count(n)}</p>
          <ul className="lv-list">
            {people.map((p) => (
              <li key={p.id} className="lv-item">
                <Avatar p={p} />
                <span className="lv-who">
                  <span className="lv-name">{p.name}{p.role === "owner" ? " (owner)" : ""}</span>
                  <span className="lv-doing">{p.idle ? `Away · ${doing(p)}` : doing(p)}</span>
                </span>
                <button type="button" className="lv-go" onClick={() => (setOpen(false), onFollow(p))}>
                  Go to where {p.name} is
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {state.line && <span className="lv-line" role="status">Reconnecting…</span>}
    </div>
  );
}

/** Small avatars on a notes page tab or a thumbnail: the people there (not idle), at most 3. Decorative: the tab or the thumbnail says it in its label. */
export function Dots({ people }: { people: LivePerson[] }) {
  if (!people.length) return null;
  return (
    <span className="lv-dots" aria-hidden="true">
      {people.slice(0, 3).map((p) => (
        <Avatar key={p.id} p={p} />
      ))}
    </span>
  );
}

/** "Ravi is editing", on a block. */
export function EditingLabel({ p }: { p: LivePerson }) {
  return (
    <span className={`lv-edit lv-c${p.colour}`}>
      <b aria-hidden="true">{p.initial}</b>
      <span>{p.name} is editing</span>
    </span>
  );
}
