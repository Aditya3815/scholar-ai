import { AlertTriangle, Download, Link2 } from "lucide-react";
import { useState } from "react";
import { linkProvider, refreshAuth, useAuth } from "../lib/auth";
import { resetLibraryView } from "../lib/library";
import { showNotice } from "../lib/notice";
import { setRememberOn, useRememberOn } from "../lib/remember";
import { clearOfflineData } from "../lib/offline";
import { clearChats, useChatState } from "../lib/chat";
import { OfflineSettings } from "./OfflineSettings";

/**
 * The three sections of the account settings (details, a copy of your data, erasing the account: DPDP access, portability, erasure).
 * Shown on the Settings page.
 */
export function SettingsSections({ onDeleted, idPrefix = "set" }: { onDeleted?: () => void; idPrefix?: string }) {
  const { user, providers } = useAuth();
  const rememberOn = useRememberOn();
  const chatCount = useChatState().index.length;
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) return null;
  const unlinked = providers.filter((p) => !user.providers.includes(p.id));

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
    await clearOfflineData();
    await clearChats();
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
        {unlinked.length > 0 && (
          <div className="settings-link">
            <p className="settings-p">Link another way to sign in, so the same account opens with either.</p>
            {unlinked.map((p) => (
              <button key={p.id} type="button" className="btn btn-ghost btn-sm" onClick={() => linkProvider(p.id)}>
                <Link2 size={15} aria-hidden="true" />
                <span>Link {p.label}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="settings-sec" aria-labelledby={`${idPrefix}-home`}>
        <h3 id={`${idPrefix}-home`} className="settings-h">Home screen</h3>
        <label className="settings-check">
          <input type="checkbox" checked={rememberOn} onChange={(e) => setRememberOn(e.target.checked)} />
          <span>Show “Remember this?” with one of my highlights</span>
        </label>
        <p className="settings-p">One highlight from your own papers, the same one all day. It is chosen on your account and shown only to you. This choice is kept on this device.</p>
      </section>

      <section className="settings-sec" aria-labelledby={`${idPrefix}-chats`}>
        <h3 id={`${idPrefix}-chats`} className="settings-h">Chats</h3>
        <p className="settings-p">
          What you ask in the prompt box on Home and the answers are kept <strong>only in this browser</strong>, never on our servers. They are removed when you sign out, and they are not part of the copy of your data you can download, because we do not have them.
        </p>
        <button type="button" className="btn btn-ghost btn-sm" disabled={chatCount === 0} onClick={() => void clearChats().then(() => showNotice("Your chats were deleted from this browser."))}>
          <span>{chatCount === 0 ? "No chats kept" : `Delete ${chatCount === 1 ? "the chat" : `all ${chatCount} chats`} in this browser`}</span>
        </button>
      </section>

      <OfflineSettings idPrefix={idPrefix} />

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
