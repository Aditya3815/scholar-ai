import { m } from "motion/react";
import { BookOpen, Quote, RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { coverUrl, fetchRemember, useDocs, type Remembered } from "../lib/documents";
import { requestJump } from "../lib/jump";
import { easeOut } from "../lib/motion";
import { setRememberOn, useRememberOn } from "../lib/remember";
import { progressOf } from "../components/papers/DocMeta";

/** The paper the reader opened last and has not finished: one press to be back on their page. */
export function ContinueReading({ onOpen }: { onOpen: (id: string) => void }) {
  const docs = useDocs();
  const doc = useMemo(
    () => [...docs.items].filter((d) => d.status === "ready" && d.openedAt && d.readState !== "done").sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0))[0],
    [docs.items],
  );
  if (!doc) return null;
  const f = progressOf(doc);
  const where = doc.lastPage && doc.lastPage > 1 ? `Page ${doc.lastPage}${doc.pages ? ` of ${doc.pages}` : ""}` : "Not started yet";
  return (
    <m.button type="button" className="hm-continue" onClick={() => onOpen(doc.id)} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: easeOut, delay: 0.3 }}>
      {doc.hasCover ? <img src={coverUrl(doc)} alt="" loading="lazy" decoding="async" /> : <span className="hm-continue-ph" aria-hidden="true"><BookOpen size={20} /></span>}
      <span className="hm-continue-txt">
        <span className="hm-k">Continue reading</span>
        <strong>{doc.title}</strong>
        <span className="hm-meta">{where}{f > 0 && f < 1 ? ` · ${Math.round(f * 100)}% read` : ""}</span>
        {f > 0 && <span className="dc-prog-bar" aria-hidden="true"><span style={{ transform: `scaleX(${f})` }} /></span>}
      </span>
    </m.button>
  );
}

/**
 * One of the reader's own highlights, the same one all day. It is picked on the server from their own papers and goes nowhere else;
 * the person can ask for another, or turn it off here or in Settings.
 */
export function RememberThis({ onOpen }: { onOpen: (id: string) => void }) {
  const on = useRememberOn();
  const [skip, setSkip] = useState(0);
  const [state, setState] = useState<{ h: Remembered; total: number } | null>(null);
  const [off, setOff] = useState(false);

  useEffect(() => {
    if (!on) return;
    let live = true;
    fetchRemember(skip).then(
      (r) => live && setState(r.highlight ? { h: r.highlight, total: r.total } : null),
      () => live && setState(null),
    );
    return () => {
      live = false;
    };
  }, [on, skip]);

  if (off) {
    return (
      <p className="hm-fine" role="status">
        “Remember this?” is off. You can turn it on again in Settings.
      </p>
    );
  }
  if (!on || !state) return null;
  const { h, total } = state;
  return (
    <m.aside className="hm-remember" aria-label="Remember this?" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: easeOut, delay: 0.4 }}>
      <p className="hm-k"><Quote size={13} aria-hidden="true" /> Remember this?</p>
      <blockquote className="hm-rem-q" data-color={h.color}>{h.quote}</blockquote>
      {h.note && <p className="hm-rem-note">Your note: {h.note}</p>}
      <p className="hm-meta">{h.title} · page {h.page}</p>
      <div className="hm-rem-actions">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => { requestJump(h.docId, h.page, h.quote); onOpen(h.docId); }}>Open at page {h.page}</button>
        {total > 1 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSkip((s) => (s + 1) % total)}>
            <RefreshCw size={14} aria-hidden="true" /> Another
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-sm hm-rem-off" onClick={() => { setRememberOn(false); setOff(true); }}>
          <X size={14} aria-hidden="true" /> Turn this off
        </button>
      </div>
    </m.aside>
  );
}
