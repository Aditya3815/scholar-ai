import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { LIVE_CARET_FADE_MS, liveDoing, mdCaret, type LivePerson } from "@scholar/shared";
import { createLiveClient, liveUrl, type LiveClient, type LiveHandlers, type LiveState, type WsLike } from "../../../../lib/live";
import "./live.css";

/**
 * Live presence in a shared paper (docs/design/paper-live.md, 1 and 5), the lazy "live" chunk: the client and the pieces the reader draws with it. Fetched only when the server says
 * `features.live` for the paper; while LIVE is off nothing of it is downloaded.
 *   PresenceRow   the avatars in the header (up to 4, then +N; one with a count on a phone), a button "3 people here" that opens the list ("Editing Methods", "Viewing p. 3", "In Comments",
 *                 with "Go to where Ravi is"), and the quiet "Reconnecting…" after 5 s without a connection. It keeps its width, so nothing moves when people come and go.
 *   Dots          the small avatars on a notes page tab and on a paper thumbnail.
 *   EditingMark   on a block other people type in: a small avatar each at its edge ("Ravi is editing" in a tooltip on hover, focus or a tap) and each one's caret.
 *   watchCaret    tells the room where this window's cursor is in the block it types in.
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

/** While a pop-up is open: placed again when the window scrolls or changes size; closed by Esc (`esc`) or a press outside `inside`. Returns the way to stop. */
function floating(place: () => void, close: (esc: boolean) => void, inside: () => (Node | null)[]): () => void {
  const key = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    close(true);
  };
  const away = (e: PointerEvent) => {
    if (!inside().some((n) => n?.contains(e.target as Node))) close(false);
  };
  const on = [[window, "resize", place], [window, "scroll", place], [document, "keydown", key], [document, "pointerdown", away]] as [EventTarget, string, EventListener][];
  for (const [t, e, f] of on) t.addEventListener(e, f, true);
  return () => {
    for (const [t, e, f] of on) t.removeEventListener(e, f, true);
  };
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
  const [at, setAt] = useState<CSSProperties>({ visibility: "hidden" });
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const id = useId();
  const people = state.people;
  const n = people.length;
  useEffect(() => {
    if (n === 0) setOpen(false);
  }, [n]);
  // placed before it is painted, so it never shows in the wrong place
  useLayoutEffect(() => {
    if (!open) return;
    // under the button, inside the window (a sheet across the width on a phone); again when the window changes
    const place = () => {
      const r = btn.current?.getBoundingClientRect();
      if (!r) return;
      const top = Math.round(r.bottom + 6);
      if (!wide) return setAt({ top, left: 12, right: 12 });
      const w = Math.min(300, window.innerWidth - 24);
      setAt({ top, left: Math.round(Math.max(12, Math.min(r.right - w, window.innerWidth - 12 - w))) });
    };
    place();
    const stop = floating(place, (esc) => {
      setOpen(false);
      if (esc) btn.current?.focus({ preventScroll: true });
    }, () => [pop.current, btn.current]);
    pop.current?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
    return stop;
  }, [open, wide]);
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
        <div ref={pop} id={id} className="lv-pop" role="dialog" aria-label="People on this paper" style={at}>
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

/* ---------------------------------------------------------------- a block other people type in (docs/design/paper-live.md, 9) */

/** Tells the room where the cursor is in the block this window types in (its text field: an offset into the block's Markdown), as it moves. Returns the way to stop. */
export function watchCaret(client: LiveClient): () => void {
  const read = () => {
    const f = document.activeElement;
    if (!(f instanceof HTMLTextAreaElement) || !f.classList.contains("nb-field")) return;
    const block = f.closest<HTMLElement>("[data-block]")?.dataset.block;
    if (block) client.setCaret(block, f.selectionStart, f.selectionEnd);
  };
  const events = ["selectionchange", "input", "keyup", "pointerup", "focusin"];
  for (const e of events) document.addEventListener(e, read, true);
  return () => {
    for (const e of events) document.removeEventListener(e, read, true);
  };
}

type Box = { x: number; y: number; w: number; h: number };
type Place = { at: Box; sel: Box[] };

/** The boxes of the text from `a` to `b` (offsets in the text as drawn) in `el`, relative to `o`; with `a === b`, the caret: the left edge of character `a`, or (`after`) the right edge of the one before. */
function boxes(el: HTMLElement, o: DOMRect, a: number, b: number, after: boolean): Box[] {
  const nodes: Text[] = [];
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) nodes.push(n as Text);
  // the text node and offset of a place in the text (`end`: a place at a node's end stays in it)
  const at = (q: number, end: boolean): [Text, number] | null => {
    for (const t of nodes) {
      if (q < t.data.length || (end && q === t.data.length)) return [t, Math.max(0, q)];
      q -= t.data.length;
    }
    const t = nodes[nodes.length - 1];
    return t ? [t, t.data.length] : null;
  };
  const r = document.createRange();
  const box = (x: DOMRect): Box => ({ x: x.left - o.left, y: x.top - o.top, w: x.width, h: x.height });
  if (a === b) {
    // the character beside the caret, measured: the caret is its edge
    const s = at(after ? a - 1 : a, false);
    if (!s) return [];
    r.setStart(s[0], Math.min(s[1], Math.max(0, s[0].data.length - 1)));
    r.setEnd(s[0], Math.min(s[0].data.length, s[1] + 1));
    const all = [...r.getClientRects()].filter((x) => x.height > 0);
    const x = after ? all[all.length - 1] : all[0];
    return x ? [{ ...box(x), x: (after ? x.right : x.left) - o.left, w: 0 }] : [];
  }
  const s = at(a, false);
  const e = at(b, true);
  if (!s || !e) return [];
  r.setStart(s[0], s[1]);
  r.setEnd(e[0], e[1]);
  return [...r.getClientRects()].filter((x) => x.width > 0.5 && x.height > 0).map(box);
}

/** Where a person's caret (and selection) is drawn in a block (`li`), from its offset in the block's Markdown; null when it is not drawn (this window writes in that block too). */
function placeCaret(li: HTMLElement, md: string, p: LivePerson): Place | null {
  if (p.caret === undefined) return null;
  const o = li.getBoundingClientRect();
  const field = li.querySelector("textarea");
  if (field) {
    // an empty block is its text field: the caret at its start; a block this window writes in is left alone
    if (field.value) return null;
    const f = field.getBoundingClientRect();
    const cs = getComputedStyle(field);
    const h = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
    return { at: { x: f.left - o.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth), y: f.top - o.top + parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth), w: 0, h }, sel: [] };
  }
  const el = li.querySelector<HTMLElement>(".nb-text");
  if (!el) return null;
  // past the saved text (their typing is not saved yet): at its end
  const c = mdCaret(md, p.caret);
  const [at] = boxes(el, o, c.at, c.at, c.after);
  if (!at) return null;
  const end = p.caretEnd !== undefined ? mdCaret(md, p.caretEnd).at : c.at;
  return { at, sel: end > c.at ? boxes(el, o, c.at, end, false) : [] };
}

/**
 * The other people typing in a block: a small avatar each at its edge (MarkAvatar), and each one's caret where they type, in their colour, blinking like a real one (steady with reduced
 * motion), with their name on a flag when pointed at; faded LIVE_CARET_FADE_MS after it last moved, and gone when they leave the block. `md` reads the block's Markdown now.
 */
export function EditingMark({ people, md }: { people: LivePerson[]; md: () => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [tick, setTick] = useState(0);
  const [places, setPlaces] = useState<Record<string, Place | null>>({});
  const moved = useRef(new Map<string, { key: string; t: number }>());
  const now = Date.now();
  for (const p of people) {
    const key = `${p.caret}:${p.caretEnd}`;
    if (moved.current.get(p.id)?.key !== key) moved.current.set(p.id, { key, t: now });
  }
  const since = (p: LivePerson) => now - (moved.current.get(p.id)?.t ?? 0);
  // placed again when the block reflows (the window changed size, a font came) or its text changes; the layer lives in the block, so it scrolls with it
  useLayoutEffect(() => {
    const li = ref.current?.closest<HTMLElement>("[data-block]");
    if (!li) return;
    const again = () => setTick((t) => t + 1);
    const ro = new ResizeObserver(again);
    ro.observe(li);
    const mo = new MutationObserver(again);
    mo.observe(li.querySelector(".nb-body") ?? li, { subtree: true, childList: true, characterData: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, []);
  const key = people.map((p) => `${p.id}:${p.caret}:${p.caretEnd}`).join();
  useLayoutEffect(() => {
    const li = ref.current?.closest<HTMLElement>("[data-block]");
    if (!li) return;
    const next: Record<string, Place | null> = {};
    for (const p of people) next[p.id] = placeCaret(li, md(), p);
    setPlaces((was) => (JSON.stringify(was) === JSON.stringify(next) ? was : next));
  }, [key, tick]);
  // drawn again when the next caret is due to fade
  const due = Math.min(...people.map((p) => (since(p) < LIVE_CARET_FADE_MS ? LIVE_CARET_FADE_MS - since(p) : Infinity)));
  useEffect(() => {
    if (due === Infinity) return;
    const t = window.setTimeout(() => setTick((x) => x + 1), due + 20);
    return () => window.clearTimeout(t);
  }, [due, key]);
  return (
    <span ref={ref} className="lv-mk">
      <span className="lv-mk-row">
        {people.map((p) => (
          <MarkAvatar key={p.id} p={p} />
        ))}
      </span>
      {people.map((p) => {
        const at = places[p.id];
        return at ? (
          <span key={p.id} className={`lv-cr lv-c${p.colour}`} aria-hidden="true" data-faded={since(p) >= LIVE_CARET_FADE_MS || undefined}>
            {at.sel.map((b, i) => (
              <span key={i} className="lv-sel" style={{ left: b.x, top: b.y, width: b.w, height: b.h }} />
            ))}
            {/* a new element at each move, so the blink starts again with the caret shown */}
            <span key={moved.current.get(p.id)?.key} className="lv-caret" style={{ left: at.at.x, top: at.at.y, height: at.at.h }}>
              <span className="lv-flag">{p.name}</span>
            </span>
          </span>
        ) : null;
      })}
    </span>
  );
}

/** One person's small avatar on a block: "Bela Editor is editing this block" to a screen reader; on hover, keyboard focus or a tap, a tooltip "Bela Editor is editing", kept inside the window. */
function MarkAvatar({ p }: { p: LivePerson }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const timer = useRef(0);
  const touch = useRef(false);
  const id = useId();
  const words = `${p.name} is editing`;
  const later = (v: boolean, ms: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(v), ms);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    if (!open) return;
    // the tooltip lives in the page's body, so no panel's edge or layer can cut or cover it; placed above the avatar (under it when there is no room), inside the window
    const tip = document.createElement("span");
    tip.id = id;
    tip.className = "lv-tip";
    tip.setAttribute("role", "tooltip");
    tip.textContent = words;
    tip.onpointerenter = () => window.clearTimeout(timer.current);
    tip.onpointerleave = () => later(false, 150);
    document.body.append(tip);
    const place = () => {
      const a = btn.current?.getBoundingClientRect();
      const t = tip.getBoundingClientRect();
      if (!a) return;
      tip.style.left = `${Math.round(Math.max(8, Math.min(a.left + a.width / 2 - t.width / 2, window.innerWidth - 8 - t.width)))}px`;
      tip.style.top = `${Math.round(a.top - t.height - 6 >= 8 ? a.top - t.height - 6 : a.bottom + 6)}px`;
    };
    place();
    const stop = floating(place, () => setOpen(false), () => [btn.current, tip]);
    // a tap shows it for a few seconds
    const t = touch.current ? window.setTimeout(() => setOpen(false), 4000) : 0;
    return () => {
      stop();
      window.clearTimeout(t);
      tip.remove();
    };
  }, [open, id, words]);
  return (
    <>
      <button
        ref={btn}
        type="button"
        className="lv-mk-av"
        aria-label={`${words} this block`}
        aria-describedby={open ? id : undefined}
        onPointerDown={(e) => (touch.current = e.pointerType !== "mouse")}
        onPointerEnter={(e) => e.pointerType === "mouse" && later(true, 350)}
        onPointerLeave={(e) => e.pointerType === "mouse" && later(false, 150)}
        onFocus={(e) => {
          if (!e.currentTarget.matches(":focus-visible")) return;
          touch.current = false;
          later(true, 350);
        }}
        onBlur={() => later(false, 0)}
        onClick={() => {
          window.clearTimeout(timer.current);
          setOpen((o) => (touch.current ? !o : true));
        }}
      >
        <span className={`lv-av lv-c${p.colour}`} aria-hidden="true">
          {p.initial}
        </span>
      </button>
    </>
  );
}
