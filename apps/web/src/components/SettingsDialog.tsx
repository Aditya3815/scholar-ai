import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, m } from "motion/react";
import { AlertTriangle, Download, X } from "lucide-react";
import { useState } from "react";
import { refreshAuth, useAuth } from "../lib/auth";
import { resetLibraryView } from "../lib/library";
import { easeOut, spring } from "../lib/motion";
import { showNotice } from "../lib/notice";

/** Account details, data export, and irreversible account deletion (DPDP: access, portability, erasure). */
export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { user } = useAuth();
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
    onOpenChange(false);
    setConfirm("");
    showNotice("Your account and everything saved in it have been deleted.");
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setConfirm("");
          setError(null);
        }
      }}
    >
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

                  <section className="settings-sec" aria-labelledby="set-acct">
                    <h3 id="set-acct" className="settings-h">Account</h3>
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

                  <section className="settings-sec" aria-labelledby="set-data">
                    <h3 id="set-data" className="settings-h">Your data</h3>
                    <p className="settings-p">Download everything we hold about you (profile and saved papers) as a JSON file.</p>
                    <a className="btn btn-ghost btn-sm" href="/api/v1/account/export" download>
                      <Download size={15} aria-hidden="true" />
                      <span>Export my data</span>
                    </a>
                  </section>

                  <section className="settings-sec danger-zone" aria-labelledby="set-del">
                    <h3 id="set-del" className="settings-h">
                      <AlertTriangle size={17} aria-hidden="true" /> Delete account
                    </h3>
                    <p className="settings-p">
                      This permanently deletes your profile, sign-in links and every saved paper. It cannot be undone. Export first if you want a copy.
                    </p>
                    <label className="field" htmlFor="del-confirm">
                      Type <strong>DELETE</strong> to confirm
                    </label>
                    <input id="del-confirm" className="text-input" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" spellCheck={false} />
                    {error && (
                      <p className="field-error" role="alert">
                        {error}
                      </p>
                    )}
                    <button type="button" className="btn btn-danger btn-sm" disabled={confirm !== "DELETE" || busy} onClick={() => void deleteAccount()}>
                      {busy ? "Deleting" : "Delete my account"}
                    </button>
                  </section>
                </m.div>
              </Dialog.Content>
            </div>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
