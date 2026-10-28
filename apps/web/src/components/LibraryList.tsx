import { AnimatePresence, m } from "motion/react";
import { Download, ShieldAlert, Trash2 } from "lucide-react";
import { formatCitation } from "../lib/cite";
import { downloadText } from "../lib/download";
import { removeSaved, type SavedPaper } from "../lib/library";
import { CopyButton } from "./CiteMenu";

export const libraryNote = (signedIn: boolean) =>
  signedIn ? "Synced to your account, so it follows you to any device." : "Saved on this device only. Sign in to keep it across devices; anything saved here moves into your account.";

/** The saved records with Copy BibTeX, the .bib download and Remove. Used on the Library page. */
export function LibraryList({ items, onOpen }: { items: SavedPaper[]; onOpen: (p: SavedPaper) => void }) {
  const bib = items.map((p) => formatCitation(p, "bibtex")).join("\n\n");
  return (
    <>
    {items.length === 0 ? (
      <div className="empty">
        <p className="empty-title">Nothing saved yet</p>
        <p>Use the Save button on any result and it will appear here.</p>
      </div>
    ) : (
      <>
        <div className="drawer-actions">
          <CopyButton text={bib} label="Copy all BibTeX" />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => downloadText("library.bib", bib, "application/x-bibtex;charset=utf-8")}>
            <Download size={15} aria-hidden="true" />
            <span>.bib file</span>
          </button>
        </div>
        <ul className="drawer-list">
          <AnimatePresence initial={false}>
            {items.map((p) => (
              <m.li key={p.id} className="drawer-item" layout exit={{ opacity: 0, x: 40, transition: { duration: 0.18 } }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                <div>
                  <button type="button" className="drawer-item-title drawer-item-open" onClick={() => onOpen(p)}>
                    {p.title}
                  </button>
                  {p.retracted && (
                    <p className="drawer-item-retracted">
                      <ShieldAlert size={14} aria-hidden="true" />
                      <span><strong>Retracted.</strong> Do not cite it without reading the retraction notice.</span>
                    </p>
                  )}
                  <p className="drawer-item-meta">{[p.authors[0] ? `${p.authors[0]}${p.authors.length > 1 ? " et al." : ""}` : null, p.year, p.venue].filter(Boolean).join(" · ")}</p>
                </div>
                <button type="button" className="icon-btn" aria-label={`Remove ${p.title} from library`} onClick={() => removeSaved(p.id)}>
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </m.li>
            ))}
          </AnimatePresence>
        </ul>
      </>
    )}
    </>
  );
}
