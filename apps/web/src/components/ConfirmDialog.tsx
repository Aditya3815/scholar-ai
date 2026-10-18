import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, m } from "motion/react";
import { Loader2, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { easeOut, spring } from "../lib/motion";

/** A small "are you sure?" modal in the same style as the sign-in dialog. The action button names the action. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<void> | void;
  children?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!busy) { setError(null); onOpenChange(o); } }}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <m.div className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: easeOut }} />
            </Dialog.Overlay>
            <div className="modal-wrap">
              <Dialog.Content asChild forceMount>
                <m.div className="modal" initial={{ opacity: 0, y: 18, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.98, transition: { duration: 0.15 } }} transition={spring}>
                  <Dialog.Close className="icon-btn modal-close" aria-label="Close" disabled={busy}>
                    <X size={18} aria-hidden="true" />
                  </Dialog.Close>
                  <Dialog.Title className="modal-title">{title}</Dialog.Title>
                  <Dialog.Description className="modal-sub">{description}</Dialog.Description>
                  {children}
                  {error && <p className="modal-error" role="alert">{error}</p>}
                  <div className="confirm-actions">
                    <button type="button" className="btn btn-ghost" onClick={() => onOpenChange(false)} disabled={busy}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        setError(null);
                        try {
                          await onConfirm();
                          onOpenChange(false);
                        } catch (e) {
                          setError(e instanceof Error ? e.message : "That did not work. Please try again.");
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      {busy && <Loader2 className="spin" size={16} aria-hidden="true" />}
                      <span>{confirmLabel}</span>
                    </button>
                  </div>
                </m.div>
              </Dialog.Content>
            </div>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
