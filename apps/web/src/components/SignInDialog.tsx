import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, m } from "motion/react";
import { LogIn, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { easeOut, spring } from "../lib/motion";
import { ProviderButtons } from "./ProviderButtons";

/** The sign-in dialog: the way in for a visitor (the intro page, the rail, a gate in a tool). */
export function SignInDialog() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" className="btn btn-primary btn-sm signin-trigger" aria-label="Sign in">
          <LogIn size={16} aria-hidden="true" />
          <span className="signin-label">Sign in</span>
        </button>
      </Dialog.Trigger>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <m.div className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: easeOut }} />
            </Dialog.Overlay>
            <div className="modal-wrap">
              <Dialog.Content asChild forceMount aria-describedby="signin-desc">
                <m.div className="modal" initial={{ opacity: 0, y: 18, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.98, transition: { duration: 0.15 } }} transition={spring}>
                  <Dialog.Close className="icon-btn modal-close" aria-label="Close">
                    <X size={18} aria-hidden="true" />
                  </Dialog.Close>
                  <Dialog.Title className="modal-title">Sign in to Scholar AI</Dialog.Title>
                  <Dialog.Description id="signin-desc" className="modal-sub">
                    Save your library across devices and keep your uploads private to you.
                  </Dialog.Description>
                  <ProviderButtons />
                  <p className="modal-fine">
                    <ShieldCheck size={15} aria-hidden="true" />
                    <span>We only receive your name and email (Google) or your public ORCID iD. We never see your password, and your manuscripts are never used to train AI.</span>
                  </p>
                </m.div>
              </Dialog.Content>
            </div>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
