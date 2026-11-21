import * as Dialog from "@radix-ui/react-dialog";
import { ChevronDown, Globe, Link2, Lock, Mail, RefreshCw, X } from "lucide-react";
import { Suspense, lazy, useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { INVITE_NOTE_MAX, LINK_EXPIRY_DAYS, MEMBER_ROLES, ROLE_LABEL, cleanEmail, type LinkExpiry, type LinkRole, type MemberRole, type ShareMember, type ShareSettings } from "@scholar/shared";
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
import type { PreviewPicture } from "./EmailPreview";
import "./share.css";

// the preview of the invitation e-mail, a chunk of its own (it holds the e-mail's HTML), fetched when "Preview e-mail" is first opened
const EmailPreview = lazy(() => import("./EmailPreview"));

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
  /** Where the focus goes when it closes (the Share button). */
  returnFocus: () => void;
  /** The paper has a stored cover (its first page, made at upload): the server puts that in the e-mail, and the preview shows it. */
  hasCover?: boolean;
  /** For a paper with no cover: draws its first page as a small JPEG to send with the invitation (null when it cannot); absent while the PDF is not open. */
  pagePicture?: () => Promise<Picture | null>;
};


type Picture = PreviewPicture & { base64: string };
/** At most `ms` for the picture: the invitation never waits long for it, and goes without it. */
const within = <T,>(p: Promise<T>, ms: number, or: T) => Promise.race([p, new Promise<T>((done) => window.setTimeout(() => done(or), ms))]);

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
  const [at, setAt] = useState<React.CSSProperties>({});
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  /** Where the menu goes: under its button, or over it when there is no room below, in the window (so the dialog's scrolling body never cuts it off). */
  const place = useCallback(() => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const width = 224;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    setAt(window.innerHeight - r.bottom >= 220 ? { left, top: r.bottom + 4 } : { left, bottom: window.innerHeight - r.top + 4 });
  }, []);
  useEffect(() => {
    if (!open) return;
    const items = [...(list.current?.querySelectorAll<HTMLElement>("[role^=menuitem]") ?? [])];
    (items.find((x) => x.getAttribute("aria-checked") === "true") ?? items[0])?.focus({ preventScroll: true });
    const away = (e: PointerEvent) => !list.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", away);
    // placed in the window, it follows its button when the dialog's body scrolls or the window changes
    const body = btn.current?.closest(".sh-body");
    body?.addEventListener("scroll", place, { passive: true });
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("pointerdown", away);
      body?.removeEventListener("scroll", place);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);
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
      items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus({ preventScroll: true });
    } else if (e.key === "Tab") setOpen(false);
  };
  const shown = options.find((o) => o.value === value)?.label ?? "";
  return (
    <span className="sh-menu-wrap">
      <button ref={btn} type="button" className="sh-menu-btn" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} aria-label={`${label}: ${shown}`} disabled={disabled} onClick={() => {
          place();
          setOpen((o) => !o);
        }}>
        <span>{shown}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div ref={list} id={id} role="menu" aria-label={label} className="sh-menu" style={at} onKeyDown={keys}>
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

export function ShareDialog({ open, onOpenChange, docId, title, ownerName, toast, copy, returnFocus, hasCover, pagePicture }: ShareDialogProps) {
  const [share, setShare] = useState<ShareSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("commenter");
  const [note, setNote] = useState("");
  const [previewing, setPreviewing] = useState(false);
  // what the preview shows of the note, a moment after the typing stops (each change draws the e-mail again)
  const [shownNote, setShownNote] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setShownNote(note), 350);
    return () => window.clearTimeout(t);
  }, [note]);
  // The picture of the first page. A paper with a cover sends none: the server reads the stored cover, from any device on any connection. A paper without one has its first page drawn
  // here, as soon as the dialog is open (drawn only at Invite, it waited behind the reader's own work on the PDF, the 4 s ran out and the e-mail went with the page block).
  const picture = useRef<Promise<Picture | null> | null>(null);
  const getPicture = useCallback((): Promise<Picture | null> => {
    if (hasCover || !pagePicture) return Promise.resolve(null); // the PDF not open yet: asked again next time
    return (picture.current ??= pagePicture().catch(() => null));
  }, [hasCover, pagePicture]);
  useEffect(() => {
    if (open) void getPicture();
  }, [open, getPicture]);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(() => keptToken(docId));
  // Undo of Remove, in the dialog itself: the reader's toasts sit behind the modal, where nothing can be pressed
  const [removed, setRemoved] = useState<ShareMember | null>(null);
  useEffect(() => {
    if (!removed) return;
    const t = window.setTimeout(() => setRemoved(null), 10_000);
    return () => window.clearTimeout(t);
  }, [removed]);
  // what a change did, said in the dialog (role="status"); the reader's toast says it again once the dialog is closed
  const [said, setSaid] = useState<string | null>(null);
  const last = useRef<string | null>(null);
  const say = useCallback((text: string) => {
    setRemoved(null);
    setSaid(text);
    last.current = text;
  }, []);
  useEffect(() => {
    if (!said) return;
    const t = window.setTimeout(() => setSaid(null), 6000);
    return () => window.clearTimeout(t);
  }, [said]);
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
    const mailing = share?.email === true;
    const pic = mailing ? await within(getPicture(), 4000, null) : null;
    const r = await run(() => inviteMember(docId, valid, role, mailing ? { note: note.trim(), picture: pic?.base64 } : {}));
    if (!r) return;
    setEmail("");
    setNote("");
    setPreviewing(false);
    await load();
    if (r.emailed) say(`Invited ${valid}. We e-mailed them.`);
    else {
      const ok = await copy(inviteText(title, r.link));
      say(ok ? `Added ${valid}. The invitation is copied: send it by your own mail.` : `Added ${valid}.`);
    }
  };
  const setMemberRole = async (m: ShareMember, r: MemberRole) => {
    const done = await run(() => changeMember(docId, m.id, r));
    if (done) {
      setShare((s) => (s ? { ...s, members: s.members.map((x) => (x.id === m.id ? done.member : x)) } : s));
      say(`${m.name ?? m.email}: ${ROLE_LABEL[r]}`);
    }
  };
  const remove = async (m: ShareMember) => {
    const done = await run(() => removeMember(docId, m.id));
    if (!done) return;
    setShare((s) => (s ? { ...s, members: s.members.filter((x) => x.id !== m.id) } : s));
    setSaid(null);
    setRemoved(m);
  };
  const resend = async (m: ShareMember) => {
    const pic = await within(getPicture(), 4000, null);
    const done = await run(() => resendInvite(docId, m.id, pic?.base64));
    if (done) {
      setShare((s) => (s ? { ...s, members: s.members.map((x) => (x.id === m.id ? done.member : x)) } : s));
      say(`The invitation was e-mailed to ${m.email} again`);
    }
  };
  const setMode = async (anyone: boolean) => {
    const r = await run(() => changeShare(docId, { linkMode: anyone ? "anyone" : "restricted" }));
    took(r);

  };
  const setLinkRole = async (r: LinkRole) => {
    const done = await run(() => changeShare(docId, { linkRole: r }));
    took(done);

  };
  const setExpiry = async (d: LinkExpiry) => {
    const done = await run(() => changeShare(docId, { expiry: d }));
    took(done);

  };
  const setDownload = async (on: boolean) => {
    const done = await run(() => changeShare(docId, { viewersDownload: on }));
    took(done);
  };
  const reset = async () => {
    const done = await run(() => resetLink(docId, expiryOf(share?.expiresAt ?? null)));
    took(done);
    if (done) say("A new link is made. The old one no longer works.");
  };
  const stop = async () => {
    const done = await run(() => stopSharing(docId));
    took(done);
    if (done) say("Stopped sharing. Nobody else can open it now.");
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
      <div className="sh-body">
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
      {share?.email && email.trim() && (
        <div className="sh-msg">
          <label className="sr-only" htmlFor="sh-note">Message (optional)</label>
          <textarea id="sh-note" className="sh-input sh-note" rows={2} maxLength={INVITE_NOTE_MAX} placeholder="Add a message (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="sh-msg-row">
            <button type="button" className="link-btn" aria-expanded={previewing} aria-controls="sh-preview" onClick={() => setPreviewing((p) => !p)}>
              {previewing ? "Hide the e-mail" : "Preview e-mail"}
            </button>
            {note.length > INVITE_NOTE_MAX - 100 && <span className="sh-meta">{INVITE_NOTE_MAX - note.length} characters left</span>}
          </div>
          {previewing && (
            <Suspense fallback={<p className="sh-fine">Opening the preview…</p>}>
              <EmailPreview inviterName={ownerName ?? "Someone"} title={title} role={role} to={valid ?? email.trim()} note={shownNote} link={paperAddress(docId)} picture={getPicture()} cover={hasCover ? `/api/v1/documents/${docId}/cover` : null} />
            </Suspense>
          )}
        </div>
      )}

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
      </div>

      <div className="sh-foot">
      {said && !removed && (
        <p className="sh-undo" role="status">
          {said}
        </p>
      )}
      {removed && (
        <p className="sh-undo" role="status">
          <span>Removed {removed.name ?? removed.email}</span>
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              const m = removed;
              setRemoved(null);
              void inviteMember(docId, m.email, m.role, { restore: true }).then(
                () => (void load(), say(`${m.name ?? m.email} is back`)),
                () => setError("They could not be put back. Invite them again."),
              );
            }}
          >
            Undo
          </button>
        </p>
      )}
        <div className="sh-foot-row">
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
      </div>
    </>
  );

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o && said) toast(said);
        setSaid(null);
        onOpenChange(o);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <div className="sh-wrap" data-wide={wide}>
          <Dialog.Content className="sh-dialog" data-wide={wide} onEscapeKeyDown={(e) => document.querySelector(".sh-menu") && e.preventDefault()} onCloseAutoFocus={(e) => (e.preventDefault(), returnFocus())}>
            {!wide && <span className="sh-grab" aria-hidden="true" />}
            {body}
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
