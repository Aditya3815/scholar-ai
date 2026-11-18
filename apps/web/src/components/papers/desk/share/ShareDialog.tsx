import * as Dialog from "@radix-ui/react-dialog";
import { ChevronDown, Globe, Link2, Lock, Mail, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { LINK_EXPIRY_DAYS, MEMBER_ROLES, ROLE_LABEL, cleanEmail, type LinkExpiry, type LinkRole, type MemberRole, type ShareMember, type ShareSettings } from "@scholar/shared";
import {
  changeMember,
  changeShare,
  fetchShare,
  inviteMember,
  inviteText,
  keepToken,
  keptToken,
  linkAddress,
  paperAddress,
  removeMember,
  resendInvite,
  resetLink,
  stopSharing,
} from "../../../../lib/share";
import "./share.css";

/**
 * The Share dialog (docs/design/paper-share.md, section 3), a chunk of its own ("share"), fetched when the owner first presses Share. Drive's model: people by e-mail as Can view, Can comment
 * or Can edit; general access Restricted or Anyone with the link (Viewer or Commenter, never Editor), with an expiry and Reset. A labelled modal dialog (Radix: the focus is kept inside and
 * given back to Share when it closes); its role pickers are menus; on a phone it is a bottom sheet. Every change says so in a toast (Remove with Undo), through the reader's own `toast`.
 */
export type ShareDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  docId: string;
  title: string;
  ownerName: string | null;
  toast: (text: string, action?: { label: string; run: () => void }) => void;
  copy: (text: string) => Promise<boolean>;
};

const EXPIRY_LABEL = (d: LinkExpiry) => (d === null ? "Never expires" : `Expires in ${d} days`);
const LINK_ROLE_LABEL: Record<LinkRole, string> = { viewer: "Viewer", commenter: "Commenter" };
const ago = (iso: string | null): string => {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 90) return "just now";
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129_600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} days ago`;
};
const initial = (s: string) => (s.trim()[0] ?? "?").toUpperCase();
const expiryOf = (expiresAt: string | null): LinkExpiry => {
  if (!expiresAt) return null;
  const days = (Date.parse(expiresAt) - Date.now()) / 86_400_000;
  return days <= 7.5 ? 7 : 30;
};

/** A small menu button: a button with aria-haspopup="menu" and a list of menuitemradio, arrows to move, Esc to close (the focus goes back to the button). */
function Menu<T extends string | number | null>({ label, value, options, onPick, disabled, extra }: { label: string; value: T; options: { value: T; label: string }[]; onPick: (v: T) => void; disabled?: boolean; extra?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const items = [...(list.current?.querySelectorAll<HTMLElement>("[role^=menuitem]") ?? [])];
    (items.find((x) => x.getAttribute("aria-checked") === "true") ?? items[0])?.focus();
    const away = (e: PointerEvent) => !list.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  const keys = (e: React.KeyboardEvent) => {
    const items = [...(list.current?.querySelectorAll<HTMLElement>("[role^=menuitem]") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      btn.current?.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    } else if (e.key === "Tab") setOpen(false);
  };
  const shown = options.find((o) => o.value === value)?.label ?? "";
  return (
    <span className="sh-menu-wrap">
      <button ref={btn} type="button" className="sh-menu-btn" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} aria-label={`${label}: ${shown}`} disabled={disabled} onClick={() => setOpen((o) => !o)}>
        <span>{shown}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div ref={list} id={id} role="menu" aria-label={label} className="sh-menu" onKeyDown={keys}>
          {options.map((o) => (
            <button
              key={String(o.value)}
              type="button"
              role="menuitemradio"
              aria-checked={o.value === value}
              tabIndex={-1}
              className="sh-menu-item"
              onClick={() => {
                setOpen(false);
                btn.current?.focus();
                if (o.value !== value) onPick(o.value);
              }}
            >
              <span className="sh-menu-check" aria-hidden="true">✓</span>
              {o.label}
            </button>
          ))}
          {extra && <div className="sh-menu-extra" onClick={() => setOpen(false)}>{extra}</div>}
        </div>
      )}
    </span>
  );
}

export function ShareDialog({ open, onOpenChange, docId, title, ownerName, toast, copy }: ShareDialogProps) {
  const [share, setShare] = useState<ShareSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("commenter");
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(() => keptToken(docId));
  const [wide, setWide] = useState(() => typeof matchMedia !== "function" || matchMedia("(min-width: 601px)").matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const q = matchMedia("(min-width: 601px)");
    const on = () => setWide(q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);

  const load = useCallback(async () => {
    try {
      setShare((await fetchShare(docId)).share);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sharing could not be opened");
    }
  }, [docId]);
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  /** Runs a change, keeps the token a change hands back, and says what went wrong in the dialog (role="alert"). */
  const run = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work. Please try again.");
      return null;
    } finally {
      setBusy(false);
    }
  };
  const took = (r: { share: ShareSettings; token?: string } | null) => {
    if (!r) return;
    setShare(r.share);
    if (r.token) {
      keepToken(docId, r.token);
      setToken(r.token);
    }
    if (!r.share.link) {
      keepToken(docId, null);
      setToken(null);
    }
  };

  const valid = cleanEmail(email);
  const invite = async () => {
    if (!valid) return setError("Write an e-mail address, like name@university.edu");
    const r = await run(() => inviteMember(docId, valid, role));
    if (!r) return;
    setEmail("");
    await load();
    if (r.emailed) toast(`Invited ${valid}. We e-mailed them.`);
    else {
      const ok = await copy(inviteText(title, r.link));
      toast(ok ? `Added ${valid}. The invitation is copied: send it by your own mail.` : `Added ${valid}.`);
    }
  };
  const setMemberRole = async (m: ShareMember, r: MemberRole) => {
    const done = await run(() => changeMember(docId, m.id, r));
    if (done) {
      setShare((s) => (s ? { ...s, members: s.members.map((x) => (x.id === m.id ? done.member : x)) } : s));
      toast(`${m.name ?? m.email}: ${ROLE_LABEL[r]}`);
    }
  };
  const remove = async (m: ShareMember) => {
    const done = await run(() => removeMember(docId, m.id));
    if (!done) return;
    setShare((s) => (s ? { ...s, members: s.members.filter((x) => x.id !== m.id) } : s));
    toast(`Removed ${m.name ?? m.email}`, {
      label: "Undo",
      run: () => void inviteMember(docId, m.email, m.role, { restore: true }).then(load, () => toast("They could not be put back. Invite them again.")),
    });
  };
  const resend = async (m: ShareMember) => {
    const done = await run(() => resendInvite(docId, m.id));
    if (done) {
      setShare((s) => (s ? { ...s, members: s.members.map((x) => (x.id === m.id ? done.member : x)) } : s));
      toast(`The invitation was e-mailed to ${m.email} again`);
    }
  };
  const setMode = async (anyone: boolean) => {
    const r = await run(() => changeShare(docId, { linkMode: anyone ? "anyone" : "restricted" }));
    took(r);
    if (r) toast(anyone ? "Anyone with the link can open it" : "Only the people with access can open it");
  };
  const setLinkRole = async (r: LinkRole) => {
    const done = await run(() => changeShare(docId, { linkRole: r }));
    took(done);
    if (done) toast(`People with the link: ${LINK_ROLE_LABEL[r]}`);
  };
  const setExpiry = async (d: LinkExpiry) => {
    const done = await run(() => changeShare(docId, { expiry: d }));
    took(done);
    if (done) toast(d === null ? "The link does not expire" : `The link expires in ${d} days`);
  };
  const setDownload = async (on: boolean) => {
    const done = await run(() => changeShare(docId, { viewersDownload: on }));
    took(done);
  };
  const reset = async () => {
    const done = await run(() => resetLink(docId, expiryOf(share?.expiresAt ?? null)));
    took(done);
    if (done) toast("A new link is made. The old one no longer works.");
  };
  const stop = async () => {
    const done = await run(() => stopSharing(docId));
    took(done);
    if (done) toast("Stopped sharing. Nobody else can open it now.");
  };
  const copyLink = async () => {
    const anyone = share?.linkMode === "anyone";
    if (anyone && !token) return setError("This link was made on another device, and only a scrambled form of it is kept. Reset the link to copy a new one here.");
    const ok = await copy(anyone && token ? linkAddress(token) : paperAddress(docId));
    toast(ok ? "Link copied" : "Could not copy the link");
  };

  const anyone = share?.linkMode === "anyone";
  const body = (
    <>
      <div className="sh-head">
        <Dialog.Title className="sh-title">Share “{title}”</Dialog.Title>
        <Dialog.Close className="icon-btn icon-btn-sm" aria-label="Close">
          <X size={16} aria-hidden="true" />
        </Dialog.Close>
      </div>
      <Dialog.Description className="sr-only">Add people by e-mail, choose who can open it with the link, and copy the link.</Dialog.Description>
      {error && (
        <p className="sh-error" role="alert">
          {error}
        </p>
      )}
      <form
        className="sh-add"
        onSubmit={(e) => {
          e.preventDefault();
          void invite();
        }}
      >
        <label className="sr-only" htmlFor="sh-email">Add people by e-mail</label>
        <input id="sh-email" className="sh-input" type="email" autoComplete="off" inputMode="email" placeholder="Add people by e-mail" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Menu label="Role for the new person" value={role} options={MEMBER_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))} onPick={setRole} />
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !email.trim()}>
          <Mail size={14} aria-hidden="true" />
          <span>Invite</span>
        </button>
      </form>
      {share && !share.email && <p className="sh-fine">Invitations are not e-mailed from here: Invite copies a ready message for you to send.</p>}

      <h3 className="sh-h">People with access</h3>
      <ul className="sh-people" aria-label="People with access">
        <li className="sh-person">
          <span className="sh-avatar" aria-hidden="true">{initial(ownerName ?? "Y")}</span>
          <span className="sh-who">
            <span className="sh-name">{ownerName ? `${ownerName} (you)` : "You"}</span>
            <span className="sh-meta">Owner</span>
          </span>
        </li>
        {share?.members.map((m) => (
          <li key={m.id} className="sh-person">
            <span className="sh-avatar" aria-hidden="true">{initial(m.name ?? m.email)}</span>
            <span className="sh-who">
              <span className="sh-name">{m.name ?? m.email}</span>
              <span className="sh-meta">
                {m.name ? `${m.email} · ` : ""}
                {m.lastOpenedAt ? `opened ${ago(m.lastOpenedAt)}` : m.joined ? "has not opened it yet" : "invited, not opened yet"}
              </span>
            </span>
            <Menu
              label={`Access of ${m.name ?? m.email}`}
              value={m.role}
              options={MEMBER_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
              onPick={(r) => void setMemberRole(m, r)}
              disabled={busy}
              extra={
                <>
                  {share.email && (
                    <button type="button" role="menuitem" tabIndex={-1} className="sh-menu-item" onClick={() => void resend(m)}>
                      Resend the invitation
                    </button>
                  )}
                  <button type="button" role="menuitem" tabIndex={-1} className="sh-menu-item sh-danger" onClick={() => void remove(m)}>
                    Remove
                  </button>
                </>
              }
            />
          </li>
        ))}
      </ul>

      <h3 className="sh-h">General access</h3>
      <div className="sh-general">
        <span className="sh-gicon" aria-hidden="true">{anyone ? <Globe size={16} /> : <Lock size={16} />}</span>
        <div className="sh-gwhat">
          <Menu label="General access" value={anyone ? "anyone" : "restricted"} options={[{ value: "restricted", label: "Restricted" }, { value: "anyone", label: "Anyone with the link" }]} onPick={(v) => void setMode(v === "anyone")} disabled={busy || !share} />
          <p className="sh-meta">{anyone ? "Anyone on the internet with the link can open it. Commenting needs sign-in." : "Only people with access can open it with the link."}</p>
        </div>
        {anyone && share && (
          <div className="sh-gopts">
            <Menu label="People with the link are" value={share.linkRole} options={(["viewer", "commenter"] as const).map((r) => ({ value: r, label: LINK_ROLE_LABEL[r] }))} onPick={(r) => void setLinkRole(r)} disabled={busy} />
            <Menu label="The link" value={expiryOf(share.expiresAt)} options={LINK_EXPIRY_DAYS.map((d) => ({ value: d, label: EXPIRY_LABEL(d) }))} onPick={(d) => void setExpiry(d)} disabled={busy} />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void reset()} disabled={busy}>
              <RefreshCw size={14} aria-hidden="true" />
              <span>Reset link</span>
            </button>
          </div>
        )}
      </div>
      {share && (
        <label className="sh-check">
          <input type="checkbox" checked={share.viewersDownload} onChange={(e) => void setDownload(e.target.checked)} disabled={busy} />
          <span>Viewers can download the PDF</span>
        </label>
      )}

      <div className="sh-foot">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copyLink()}>
          <Link2 size={14} aria-hidden="true" />
          <span>Copy link</span>
        </button>
        {share && (share.members.length > 0 || share.link) && (
          <button type="button" className="btn btn-ghost btn-sm sh-danger" onClick={() => void stop()} disabled={busy}>
            Stop sharing
          </button>
        )}
        <Dialog.Close className="btn btn-primary btn-sm sh-done">Done</Dialog.Close>
      </div>
    </>
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <div className="sh-wrap" data-wide={wide}>
          <Dialog.Content className="sh-dialog" data-wide={wide} onEscapeKeyDown={(e) => document.querySelector(".sh-menu") && e.preventDefault()}>
            {!wide && <span className="sh-grab" aria-hidden="true" />}
            {body}
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
