import { animate, m, useReducedMotion } from "motion/react";
import { PROVIDER_LABELS, type Paper } from "@scholar/shared";
import { BadgeCheck, Bookmark, BookmarkCheck, Eye, ExternalLink, FileText, LockOpen, ShieldAlert, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { easeOut, springPop, stagger } from "../lib/motion";
import { toggleSaved, useLibrary } from "../lib/library";
import { CiteMenu } from "./CiteMenu";

const fmt = (n: number) => n.toLocaleString("en-IN");

/** Citation count pehli baar dikhne par 0 se count-up hota hai (reduced motion mein seedha final). */
export function CountUp({ value }: { value: number }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || reduce) return;
    const controls = animate(0, value, {
      duration: Math.min(0.9, 0.35 + value / 20000),
      ease: easeOut,
      onUpdate: (v) => {
        el.textContent = fmt(Math.round(v));
      },
    });
    return () => controls.stop();
  }, [value, reduce]);
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

const authorLine = (authors: string[]) =>
  authors.length === 0 ? "Authors unavailable" : authors.length <= 4 ? authors.join(", ") : `${authors.slice(0, 3).join(", ")} et al.`;

export function ResultCard({ paper, index, onPreview }: { paper: Paper; index: number; onPreview?: (p: Paper) => void }) {
  const [open, setOpen] = useState(false);
  const doiHref = paper.doi ? `https://doi.org/${paper.doi}` : null;
  const crossChecked = paper.sources.length >= 2;

  return (
    <m.li
      className="card result"
      data-retracted={paper.retracted}
      layout="position"
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
        {paper.year && <span>{paper.year}</span>}
        {paper.venue && <span className="result-venue">{paper.venue}</span>}
      </div>

      <h3 className="result-title">
        {doiHref ? (
          <a href={doiHref} target="_blank" rel="noreferrer noopener">
            {paper.title}
          </a>
        ) : (
          paper.title
        )}
      </h3>
      <p className="result-authors">{authorLine(paper.authors)}</p>

      <div className="badges">
        <span className={`badge ${crossChecked ? "badge-ok" : ""}`} title={`From: ${paper.sources.map((s) => PROVIDER_LABELS[s as keyof typeof PROVIDER_LABELS] ?? s).join(", ")}`}>
          <BadgeCheck size={14} aria-hidden="true" />
          {crossChecked ? `Cross-checked · ${paper.sources.length} sources` : "1 source"}
        </span>
        {paper.citationCount != null && (
          <span className="badge">
            <CountUp value={paper.citationCount} /> citations
          </span>
        )}
        {paper.oaUrl && (
          <span className="badge badge-info">
            <LockOpen size={14} aria-hidden="true" /> Open access
          </span>
        )}
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
          <m.p key={String(open)} className={`reading abstract ${open ? "" : "clamp"}`} initial={{ opacity: 0.4 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
            {paper.abstract}
          </m.p>
          {paper.abstract.length > 260 && (
            <button type="button" className="link-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              {open ? "Show less" : "Read abstract"}
            </button>
          )}
        </div>
      )}

      <div className="actions">
        {onPreview && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onPreview(paper)} aria-label={`Preview: ${paper.title}`}>
            <Eye size={15} aria-hidden="true" />
            <span>Preview</span>
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
        {paper.oaUrl && (
          <a className="btn btn-ghost btn-sm" href={paper.oaUrl} target="_blank" rel="noreferrer noopener">
            <FileText size={15} aria-hidden="true" />
            <span>Full text</span>
          </a>
        )}
      </div>
    </m.li>
  );
}

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
