import { animate, m, useReducedMotion } from "motion/react";
import { PROVIDER_LABELS, textAttrs, type Paper } from "@scholar/shared";
import { BadgeCheck, Bookmark, BookmarkCheck, Eye, ExternalLink, FileText, GraduationCap, LockOpen, MessageSquareText, ShieldAlert, TriangleAlert } from "lucide-react";
import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { easeOut, springPop, stagger } from "../lib/motion";
import { toggleSaved, useLibrary } from "../lib/library";
import { canAsk, openOaAsk } from "../lib/oa-ask";
import { CiteMenu } from "./CiteMenu";

// one formatter for every card: `toLocaleString` makes a new one on every call (about 0.3 ms each at a processor four times slower: a long conversation has four hundred cards)
const inIndia = new Intl.NumberFormat("en-IN");
const fmt = (n: number) => inIndia.format(n);

/** Citation count pehli baar dikhne par 0 se count-up hota hai (reduced motion mein seedha final). `still`: seedha final (a card that was only opened, not found just now). */
export function CountUp({ value, still = false }: { value: number; still?: boolean }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // a card that is still (reduced motion, or its reply is over) shows the final number, and a card that BECOMES still while it is counting (the reply was stopped or ended in the frames after the cards
    // appeared) goes to the final number too: the cleanup of the effect below stops the count where it stands, and the text was written by it and not by React, which never writes it again
    if (reduce || still) {
      const final = fmt(value);
      if (el.textContent !== final) el.textContent = final; // (a card that was drawn still is already right: nothing is written for the four hundred cards of a long chat)
      return;
    }
    const controls = animate(0, value, {
      duration: Math.min(0.9, 0.35 + value / 20000),
      ease: easeOut,
      onUpdate: (v) => {
        el.textContent = fmt(Math.round(v));
      },
    });
    return () => controls.stop();
  }, [value, reduce, still]);
  return <span ref={ref}>{fmt(value)}</span>;
}

export function SaveButton({ paper }: { paper: Paper }) {
  const saved = useLibrary().some((p) => p.id === paper.id);
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      aria-pressed={saved}
      onClick={() => toggleSaved(paper)}
      title={saved ? "Remove from library" : "Save to library"}
    >
      <m.span key={String(saved)} className="btn-ico" initial={{ scale: 0.5, y: 4 }} animate={{ scale: 1, y: 0 }} transition={springPop}>
        {saved ? <BookmarkCheck size={15} aria-hidden="true" /> : <Bookmark size={15} aria-hidden="true" />}
      </m.span>
      <span>{saved ? "Saved" : "Save"}</span>
    </button>
  );
}

/** The host of a web address (http or https only), or null for anything else. */
function webHost(url: string | null | undefined): string | null {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

const authorLine = (authors: string[]) =>
  authors.length === 0 ? "Authors unavailable" : authors.length <= 4 ? authors.join(", ") : `${authors.slice(0, 3).join(", ")} et al.`;

type ResultCardProps = { paper: Paper; index: number; onPreview?: (p: Paper) => void; extra?: ReactNode; /** shown under the abstract (Idea Check: how the paper relates to the idea) */ below?: ReactNode; /** In a chat: the number of the paper in its list (the answer's [n] marks point at it), its address on the page, and whether it is being pointed at now. */ anchor?: { id: string; number: number; flash: boolean };
  /**
   * A card of a reply that is finished (or that was only opened, from the browser's storage): it does not glide to a new place when the cards around it move, and its citation count is shown at once and not
   * counted up. Both are for cards that arrive as a reply is written; on a card of a conversation of twenty replies they were four hundred layout measurements and four hundred animations for every
   * time one was opened. Not set (a card that arrives, as everywhere else) by default.
   */
  settled?: boolean;
};

/**
 * Whether a card is the card it was: the same paper, place and functions, and an anchor that says the same (a conversation builds the anchor again for every render of its list, and a card that is drawn
 * again for a new object with the same words is exactly the cost a long conversation cannot bear: twenty replies of twenty cards). `extra` and `below` are elements, new for every render of whatever makes them
 * (Idea Check), so a card that has them is drawn as it always was.
 */
const sameCard = (a: ResultCardProps, b: ResultCardProps) =>
  a.paper === b.paper && a.index === b.index && a.settled === b.settled && a.onPreview === b.onPreview && a.extra === b.extra && a.below === b.below && (a.anchor === b.anchor || (!!a.anchor && !!b.anchor && a.anchor.id === b.anchor.id && a.anchor.number === b.anchor.number && a.anchor.flash === b.anchor.flash));

/** `extra` is shown with the badges: Idea Check uses it to say which searches found the paper. */
export const ResultCard = memo(function ResultCard({ paper, index, onPreview, extra, below, anchor, settled = false }: ResultCardProps) {
  const [open, setOpen] = useState(false);
  const doiHref = paper.doi ? `https://doi.org/${paper.doi}` : null;
  // a record with no DOI may still have its own page (a thesis on Shodhganga); the server only passes http(s) addresses, and the browser checks again
  const host = doiHref ? null : webHost(paper.url);
  const page = host ? paper.url! : null;
  const pageName = host && /(^|\.)shodhganga\.inflibnet\.ac\.in$/i.test(host) ? "Shodhganga" : "Record";
  const thesis = paper.workType === "dissertation";
  const crossChecked = paper.sources.length >= 2;
  const authors = authorLine(paper.authors);

  return (
    <m.li
      className="card result"
      id={anchor?.id}
      data-n={anchor?.number}
      data-flash={anchor?.flash}
      data-retracted={paper.retracted}
      layout={settled ? undefined : "position"}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.38, ease: easeOut, delay: stagger(index) }}
    >
      {paper.retracted && (
        <m.div
          className="retract"
          role="alert"
          initial={{ opacity: 0, x: 0 }}
          animate={{ opacity: 1, x: [0, -6, 6, -4, 4, 0] }}
          transition={{ duration: 0.5, delay: 0.15 }}
        >
          <ShieldAlert size={18} aria-hidden="true" />
          <div>
            <strong>Retracted paper.</strong> Do not cite without reading the retraction notice.
            <span className="retract-src"> Flagged by {paper.retractionSources.map((s) => s.replace("crossref-retraction-watch", "Crossref / Retraction Watch").replace("openalex", "OpenAlex")).join(" + ")}.</span>
          </div>
        </m.div>
      )}

      <div className="result-meta">
        {anchor && <span className="result-no" aria-label={`Paper ${anchor.number}`}>{anchor.number}</span>}
        {paper.year && <span>{paper.year}</span>}
        {paper.venue && <span className="result-venue" {...textAttrs(paper.venue)}>{paper.venue}</span>}
      </div>

      <h3 className="result-title" {...textAttrs(paper.title)}>
        {doiHref || page ? (
          <a href={doiHref ?? page!} target="_blank" rel="noreferrer noopener">
            {paper.title}
          </a>
        ) : (
          paper.title
        )}
      </h3>
      <p className="result-authors" {...textAttrs(authors)}>{authors}</p>

      <div className="badges">
        {thesis && (
          <span className="badge badge-info" title="A doctoral or master's thesis. Theses on Shodhganga are listed without an abstract, so the short answer is not made from them.">
            <GraduationCap size={14} aria-hidden="true" /> Thesis
          </span>
        )}
        <span className={`badge ${crossChecked ? "badge-ok" : ""}`} title={`From: ${paper.sources.map((s) => PROVIDER_LABELS[s as keyof typeof PROVIDER_LABELS] ?? s).join(", ")}`}>
          <BadgeCheck size={14} aria-hidden="true" />
          {crossChecked ? `Cross-checked · ${paper.sources.length} sources` : "1 source"}
        </span>
        {paper.citationCount != null && (
          <span className="badge">
            <CountUp value={paper.citationCount} still={settled} /> citations
          </span>
        )}
        {paper.oaUrl && (
          <span className="badge badge-info">
            <LockOpen size={14} aria-hidden="true" /> Open access
          </span>
        )}
        {extra}
        {paper.doiStatus?.startsWith("dropped") && (
          <span
            className="badge badge-warn"
            title={paper.doiStatus === "dropped_unresolvable" ? "A source listed a DOI for this paper, but that DOI does not exist, so it was removed." : "A source listed a DOI that belongs to a different record, so it was removed."}
          >
            <TriangleAlert size={14} aria-hidden="true" /> DOI removed: could not be verified
          </span>
        )}
      </div>

      {paper.abstract && (
        <div className="abstract-wrap">
          <m.p key={String(open)} className={`reading abstract ${open ? "" : "clamp"}`} {...textAttrs(paper.abstract)} initial={{ opacity: 0.4 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
            {paper.abstract}
          </m.p>
          {paper.abstract.length > 260 && (
            <button type="button" className="link-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              {open ? "Show less" : "Read abstract"}
            </button>
          )}
        </div>
      )}

      {below}

      <div className="actions">
        {onPreview && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onPreview(paper)} aria-label={`Preview: ${paper.title}`}>
            <Eye size={15} aria-hidden="true" />
            <span>Preview</span>
          </button>
        )}
        {canAsk(paper) && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openOaAsk(paper)} aria-label={`Ask this paper: ${paper.title}`}>
            <MessageSquareText size={15} aria-hidden="true" />
            <span>Ask this paper</span>
          </button>
        )}
        <SaveButton paper={paper} />
        <CiteMenu paper={paper} />
        {doiHref && (
          <a className="btn btn-ghost btn-sm" href={doiHref} target="_blank" rel="noreferrer noopener">
            <ExternalLink size={15} aria-hidden="true" />
            <span>DOI</span>
          </a>
        )}
        {page && (
          <a className="btn btn-ghost btn-sm" href={page} target="_blank" rel="noreferrer noopener" aria-label={`Open on ${pageName === "Record" ? "the record's page" : pageName}: ${paper.title}`}>
            <ExternalLink size={15} aria-hidden="true" />
            <span>{pageName}</span>
          </a>
        )}
        {paper.oaUrl && (
          <a className="btn btn-ghost btn-sm" href={paper.oaUrl} target="_blank" rel="noreferrer noopener">
            <FileText size={15} aria-hidden="true" />
            <span>Full text</span>
          </a>
        )}
      </div>
    </m.li>
  );
}, sameCard);

export function SkeletonCard() {
  return (
    <li className="card result skeleton" aria-hidden="true">
      <span className="sk sk-s" />
      <span className="sk sk-title" />
      <span className="sk sk-m" />
      <span className="sk sk-body" />
      <span className="sk sk-body sk-short" />
    </li>
  );
}
