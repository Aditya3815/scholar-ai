import { m } from "motion/react";
import { Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Answer, DocumentInfo, OutlineItem, PaperInfo, ScanInfo } from "@scholar/shared";
import { renameDoc } from "../../lib/documents";
import { showNotice } from "../../lib/notice";
import { spring } from "../../lib/motion";
import type { PDFDocumentProxy } from "../../lib/pdf";

/* The pieces both readers draw the same (today's, DocWorkspace, and the new one, desk/Desk.tsx): moved here unchanged from DocWorkspace.tsx so that the new reader's chunk can use them. */

export type Load = { status: "loading" } | { status: "error"; message: string; notFound?: boolean } | { status: "ready"; doc: DocumentInfo; history: Answer[]; info: PaperInfo | null; scan: ScanInfo | null; /** the new Paper Reader (READER, told by the server with the paper) */ reader?: boolean };
export type Pdf = { status: "loading"; progress: number } | { status: "error"; message: string } | { status: "ready"; pdf: PDFDocumentProxy };

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
