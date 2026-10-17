import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, m } from "motion/react";
import { Link2, LogIn, LogOut, Settings, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { linkProvider, signIn, signOut, useAuth } from "../lib/auth";
import { easeOut, spring } from "../lib/motion";
import googleLogo from "../assets/providers/google.png";
import orcidLogo from "../assets/providers/orcid.png";
import { Pop } from "./Pop";
import { SettingsDialog } from "./SettingsDialog";

/** Official marks, decorative here (the button text names the provider). */
const LOGOS: Record<string, string> = { google: googleLogo, orcid: orcidLogo };

const initialOf = (name: string | null, email: string | null) => (name ?? email ?? "?").trim().charAt(0).toUpperCase() || "?";

function SignInDialog() {
  const [open, setOpen] = useState(false);
  const { providers } = useAuth();
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
                  <Dialog.Title className="modal-title">Sign in to Scholar</Dialog.Title>
                  <Dialog.Description id="signin-desc" className="modal-sub">
                    Save your library across devices and keep your uploads private to you.
                  </Dialog.Description>
                  <div className="modal-actions">
                    {providers.map((p) => (
                      <button key={p.id} type="button" className="btn btn-ghost provider-btn" onClick={() => signIn(p.id)}>
                        <img className="provider-logo" src={LOGOS[p.id]} alt="" width={22} height={22} />
                        <span>Continue with {p.label}</span>
                      </button>
                    ))}
                  </div>
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

function UserMenu() {
  const { user, providers } = useAuth();
  const [settingsOpen, setSettingsOpen] = useState(false);
  if (!user) return null;
  const unlinked = providers.filter((p) => !user.providers.includes(p.id));
  return (
    <>
    <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    <Pop
      label="Account"
      align="end"
      trigger={(open) => (
        <button type="button" className="avatar-btn" aria-label={`Account: ${user.name ?? user.email ?? "signed in"}`} aria-expanded={open}>
          {user.avatarUrl ? <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" width={36} height={36} /> : <span aria-hidden="true">{initialOf(user.name, user.email)}</span>}
        </button>
      )}
    >
      {(close) => (
      <div className="acct">
        <p className="acct-name">{user.name ?? "Signed in"}</p>
        {user.email && <p className="acct-line">{user.email}</p>}
        {user.orcid && <p className="acct-line">ORCID iD {user.orcid}</p>}
        <p className="acct-line acct-role">{user.role}</p>
        {unlinked.map((p) => (
          <button key={p.id} type="button" className="btn btn-ghost btn-sm acct-btn" onClick={() => linkProvider(p.id)}>
            <Link2 size={15} aria-hidden="true" />
            <span>Link {p.label}</span>
          </button>
        ))}
        <button
          type="button"
          className="btn btn-ghost btn-sm acct-btn"
          onClick={() => {
            close();
            setSettingsOpen(true);
          }}
        >
          <Settings size={15} aria-hidden="true" />
          <span>Settings and data</span>
        </button>
        <button type="button" className="btn btn-ghost btn-sm acct-btn" onClick={() => void signOut()}>
          <LogOut size={15} aria-hidden="true" />
          <span>Sign out</span>
        </button>
      </div>
      )}
    </Pop>
    </>
  );
}

export function AccountMenu() {
  const { status, user, providers } = useAuth();
  if (status === "loading") return <span className="avatar-skeleton" aria-hidden="true" />;
  if (user) return <UserMenu />;
  if (providers.length === 0) return null; // auth not configured on this deployment
  return <SignInDialog />;
}
