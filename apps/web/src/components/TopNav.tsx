import { m } from "motion/react";
import { FileStack, Lightbulb, ListChecks, Search } from "lucide-react";
import { spring } from "../lib/motion";

export type View = "search" | "verify" | "papers" | "idea";

const ITEMS: { id: View; label: string; href: string; Icon: typeof Search }[] = [
  { id: "search", label: "Search", href: "/", Icon: Search },
  { id: "verify", label: "Verify references", href: "/verify", Icon: ListChecks },
  { id: "papers", label: "My papers", href: "/papers", Icon: FileStack },
  { id: "idea", label: "Idea Check", href: "/idea", Icon: Lightbulb },
];

/** Real links (open in a new tab, copy, bookmark) that navigate in place on a plain click. */
export function TopNav({ view, onNavigate }: { view: View; onNavigate: (v: View) => void }) {
  return (
    <nav className="topnav" aria-label="Primary">
      {ITEMS.map(({ id, label, href, Icon }) => {
        const active = view === id;
        return (
          <a
            key={id}
            href={href}
            className="topnav-link"
            aria-current={active ? "page" : undefined}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
              e.preventDefault();
              onNavigate(id);
            }}
          >
            {active && <m.span layoutId="nav-pill" className="topnav-pill" transition={spring} />}
            <Icon size={16} aria-hidden="true" />
            <span className="topnav-label">{label}</span>
            {id === "verify" && <span className="topnav-short" aria-hidden="true">Verify</span>}
          </a>
        );
      })}
    </nav>
  );
}
