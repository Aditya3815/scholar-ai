import { ArrowUpRight } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { CAPTURE_SIZES, NOTEBOOK_LIMITS, parseNotebookMd, type CaptureBlock, type CaptureSize, type ImageBlock, type MdInline, type QuoteBlock, type TextBlock } from "@scholar/shared";
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
    return (
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
      />
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
export function ImageBlockView({ b, src, onAlt }: { b: ImageBlock; src: string; onAlt: (alt: string) => void }) {
  const [broken, setBroken] = useState(false);
  return (
    <figure className="nb-image" aria-label={b.alt ? `A picture: ${b.alt}` : "A picture"}>
      {broken || !src ? (
        <p className="nb-capture-wait">This picture could not be shown. Check the connection, then open the page again.</p>
      ) : (
        <img src={src} alt={b.alt || "A picture in your notes, not described yet"} width={b.w} height={b.h} loading="lazy" decoding="async" onError={() => setBroken(true)} />
      )}
      <figcaption>
        <input className="nb-caption" aria-label="What the picture shows" placeholder="Describe the picture…" maxLength={300} value={b.alt} onChange={(e) => onAlt(e.target.value)} />
      </figcaption>
    </figure>
  );
}
