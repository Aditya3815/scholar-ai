import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, m } from "motion/react";
import { Bookmark, FileStack, Home, Lightbulb, ListChecks, LogOut, Menu, MessageSquare, Plus, Settings, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { signOut, useAuth } from "../lib/auth";
import { useLibrary } from "../lib/library";
import { useDocs } from "../lib/documents";
import { deleteChat, openChat, startNewChat, useChatState } from "../lib/chat";
import { easeOut, spring } from "../lib/motion";
import { Logo } from "../components/Logo";
import { SignInDialog } from "../components/AccountMenu";
import { ThemeSwitch } from "../components/ThemeSwitch";
import { PAPERS_NAME } from "../lib/workspace";
import type { View } from "../components/TopNav";

type Item = { id: View | "home"; label: string; href: string; Icon: typeof Home; count?: number };

/** The left rail of the new look: where you are, the tools that are not in the prompt box yet, and your account. */
function RailContent({ view, onNavigate, onHome, onClose }: { view: View | "home"; onNavigate: (v: View) => void; onHome: () => void; onClose?: () => void }) {
  const { user } = useAuth();
  const saved = useLibrary().length;
  const papers = useDocs().items.length;
  const chats = useChatState();
  const go = (fn: () => void) => () => {
    fn();
    onClose?.();
  };
  const main: Item[] = [
    { id: "home", label: "Home", href: "/", Icon: Home },
    { id: "papers", label: PAPERS_NAME, href: "/papers", Icon: FileStack, count: user ? papers : undefined },
    { id: "library", label: "Library", href: "/library", Icon: Bookmark, count: saved },
  ];
  const tools: Item[] = [
    { id: "verify", label: "Check references", href: "/verify", Icon: ListChecks },
    { id: "idea", label: "Idea Check", href: "/idea", Icon: Lightbulb },
  ];

  const link = ({ id, label, href, Icon, count }: Item) => {
    const active = view === id;
    return (
      <li key={id}>
        <a
          href={href}
          className="ws-link"
          aria-current={active ? "page" : undefined}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
            e.preventDefault();
            go(() => (id === "home" ? onHome() : onNavigate(id)))();
          }}
        >
          {active && <m.span layoutId={`ws-pill-${onClose ? "d" : "s"}`} className="ws-link-pill" transition={spring} />}
          <Icon size={18} aria-hidden="true" />
          <span className="ws-link-label">{label}</span>
          {count !== undefined && count > 0 && <span className="ws-count" aria-label={`${count} saved`}>{count}</span>}
        </a>
      </li>
    );
  };

  return (
    <div className="ws-rail-in">
      <a
        className="logo-btn ws-logo"
        href="/"
        aria-label="Scholar AI, home"
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault();
          go(onHome)();
        }}
      >
        <Logo />
      </a>
      <nav aria-label="Primary">
        <ul className="ws-nav">{main.map(link)}</ul>
        <div className="ws-chats">
          <button type="button" className="ws-newchat" onClick={go(() => { startNewChat(); onHome(); })}>
            <Plus size={16} aria-hidden="true" />
            <span>New chat</span>
          </button>
          {chats.index.length > 0 && (
            <>
              <p className="ws-nav-h" id={`ws-recent-h-${onClose ? "d" : "s"}`}>Recent</p>
              <ul className="ws-nav ws-recent" aria-labelledby={`ws-recent-h-${onClose ? "d" : "s"}`}>
                {chats.index.slice(0, 6).map((e) => (
                  <li key={e.id}>
                    <button type="button" className="ws-link ws-recent-open" aria-current={view === "home" && chats.active === e.id ? "true" : undefined} onClick={go(() => { void openChat(e.id); onHome(); })}>
                      <MessageSquare size={15} aria-hidden="true" />
                      <span className="ws-link-label">{e.title}</span>
                    </button>
                    <button type="button" className="ws-recent-x" aria-label={`Delete the chat ${e.title}`} title="Delete this chat" onClick={() => deleteChat(e.id)}>
                      <X size={13} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <p className="ws-nav-h" id="ws-tools-h">Tools</p>
        <ul className="ws-nav" aria-labelledby="ws-tools-h">{tools.map(link)}</ul>
      </nav>

      <div className="ws-rail-foot">
        {user ? (
          <div className="ws-who">
            <span className="ws-av" aria-hidden="true">
              {user.avatarUrl ? <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" width={32} height={32} /> : (user.name ?? user.email ?? "?").trim().charAt(0).toUpperCase()}
            </span>
            <span className="ws-who-name">
              {user.name ?? "Signed in"}
              {user.email && <small>{user.email}</small>}
            </span>
            <button type="button" className="icon-btn" aria-label="Sign out" title="Sign out" onClick={() => void signOut()}>
              <LogOut size={17} aria-hidden="true" />
            </button>
          </div>
        ) : (
          <div className="ws-anon">
            <p>Sign in to keep your library on every device and to upload papers.</p>
            <SignInDialog />
          </div>
        )}
        <ul className="ws-nav">
          {user &&
            link({ id: "settings", label: "Settings", href: "/settings", Icon: Settings })}
        </ul>
        <ThemeSwitch scope={onClose ? "drawer" : "rail"} />
      </div>
    </div>
  );
}

/** `focus`: reading a paper. The rail and the menu bar are not shown, so the paper has the whole window (the paper's own header has the way back). */
export function Shell({ view, onNavigate, onHome, title, children, footer, focus = false }: { view: View | "home"; onNavigate: (v: View) => void; onHome: () => void; title: string; children: ReactNode; footer: ReactNode; focus?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ws-shell" data-focus={focus}>
      <a className="skip-link" href="#main">Skip to content</a>
      {!focus && (
        <aside className="ws-rail" aria-label="Scholar AI">
          <RailContent view={view} onNavigate={onNavigate} onHome={onHome} />
        </aside>
      )}

      <div className="ws-col">
        {!focus && (
        <header className="ws-top">
          <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Trigger asChild>
              <button type="button" className="icon-btn ws-menu-btn" aria-label="Open the menu" aria-expanded={open}>
                <Menu size={20} aria-hidden="true" />
              </button>
            </Dialog.Trigger>
            <AnimatePresence>
              {open && (
                <Dialog.Portal forceMount>
                  <Dialog.Overlay asChild forceMount>
                    <m.div className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: easeOut }} />
                  </Dialog.Overlay>
                  <Dialog.Content asChild forceMount aria-describedby={undefined}>
                    <m.div className="ws-drawer" initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%", transition: { duration: 0.2 } }} transition={spring}>
                      <Dialog.Title className="sr-only">Menu</Dialog.Title>
                      <Dialog.Close className="icon-btn ws-drawer-close" aria-label="Close the menu">
                        <X size={18} aria-hidden="true" />
                      </Dialog.Close>
                      <RailContent view={view} onNavigate={onNavigate} onHome={onHome} onClose={() => setOpen(false)} />
                    </m.div>
                  </Dialog.Content>
                </Dialog.Portal>
              )}
            </AnimatePresence>
          </Dialog.Root>
          <p className="ws-top-title">{title}</p>
        </header>
        )}
        {children}
        {footer}
      </div>
    </div>
  );
}
