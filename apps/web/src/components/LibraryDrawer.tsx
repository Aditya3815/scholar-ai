import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, m } from "motion/react";
import { Download, Library, Trash2, X } from "lucide-react";
import { useState } from "react";
import { useAuth } from "../lib/auth";
import { formatCitation } from "../lib/cite";
import { removeSaved, useLibrary, type SavedPaper } from "../lib/library";
import { easeOut, spring, springPop } from "../lib/motion";
import { openPreview } from "../lib/preview";
import { CopyButton } from "./CiteMenu";

function downloadBib(text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/x-bibtex" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "library.bib";
  a.click();
  URL.revokeObjectURL(url);
}

export const libraryNote = (signedIn: boolean) =>
  signedIn ? "Synced to your account, so it follows you to any device." : "Saved on this device only. Sign in to keep it across devices; anything saved here moves into your account.";

/** The saved records with Copy BibTeX, the .bib download and Remove. Used in the drawer and on the Library page of the new look. */
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
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => downloadBib(bib)}>
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

export function LibraryDrawer() {
  const [open, setOpen] = useState(false);
  const items = useLibrary();
  const signedIn = !!useAuth().user;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" className="btn btn-ghost lib-trigger" aria-label={`Library, ${items.length} saved`}>
          <Library size={18} aria-hidden="true" />
          <span className="lib-trigger-label">Library</span>
          <m.span key={items.length} className="count-badge" initial={{ scale: 0.4 }} animate={{ scale: 1 }} transition={springPop}>
            {items.length}
          </m.span>
        </button>
      </Dialog.Trigger>

      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <m.div className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: easeOut }} />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby="lib-desc">
              <m.aside className="drawer" initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%", transition: { duration: 0.2 } }} transition={spring}>
                <header className="drawer-head">
                  <Dialog.Title className="drawer-title">Your library</Dialog.Title>
                  <Dialog.Close className="icon-btn" aria-label="Close library">
                    <X size={18} aria-hidden="true" />
                  </Dialog.Close>
                </header>
                <Dialog.Description id="lib-desc" className="drawer-note">
                  {libraryNote(signedIn)}
                </Dialog.Description>

                <LibraryList items={items} onOpen={(p) => { setOpen(false); window.setTimeout(() => openPreview(p, items), 180); }} />
              </m.aside>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
