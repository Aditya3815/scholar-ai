import { m } from "motion/react";
import { AlertCircle, FileText, HardDrive, Loader2, Pencil, RefreshCw, ScanLine, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DocumentInfo } from "@scholar/shared";
import { continueScan, coverUrl, reindexDoc, renameDoc, useJobs } from "../../lib/documents";
import { easeOut, stagger } from "../../lib/motion";
import { showNotice } from "../../lib/notice";
import { DocMeta, TagChips, progressOf } from "./DocMeta";

const size = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const when = (t: number) => new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

function Cover({ doc }: { doc: DocumentInfo }) {
  const [broken, setBroken] = useState(false);
  const [loaded, setLoaded] = useState(false);
  return (
    <span className="dc-cover" data-status={doc.status}>
      {doc.hasCover && !broken ? (
        <img src={coverUrl(doc)} alt="" loading="lazy" decoding="async" data-loaded={loaded} onLoad={() => setLoaded(true)} onError={() => setBroken(true)} />
      ) : (
        <span className="dc-cover-fallback" aria-hidden="true">
          <FileText size={30} />
        </span>
      )}
      {doc.status === "ready" ? null : (
        <span className="dc-overlay" aria-hidden="true">
          {doc.status === "failed" ? <AlertCircle size={22} /> : <Loader2 className="spin" size={22} />}
        </span>
      )}
    </span>
  );
}

function Title({ doc }: { doc: DocumentInfo }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(doc.title);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setValue(doc.title), [doc.title]);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  async function save() {
    const next = value.replace(/\s+/g, " ").trim();
    setEditing(false);
    if (!next || next === doc.title) return setValue(doc.title);
    try {
      await renameDoc(doc.id, next);
    } catch {
      setValue(doc.title);
      showNotice("The title could not be changed. Please try again.");
    }
  }

  if (editing) {
    return (
      <form className="dc-edit" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <label className="sr-only" htmlFor={`t-${doc.id}`}>Paper title</label>
        <input
          id={`t-${doc.id}`}
          ref={input}
          value={value}
          maxLength={200}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => void save()}
          onKeyDown={(e) => { if (e.key === "Escape") { setValue(doc.title); setEditing(false); } }}
        />
      </form>
    );
  }
  return (
    <span className="dc-title-row">
      <span className="dc-title"><span className="dc-title-t">{doc.title}</span></span>
      <button type="button" className="dc-rename" aria-label={`Rename ${doc.title}`} title="Rename" onClick={() => setEditing(true)}>
        <Pencil size={14} aria-hidden="true" />
      </button>
    </span>
  );
}

/** A thin bar for how far the paper has been read, with the words next to it (so it is not only colour). Nothing is drawn for a paper that has not been started. */
function Progress({ doc }: { doc: DocumentInfo }) {
  const f = progressOf(doc);
  if (f === 0) return null;
  const label = doc.readState === "done" ? "Finished" : `Page ${doc.maxPage} of ${doc.pages} · ${Math.round(f * 100)}%`;
  return (
    <div className="dc-prog" role="img" aria-label={label}>
      <span className="dc-prog-bar" aria-hidden="true"><span style={{ transform: `scaleX(${f})` }} /></span>
      <span className="dc-prog-t" aria-hidden="true">{label}</span>
    </div>
  );
}

export function DocCard({ doc, index, onOpen, onDelete, onTag, activeTag, kept = false }: { doc: DocumentInfo; index: number; onOpen: (id: string) => void; onDelete: (doc: DocumentInfo) => void; onTag?: (t: string) => void; activeTag?: string | null; /** The paper's file is kept on this device (offline reading). */ kept?: boolean }) {
  const ready = doc.status === "ready";
  // a scanned paper that is part way: its pages are read from the picture, so it can be carried on
  const scanLeft = doc.scanned && doc.status !== "ready" && doc.scanPending > 0;
  const busy = useJobs().some((j) => j.docId === doc.id && ["reading", "uploading", "indexing", "scanning"].includes(j.step));
  return (
    <m.li
      className="card dc dc-ws"
      data-status={doc.status}
      layout="position"
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.18 } }}
      transition={{ duration: 0.4, ease: easeOut, delay: stagger(index, 0.05, 6) }}
      whileHover={{ y: -4 }}
    >
      <button type="button" className="dc-open" onClick={() => onOpen(doc.id)} aria-label={`Open ${doc.title}`}>
        <Cover doc={doc} />
      </button>
      <div
        className="dc-body"
        // a click anywhere on the card opens the paper (buttons keep their own job); the cover button is the keyboard way in
        onClick={(e) => { const el = e.target as HTMLElement; /* a popover is drawn elsewhere in the page but its clicks still reach this card in React: only clicks inside the card count */ if (e.currentTarget.contains(el) && !el.closest("button, a, input, label")) onOpen(doc.id); }}
      >
        <Title doc={doc} />
        <p className="dc-meta">
          {doc.pages ? `${doc.pages} ${doc.pages === 1 ? "page" : "pages"} · ` : ""}
          {size(doc.sizeBytes)} · {when(doc.createdAt)}
          {doc.scanned && (
            <span className="dc-scan" title="The text of this paper was read from page pictures">
              {" "}· <ScanLine size={12} aria-hidden="true" /> Scan
            </span>
          )}
        </p>

        {ready && <Progress doc={doc} />}
        <TagChips tags={doc.tags} active={activeTag} onPick={onTag} />

        {doc.status === "failed" && <p className="dc-note" data-tone="warn">{doc.error ?? "Indexing failed."}</p>}
        {scanLeft && <p className="dc-note">{doc.scanPending} scanned {doc.scanPending === 1 ? "page" : "pages"} still to be read. What has been read is kept.</p>}
        {!scanLeft && (doc.status === "uploaded" || doc.status === "indexing") && <p className="dc-note">Not indexed yet. Open it to see the pages, or index it again.</p>}

        <div className="dc-actions">
          {/* the cover opens the paper (decision of 24 Oct: no "Open and ask" button) */}
          {ready && <DocMeta doc={doc} />}
          {kept && <span className="dc-offline" title="Kept on this device: it opens without a connection"><HardDrive size={11} aria-hidden="true" /> On this device</span>}
          {!ready && (
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void (scanLeft ? continueScan(doc) : reindexDoc(doc))}>
              <RefreshCw size={14} aria-hidden="true" />
              <span>{scanLeft ? "Continue reading" : "Index again"}</span>
            </button>
          )}
          <button type="button" className="icon-btn icon-btn-sm dc-del" aria-label={`Delete ${doc.title}`} title="Delete" onClick={() => onDelete(doc)}>
            <Trash2 size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
    </m.li>
  );
}
