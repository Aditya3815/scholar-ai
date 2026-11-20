import { ArrowUpRight } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { CAPTURE_SIZES, IMAGE_SIZE_WIDTH, IMAGE_WIDTH, NOTEBOOK_AGENT_LABEL, clampImageWidth, NOTEBOOK_LIMITS, agentHeading, mdSourceRuns, parseNotebookMd, type AgentBlock, type CaptureBlock, type CaptureSize, type ImageBlock, type MdInline, type QuoteBlock, type TextBlock } from "@scholar/shared";
import { useGrowingField } from "../../../../lib/autogrow";
import type { Meaning } from "../../../../lib/meanings";

/**
 * The Notebook's blocks (docs/design/paper-reader.md, 19.4 and 19.5). Markdown is drawn from tokens (packages/shared/src/notebook-md.ts) as React elements: no HTML string is ever put into the
 * page, so what a block holds can only ever be text, bold, italic, underline, mark, a heading, a list or a line break.
 */

function Inline({ c }: { c: MdInline[] }): ReactNode {
  return c.map((x, i) => {
    switch (x.t) {
      case "text":
        return <Fragment key={i}>{x.s}</Fragment>;
      case "br":
        return <br key={i} />;
      case "b":
        return <strong key={i}><Inline c={x.c} /></strong>;
      case "i":
        return <em key={i}><Inline c={x.c} /></em>;
      case "u":
        return <u key={i}><Inline c={x.c} /></u>;
      case "mark":
        return <mark key={i} className="nb-mark"><Inline c={x.c} /></mark>;
    }
  });
}

/** A text block's Markdown, drawn. Its headings sit under the page's own (h3 to h5). */
export function MdView({ md }: { md: string }) {
  const blocks = useMemo(() => parseNotebookMd(md), [md]);
  return (
    <>
      {blocks.map((b, i) => {
        if (b.t === "h") {
          const H = (["h3", "h4", "h5"] as const)[b.level - 1]!;
          return <H key={i} className={`nb-h nb-h${b.level}`}><Inline c={b.c} /></H>;
        }
        if (b.t === "p") return <p key={i}><Inline c={b.c} /></p>;
        if (b.t === "ul") return <ul key={i}>{b.items.map((it, k) => <li key={k}><Inline c={it} /></li>)}</ul>;
        return <ol key={i} start={b.start}>{b.items.map((it, k) => <li key={k}><Inline c={it} /></li>)}</ol>;
      })}
    </>
  );
}

/**
 * The source of a text block as it is being written, drawn under its field (whose letters are clear): every character in its place, so the cursor and the selection fall where they are drawn;
 * the marks faint, and the text they wrap underlined, marked or bold (bold by a shadow, which takes no width). React elements only, as MdView.
 */
function SourceMirror({ md }: { md: string }) {
  const lines = useMemo(() => mdSourceRuns(md), [md]);
  return (
    <div className="nb-mirror" aria-hidden="true">
      {lines.map((line, i) => (
        <Fragment key={i}>
          {i > 0 && "\n"}
          {line.map((r, k) => (
            <span key={k} className={r.mark ? "nb-mk" : undefined} data-u={r.u || undefined} data-hl={r.hl || undefined} data-b={r.b || undefined}>
              {r.s}
            </span>
          ))}
        </Fragment>
      ))}
      {/* a last empty line still takes its height, as it does in the field */}
      {md.endsWith("\n") && "​"}
    </div>
  );
}

/**
 * A text block: formatted text that is a focusable region ("Text block 2, press Enter to edit"; Enter or a click opens it), and a text field while it is being edited (Esc closes it and the
 * focus stays on the block). An empty block is always its field, so writing can start at once.
 */
export function TextBlockView({
  b,
  n,
  editing,
  placeholder,
  onEdit,
  onStop,
  onChange,
  onKeys,
  onSelect,
  fieldRef,
  focusTick,
}: {
  b: TextBlock;
  n: number;
  editing: boolean;
  placeholder: string;
  onEdit: () => void;
  onStop: () => void;
  onChange: (md: string) => void;
  onKeys: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSelect: (el: HTMLTextAreaElement) => void;
  fieldRef: (el: HTMLTextAreaElement | null) => void;
  focusTick: number;
}) {
  const area = useRef<HTMLTextAreaElement | null>(null);
  const region = useRef<HTMLDivElement>(null);
  const empty = !b.md.trim();
  const asField = editing || empty;
  const marked = asField && /\*|==|\+\+|<u>/.test(b.md);
  useGrowingField(area, b.md, 4000, asField);
  // asked to edit (a click, Enter): the cursor goes in at the end
  useEffect(() => {
    if (!editing || !area.current) return;
    if (document.activeElement !== area.current) {
      const end = area.current.value.length;
      area.current.focus({ preventScroll: false });
      area.current.setSelectionRange(end, end);
    }
  }, [editing, focusTick]);
  if (asField) {
    const field = (
      <textarea
        ref={(el) => {
          area.current = el;
          fieldRef(el);
        }}
        className="nb-field"
        aria-label={`Text block ${n}`}
        placeholder={placeholder}
        rows={1}
        maxLength={NOTEBOOK_LIMITS.text}
        value={b.md}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => !editing && onEdit()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onStop();
            // the focus stays on the block: its region, or (an empty block has none) the field itself
            if (!empty) window.setTimeout(() => document.querySelector<HTMLElement>(`[data-block="${b.id}"] .nb-text`)?.focus(), 0);
            return;
          }
          onKeys(e);
        }}
        onSelect={(e) => onSelect(e.currentTarget)}
        onBlur={(e) => {
          // a press on the toolbar keeps the field (it takes no focus); anywhere else closes it
          if (!(e.relatedTarget as Element | null)?.closest?.(".nb-tools")) onStop();
        }}
        data-mirrored={marked || undefined}
      />
    );
    // with a mark in it, the field's own letters are clear and its source is drawn under them, styled (SourceMirror): underline shows as underline while it is typed, never as its marks
    return marked ? (
      <div className="nb-edit">
        <SourceMirror md={b.md} />
        {field}
      </div>
    ) : (
      field
    );
  }
  return (
    <div
      ref={region}
      className="nb-text"
      role="region"
      tabIndex={0}
      aria-label={`Text block ${n}, press Enter to edit`}
      onClick={(e) => {
        if (window.getSelection()?.isCollapsed !== false) onEdit();
        e.stopPropagation();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) {
          e.preventDefault();
          onEdit();
        }
      }}
    >
      <MdView md={b.md} />
    </div>
  );
}

/** A quote of a highlight: its meaning in words and by its letter (never by colour alone), the words, and "p. N" back to the paper. A highlight that was removed: "highlight removed". */
export function QuoteBlockView({ b, mean, removed, onGo }: { b: QuoteBlock; mean: Meaning; removed: boolean; onGo: () => void }) {
  return (
    <figure className="nb-quote" data-color={b.color} data-removed={removed || undefined} aria-label={`${mean.name}, page ${b.page}`}>
      <span aria-hidden="true">
        <span className="desk-dot" data-color={b.color}>{mean.letter}</span>
      </span>
      <blockquote>“{b.quote}”</blockquote>
      <figcaption>
        <b>{mean.name}</b>
        {removed && <span className="nb-removed">highlight removed</span>}
        <button type="button" className="nb-go" onClick={onGo} aria-label={`Show page ${b.page} in the paper`} title="Show this passage in the paper">
          p. {b.page} <ArrowUpRight size={13} aria-hidden="true" />
        </button>
      </figcaption>
    </figure>
  );
}

const CAPTURE_SIZE_NAME: Record<CaptureSize, string> = { s: "S", m: "M", full: "Full" };
const CAPTURE_SIZE_LABEL: Record<CaptureSize, string> = { s: "Small", m: "Medium", full: "Full width" };

/**
 * A capture (docs/design/paper-reader.md, 21.1, 6): the part of the page, drawn from the open paper at this screen's pixels (`paint`, from the reader: no picture is stored), its caption,
 * its size in the notes (S, M, Full), and "p. N" back to the paper.
 */
export function CaptureBlockView({ b, paint, onGo, onCaption, onSize }: { b: CaptureBlock; paint?: (canvas: HTMLCanvasElement, b: CaptureBlock, cssWidth: number) => Promise<number>; onGo: () => void; onCaption: (s: string) => void; onSize: (s: CaptureSize) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"drawing" | "ok" | "error">("drawing");
  useEffect(() => {
    const el = canvas.current;
    const w = wrap.current;
    if (!el || !w || !paint) return void setState("error");
    let gone = false;
    let drawn = 0;
    let timer = 0;
    const draw = () => {
      const width = Math.round(w.clientWidth);
      // drawn again only when the width changed enough to show (a capture is a picture of the page, sharp at the size it is drawn)
      if (!width || Math.abs(width - drawn) < 24) return;
      drawn = width;
      paint(el, b, width).then(
        () => !gone && setState("ok"),
        () => !gone && setState("error"),
      );
    };
    draw();
    const ro = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(draw, 150);
    });
    ro.observe(w);
    return () => {
      gone = true;
      window.clearTimeout(timer);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b.page, b.x, b.y, b.w, b.h, b.size, paint]);
  const what = b.caption ? `A part of page ${b.page}: ${b.caption}` : `A part of page ${b.page}`;
  return (
    <figure className="nb-capture" data-size={b.size} data-state={state} aria-label={what}>
      <div ref={wrap} className="nb-capture-img">
        <canvas ref={canvas} role="img" aria-label={what} />
        {state === "error" && <p className="nb-capture-wait">This part of page {b.page} is drawn from the paper, which is not open here.</p>}
      </div>
      <figcaption>
        <input className="nb-caption" aria-label={`Caption of the capture from page ${b.page}`} placeholder="Add a caption…" maxLength={NOTEBOOK_LIMITS.caption} value={b.caption} onChange={(e) => onCaption(e.target.value)} />
        <span className="nb-sizes" role="radiogroup" aria-label="Size in the notes">
          {CAPTURE_SIZES.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={b.size === s} aria-label={CAPTURE_SIZE_LABEL[s]} title={CAPTURE_SIZE_LABEL[s]} className="nb-size" onClick={() => onSize(s)}>
              {CAPTURE_SIZE_NAME[s]}
            </button>
          ))}
        </span>
        <button type="button" className="nb-go" onClick={onGo} aria-label={`Show page ${b.page} in the paper`} title="Show this page in the paper">
          p. {b.page} <ArrowUpRight size={13} aria-hidden="true" />
        </button>
      </figcaption>
    </figure>
  );
}

/** A picture added to the notes (paper-reader.md 22): the picture, served to its owner only, and the words that say what it shows (for a screen reader, and for the exports). */
const IMAGE_SIZES = [
  { key: "s", name: "S", label: "Small" },
  { key: "m", name: "M", label: "Medium" },
  { key: "full", name: "Full", label: "Full width" },
] as const;

/**
 * A picture added to the notes (paper-reader.md 22 and 23): the picture, served to its owner only, the words that say what it shows (for a screen reader, and for the exports), and its width.
 * The width is a share of the page (0.2 to 1; its shape is kept, as the height follows): dragged by the handle at its corner (a pointer or a finger), or with the handle focused, ← and → by 5 %
 * and with Shift by 20 %; S, M and Full are quick choices. While it is dragged only the picture changes; the width is kept when it is let go.
 */
export function ImageBlockView({ b, src, onAlt, onWidth }: { b: ImageBlock; src: string; onAlt: (alt: string) => void; onWidth: (width: number) => void }) {
  const [broken, setBroken] = useState(false);
  const [live, setLive] = useState<number | null>(null);
  const liveRef = useRef<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x0: number; w0: number; full: number } | null>(null);
  const width = live ?? b.width ?? 1;
  const pct = Math.round(width * 100);
  const show = (w: number) => {
    liveRef.current = w;
    setLive(w);
  };
  const end = () => {
    const w = liveRef.current;
    drag.current = null;
    liveRef.current = null;
    setLive(null);
    if (w !== null && w !== (b.width ?? 1)) onWidth(w);
  };
  return (
    <figure className="nb-image" aria-label={b.alt ? `A picture: ${b.alt}` : "A picture"}>
      <div ref={box} className="nb-image-box" style={{ width: `${width * 100}%` }} data-resizing={live !== null || undefined}>
        {broken || !src ? (
          <p className="nb-capture-wait">This picture could not be shown. Check the connection, then open the page again.</p>
        ) : (
          <img src={src} alt={b.alt || "A picture in your notes, not described yet"} width={b.w} height={b.h} loading="lazy" decoding="async" onError={() => setBroken(true)} />
        )}
        <span
          className="nb-resize"
          role="slider"
          tabIndex={0}
          aria-label="Width of the picture"
          aria-valuemin={Math.round(IMAGE_WIDTH.min * 100)}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-valuetext={`${pct}% of the page's width`}
          title="Drag to resize (or ← and →)"
          onPointerDown={(e) => {
            const full = box.current?.parentElement?.clientWidth ?? 0;
            if (!full) return;
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { x0: e.clientX, w0: width, full };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (d) show(clampImageWidth(d.w0 + (e.clientX - d.x0) / d.full));
          }}
          onPointerUp={end}
          onPointerCancel={end}
          onKeyDown={(e) => {
            const step = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
            const to = e.key === "Home" ? IMAGE_WIDTH.min : e.key === "End" ? 1 : step ? clampImageWidth(width + step * (e.shiftKey ? 0.2 : 0.05)) : null;
            if (to === null) return;
            e.preventDefault();
            e.stopPropagation();
            if (to !== (b.width ?? 1)) onWidth(to);
          }}
        />
      </div>
      <figcaption>
        <input className="nb-caption" aria-label="What the picture shows" placeholder="Describe the picture…" maxLength={300} value={b.alt} onChange={(e) => onAlt(e.target.value)} />
        <span className="nb-sizes" role="radiogroup" aria-label="Size in the notes">
          {IMAGE_SIZES.map((z) => (
            <button key={z.key} type="button" role="radio" aria-checked={Math.abs(width - IMAGE_SIZE_WIDTH[z.key]) < 0.005} aria-label={z.label} title={z.label} className="nb-size" onClick={() => onWidth(IMAGE_SIZE_WIDTH[z.key])}>
              {z.name}
            </button>
          ))}
        </span>
      </figcaption>
    </figure>
  );
}

/**
 * An agent's answer kept in the notes (phase 3, paper-reader.md 24): a small header with the agent's name and pages ("Explain · p. 3, 4"), what it was asked, the answer (its Markdown, with each
 * citation written as its page), and "p. N" back to the paper for each page it cites. Read-only: it is what the agent said, kept as it was.
 */
export function AgentBlockView({ b, onGo }: { b: AgentBlock; onGo: (page: number) => void }) {
  const pages = [...b.pages].sort((x, y) => x - y);
  return (
    <figure className="nb-agent" aria-label={`${agentHeading(b)}: an answer of the ${NOTEBOOK_AGENT_LABEL[b.agent]} agent`}>
      <header className="nb-agent-head">
        <span className="nb-agent-mark" aria-hidden="true">✦</span>
        <b>{agentHeading(b)}</b>
      </header>
      {b.ask && <p className="nb-agent-ask">{b.agent === "explain" ? "Explained: " : "Asked: "}{b.ask}</p>}
      <div className="nb-agent-md">
        <MdView md={b.md} />
      </div>
      {pages.length > 0 && (
        <figcaption>
          {pages.map((p) => (
            <button key={p} type="button" className="nb-go" onClick={() => onGo(p)} aria-label={`Show page ${p} in the paper`} title="Show this page in the paper">
              p. {p} <ArrowUpRight size={13} aria-hidden="true" />
            </button>
          ))}
        </figcaption>
      )}
    </figure>
  );
}
