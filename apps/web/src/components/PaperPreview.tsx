import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, m } from "motion/react";
import { BadgeCheck, ChevronLeft, ChevronRight, ExternalLink, FileText, Hash, LockOpen, MessageSquareText, ShieldAlert, TriangleAlert, X } from "lucide-react";
import { useEffect, useState } from "react";
import { PROVIDER_LABELS, type Paper } from "@scholar/shared";
import { easeOut, spring, springPop, stagger } from "../lib/motion";
import { canAsk, openOaAsk } from "../lib/oa-ask";
import { closePreview, stepPreview, usePreview } from "../lib/preview";
import { WORKSPACE } from "../lib/workspace";
import { CiteMenu, CopyButton } from "./CiteMenu";
import { CountUp, SaveButton } from "./ResultCard";

const sourceName = (s: string) => PROVIDER_LABELS[s as keyof typeof PROVIDER_LABELS] ?? s;

function Authors({ authors }: { authors: string[] }) {
  const [all, setAll] = useState(false);
  if (authors.length === 0) return <p className="pv-authors pv-muted">Authors unavailable</p>;
  const shown = all ? authors : authors.slice(0, 6);
  return (
    <p className="pv-authors">
      {shown.join(", ")}
      {authors.length > 6 && (
        <>
          {all ? " " : " … "}
          <button type="button" className="link-btn pv-more" aria-expanded={all} onClick={() => setAll((v) => !v)}>
            {all ? "Show fewer" : `+${authors.length - 6} more`}
          </button>
        </>
      )}
    </p>
  );
}

/** A rise-in block: the sheet's content settles in piece by piece instead of appearing all at once. */
const rise = (i: number) => ({ initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.4, ease: easeOut, delay: 0.08 + stagger(i, 0.05) } });

function Body({ paper }: { paper: Paper }) {
  const doiHref = paper.doi ? `https://doi.org/${paper.doi}` : null;
  const crossChecked = paper.sources.length >= 2;
  return (
    <div className="pv-body">
      {paper.retracted && (
        <m.div className="retract" role="alert" initial={{ opacity: 0, x: 0 }} animate={{ opacity: 1, x: [0, -6, 6, -4, 4, 0] }} transition={{ duration: 0.5, delay: 0.15 }}>
          <ShieldAlert size={18} aria-hidden="true" />
          <div>
            <strong>Retracted paper.</strong> Do not cite without reading the retraction notice.
            <span className="retract-src"> Flagged by {paper.retractionSources.map((s) => s.replace("crossref-retraction-watch", "Crossref / Retraction Watch").replace("openalex", "OpenAlex")).join(" + ")}.</span>
          </div>
        </m.div>
      )}

      <m.div className="pv-meta" {...rise(0)}>
        {paper.year && <span className="pv-year">{paper.year}</span>}
        {paper.venue && <span className="pv-venue">{paper.venue}</span>}
      </m.div>

      <m.h2 className="pv-title" {...rise(1)}>
        {paper.title}
      </m.h2>
      <m.div {...rise(2)}>
        <Authors authors={paper.authors} />
      </m.div>

      <m.div className="badges" {...rise(3)}>
        <span className={`badge ${crossChecked ? "badge-ok" : ""}`}>
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
          <span className="badge badge-warn">
            <TriangleAlert size={14} aria-hidden="true" /> DOI removed: could not be verified
          </span>
        )}
      </m.div>

      <m.section className="pv-section" aria-label="Abstract" {...rise(4)}>
        <h3 className="pv-h">Abstract</h3>
        {paper.abstract ? (
          <p className="reading pv-abstract">{paper.abstract}</p>
        ) : (
          <p className="pv-muted">None of our sources has an abstract for this paper. Open the DOI or the full text to read it.</p>
        )}
      </m.section>

      <m.section className="pv-section" aria-label="Identifiers" {...rise(5)}>
        <h3 className="pv-h">Where it comes from</h3>
        <dl className="pv-ids">
          {doiHref && (
            <div>
              <dt>DOI</dt>
              <dd>
                <a href={doiHref} target="_blank" rel="noreferrer noopener">{paper.doi}</a>
                <CopyIcon text={paper.doi!} label="Copy DOI" />
              </dd>
            </div>
          )}
          {paper.pmid && (
            <div>
              <dt>PubMed</dt>
              <dd>
                <a href={`https://pubmed.ncbi.nlm.nih.gov/${paper.pmid}/`} target="_blank" rel="noreferrer noopener">{paper.pmid}</a>
              </dd>
            </div>
          )}
          <div>
            <dt>Sources</dt>
            <dd>{paper.sources.map(sourceName).join(", ")}</dd>
          </div>
        </dl>
      </m.section>

      <m.div className="actions pv-actions" {...rise(6)}>
        {WORKSPACE && canAsk(paper) && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => { closePreview(); openOaAsk(paper); }}>
            <MessageSquareText size={15} aria-hidden="true" />
            <span>Ask this paper</span>
          </button>
        )}
        <SaveButton paper={paper} />
        <CiteMenu paper={paper} />
        {doiHref && (
          <a className="btn btn-ghost btn-sm" href={doiHref} target="_blank" rel="noreferrer noopener">
            <ExternalLink size={15} aria-hidden="true" />
            <span>Open DOI</span>
          </a>
        )}
        {paper.oaUrl && (
          <a className="btn btn-ghost btn-sm" href={paper.oaUrl} target="_blank" rel="noreferrer noopener">
            <FileText size={15} aria-hidden="true" />
            <span>Full text</span>
          </a>
        )}
      </m.div>
    </div>
  );
}

/** Small copy button for an identifier: the icon swaps to a check for a moment. */
function CopyIcon({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(() => setDone(false), 1500);
    return () => window.clearTimeout(t);
  }, [done]);
  return (
    <button
      type="button"
      className="pv-copy"
      aria-label={done ? "Copied" : label}
      title={label}
      onClick={() => navigator.clipboard?.writeText(text).then(() => setDone(true), () => {})}
    >
      <AnimatePresence mode="wait" initial={false}>
        <m.span key={String(done)} initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }} transition={springPop} className="btn-ico">
          {done ? <BadgeCheck size={15} aria-hidden="true" /> : <Hash size={15} aria-hidden="true" />}
        </m.span>
      </AnimatePresence>
    </button>
  );
}

/** Side sheet that shows one paper in full. Arrow keys (or the buttons) step through the list it was opened from. */
export function PaperPreview() {
  const { open, items, index, dir } = usePreview();
  const paper = items[index];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowRight" || e.key === "j") stepPreview(1);
      else if (e.key === "ArrowLeft" || e.key === "k") stepPreview(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && closePreview()}>
      <AnimatePresence>
        {open && paper && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <m.div className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: easeOut }} />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby={undefined}>
              <m.aside className="drawer pv-sheet" initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%", transition: { duration: 0.2 } }} transition={spring}>
                <header className="pv-head">
                  <Dialog.Title className="pv-kicker">
                    Paper preview
                    {items.length > 1 && (
                      <span className="pv-pos" aria-live="polite">
                        {index + 1} of {items.length}
                      </span>
                    )}
                  </Dialog.Title>
                  <div className="pv-nav">
                    {items.length > 1 && (
                      <>
                        <button type="button" className="icon-btn" aria-label="Previous paper" disabled={index === 0} onClick={() => stepPreview(-1)}>
                          <ChevronLeft size={18} aria-hidden="true" />
                        </button>
                        <button type="button" className="icon-btn" aria-label="Next paper" disabled={index === items.length - 1} onClick={() => stepPreview(1)}>
                          <ChevronRight size={18} aria-hidden="true" />
                        </button>
                      </>
                    )}
                    <Dialog.Close className="icon-btn" aria-label="Close preview">
                      <X size={18} aria-hidden="true" />
                    </Dialog.Close>
                  </div>
                </header>
                <div className="pv-scroll">
                  <AnimatePresence mode="wait" initial={false} custom={dir}>
                    <m.div key={paper.id} custom={dir} initial={{ opacity: 0, x: dir * 28 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: dir * -28, transition: { duration: 0.12 } }} transition={{ duration: 0.25, ease: easeOut }}>
                      <Body paper={paper} />
                    </m.div>
                  </AnimatePresence>
                </div>
                {items.length > 1 && <p className="pv-hint">Use <kbd>←</kbd> <kbd>→</kbd> to move between papers.</p>}
              </m.aside>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
