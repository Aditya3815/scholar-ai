import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, m } from "motion/react";
import { AlertTriangle, Download, X } from "lucide-react";
import { useState } from "react";
import { refreshAuth, useAuth } from "../lib/auth";
import { resetLibraryView } from "../lib/library";
import { easeOut, spring } from "../lib/motion";
import { showNotice } from "../lib/notice";
import { setRememberOn, useRememberOn } from "../lib/remember";
import { WORKSPACE } from "../lib/workspace";

/**
 * The three sections of the account settings (details, a copy of your data, erasing the account: DPDP access, portability, erasure).
 * Shown in the dialog from the account menu and, in the new look, on the Settings page.
 */
export function SettingsSections({ onDeleted, idPrefix = "set" }: { onDeleted?: () => void; idPrefix?: string }) {
  const { user } = useAuth();
  const rememberOn = useRememberOn();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) return null;

  const deleteAccount = async () => {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/v1/account", {
      method: "DELETE",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: "DELETE" }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError("We could not delete your account. Please try again.");
      return;
    }
    resetLibraryView();
    await refreshAuth();
    onDeleted?.();
    setConfirm("");
    showNotice("Your account and everything saved in it have been deleted.");
  };

  return (
    <>
      <section className="settings-sec" aria-labelledby={`${idPrefix}-acct`}>
        <h3 id={`${idPrefix}-acct`} className="settings-h">Account</h3>
        <dl className="kv">
          <dt>Name</dt>
          <dd>{user.name ?? "Not provided"}</dd>
          <dt>Email</dt>
          <dd>{user.email ?? "Not provided (ORCID does not share it)"}</dd>
          {user.orcid && (
            <>
              <dt>ORCID iD</dt>
              <dd>{user.orcid}</dd>
            </>
          )}
          <dt>Signed in with</dt>
          <dd>{user.providers.map((p) => (p === "google" ? "Google" : "ORCID")).join(", ")}</dd>
        </dl>
      </section>

      {WORKSPACE && (
        <section className="settings-sec" aria-labelledby={`${idPrefix}-home`}>
          <h3 id={`${idPrefix}-home`} className="settings-h">Home screen</h3>
          <label className="settings-check">
            <input type="checkbox" checked={rememberOn} onChange={(e) => setRememberOn(e.target.checked)} />
            <span>Show “Remember this?” with one of my highlights</span>
          </label>
          <p className="settings-p">One highlight from your own papers, the same one all day. It is chosen on your account and shown only to you. This choice is kept on this device.</p>
        </section>
      )}

      <section className="settings-sec" aria-labelledby={`${idPrefix}-data`}>
        <h3 id={`${idPrefix}-data`} className="settings-h">Your data</h3>
        <p className="settings-p">Download everything we hold about you (profile, saved papers, your uploaded papers with their questions and answers, and any reports you sent) as a JSON file. The PDFs themselves can be downloaded from each paper.</p>
        <a className="btn btn-ghost btn-sm" href="/api/v1/account/export" download>
          <Download size={15} aria-hidden="true" />
          <span>Export my data</span>
        </a>
      </section>

      <section className="settings-sec danger-zone" aria-labelledby={`${idPrefix}-del`}>
        <h3 id={`${idPrefix}-del`} className="settings-h">
          <AlertTriangle size={17} aria-hidden="true" /> Delete account
        </h3>
        <p className="settings-p">
          This permanently deletes your profile, sign-in links and every saved paper. It cannot be undone. Export first if you want a copy.
        </p>
        <label className="field" htmlFor={`${idPrefix}-confirm`}>
          Type <strong>DELETE</strong> to confirm
        </label>
        <input id={`${idPrefix}-confirm`} className="text-input" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" spellCheck={false} />
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <button type="button" className="btn btn-danger btn-sm" disabled={confirm !== "DELETE" || busy} onClick={() => void deleteAccount()}>
          {busy ? "Deleting" : "Delete my account"}
        </button>
      </section>
    </>
  );
}

/** Account details, data export, and irreversible account deletion. */
export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <m.div className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: easeOut }} />
            </Dialog.Overlay>
            <div className="modal-wrap">
              <Dialog.Content asChild forceMount aria-describedby="settings-desc">
                <m.div className="modal modal-wide" initial={{ opacity: 0, y: 18, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.98, transition: { duration: 0.15 } }} transition={spring}>
                  <Dialog.Close className="icon-btn modal-close" aria-label="Close settings">
                    <X size={18} aria-hidden="true" />
                  </Dialog.Close>
                  <Dialog.Title className="modal-title">Account settings</Dialog.Title>
                  <Dialog.Description id="settings-desc" className="modal-sub">
                    Your details, a copy of your data, and the option to erase it.
                  </Dialog.Description>
                  <SettingsSections onDeleted={() => onOpenChange(false)} />
                </m.div>
              </Dialog.Content>
            </div>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
