import { m } from "motion/react";
import "./reader-parts.css";
import type { PaperAccess } from "@scholar/shared";
import { ArrowLeft, FileWarning, Pencil, RotateCw, WifiOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Answer, DocumentInfo, OutlineItem, PaperInfo, ScanInfo } from "@scholar/shared";
import { renameDoc } from "../../lib/documents";
import { showNotice } from "../../lib/notice";
import { spring } from "../../lib/motion";
import { PAPERS_NAME } from "../../lib/workspace";
import type { PDFDocumentProxy, PdfErrorKind } from "../../lib/pdf";

/* The pieces both readers draw the same (today's, DocWorkspace, and the new one, desk/Desk.tsx): moved here unchanged from DocWorkspace.tsx so that the new reader's chunk can use them. */

export type Load = { status: "loading" } | { status: "error"; message: string; notFound?: boolean; /** what the browser said */ detail?: string; /** the connection failed (worth trying again; tried again by itself when back online) */ network?: boolean } | { status: "ready"; doc: DocumentInfo; history: Answer[]; info: PaperInfo | null; scan: ScanInfo | null; /** the new Paper Reader (READER, told by the server with the paper) */ reader?: boolean; /** a paper shared with this person (docs/design/paper-share.md); null: their own */ access?: PaperAccess | null; /** the owner may share it (SHARE) */ canShare?: boolean; /** live presence and updates (LIVE, docs/design/paper-live.md) */ live?: boolean };
export type Pdf = { status: "loading"; progress: number } | { status: "error"; message: string; detail?: string; kind?: PdfErrorKind | "offline" } | { status: "ready"; pdf: PDFDocumentProxy };

export function TitleEditor({ doc, onChange }: { doc: DocumentInfo; onChange: (d: DocumentInfo) => void }) {
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
      onChange({ ...doc, title: next });
    } catch {
      setValue(doc.title);
      showNotice("The title could not be changed. Please try again.");
    }
  }
  return editing ? (
    <form className="dw-title-edit" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <label className="sr-only" htmlFor="dw-title">Paper title</label>
      <input id="dw-title" ref={input} value={value} maxLength={200} onChange={(e) => setValue(e.target.value)} onBlur={() => void save()} onKeyDown={(e) => { if (e.key === "Escape") { setValue(doc.title); setEditing(false); } }} />
    </form>
  ) : (
    <h1 className="dw-title">
      <span>{doc.title}</span>
      <button type="button" className="dc-rename" aria-label="Rename this paper" title="Rename" onClick={() => setEditing(true)}>
        <Pencil size={14} aria-hidden="true" />
      </button>
    </h1>
  );
}

/** Bookmarks when the PDF has a few, otherwise detected headings (and say which, because detected ones can be incomplete). */
export function contentsOf(info: PaperInfo | null): { items: OutlineItem[]; detected: boolean } | undefined {
  if (!info) return undefined;
  const outline = info.outline.filter((o) => o.page >= 1);
  if (outline.length >= 3) return { items: outline, detected: false };
  const headings = info.headings.filter((o) => o.page >= 1);
  return headings.length >= 2 ? { items: headings, detected: true } : undefined;
}

export const authorsLine = (a: string[]) => (a.length <= 3 ? a.join(", ") : `${a.slice(0, 3).join(", ")} et al.`);

export function OpeningPaper({ progress }: { progress: number }) {
  return (
    <div className="dw-opening" role="status" aria-live="polite">
      <svg className="dw-ring" width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
        <circle cx="28" cy="28" r="24" fill="none" stroke="var(--border)" strokeWidth="4" />
        <m.circle cx="28" cy="28" r="24" fill="none" stroke="var(--accent)" strokeWidth="4" strokeLinecap="round" transform="rotate(-90 28 28)" initial={false} animate={{ pathLength: Math.max(0.08, progress) }} transition={spring} />
      </svg>
      <p>Opening the paper{progress > 0 ? ` · ${Math.round(progress * 100)}%` : "…"}</p>
    </div>
  );
}

/** Said when the browser is offline: the page tries again by itself when the connection is back. */
export const OFFLINE_WORDS = "You're offline. The paper will load as soon as you're back online.";

/**
 * A paper (or its file) that could not be loaded, in both readers: words for people, the browser's own words tucked under "Technical details", and three ways on: Try again (fetches
 * again, no reload), Reload page (a stale page after a deploy) and Back to the list. Offline, it says so; the caller tries again when the `online` event comes.
 */
export function LoadFailed({ title = "We couldn't load this paper", message, detail, offline = false, reloadFirst = false, onRetry, onBack, backLabel }: { title?: string; message: string; detail?: string; offline?: boolean; /** a stale page: Reload page is the main button */ reloadFirst?: boolean; onRetry?: () => void; onBack?: () => void; backLabel?: string }) {
  const reload = (
    <button type="button" className={onRetry && !reloadFirst ? "btn btn-ghost" : "btn btn-primary"} onClick={() => location.reload()}>
      Reload page
    </button>
  );
  return (
    <div className="empty load-failed" role="alert" data-offline={offline || undefined}>
      {offline ? <WifiOff size={28} aria-hidden="true" /> : <FileWarning size={28} aria-hidden="true" />}
      <p className="empty-title">{offline ? "You're offline" : title}</p>
      {/* the words people see are often "<title>. <what to do>": the title is said once */}
      <p>{offline ? OFFLINE_WORDS : message.startsWith(`${title}. `) ? message.slice(title.length + 2) : message}</p>
      <div className="empty-actions">
        {reloadFirst && reload}
        {onRetry && (
          <button type="button" className={reloadFirst ? "btn btn-ghost" : "btn btn-primary"} onClick={onRetry}>
            <RotateCw size={16} aria-hidden="true" />
            <span>Try again</span>
          </button>
        )}
        {!reloadFirst && reload}
        {onBack && (
          <button type="button" className="link-btn load-back" onClick={onBack}>
            <ArrowLeft size={15} aria-hidden="true" />
            <span>{backLabel}</span>
          </button>
        )}
      </div>
      {detail && (
        <details className="load-detail">
          <summary>Technical details</summary>
          <code>{detail}</code>
        </details>
      )}
    </div>
  );
}

/** The paper's file could not be opened (both readers): Try again only where it can help (not for a password or a file that is not a PDF). */
export function PdfFailed({ pdf, onRetry, onBack }: { pdf: Extract<Pdf, { status: "error" }>; onRetry: () => void; onBack: () => void }) {
  const retry = pdf.kind !== "password" && pdf.kind !== "invalid" && pdf.kind !== "missing";
  return <LoadFailed title={retry ? "We couldn't load this paper" : "The paper could not be shown"} message={pdf.message} detail={pdf.detail} offline={pdf.kind === "offline"} reloadFirst={pdf.kind === "chunk"} onRetry={retry ? onRetry : undefined} onBack={onBack} backLabel={`Back to ${PAPERS_NAME}`} />;
}
