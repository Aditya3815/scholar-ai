import { m } from "motion/react";
import { ArrowUp, Bookmark, Check, ChevronDown, FileStack, Lightbulb, ListChecks, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { useAuth } from "../lib/auth";
import { coverUrl, loadDocs, useDocs } from "../lib/documents";
import { useLibrary } from "../lib/library";
import { easeOut, springPop, stagger } from "../lib/motion";
import { putHandoff } from "../lib/workspace";
import { Pop } from "../components/Pop";

/** The four tools. In W1 each opens the page that already does the work (the prompt box does not choose for you yet: that is W3). */
export type Tool = "search" | "verify" | "idea" | "paper";
const TOOLS: { id: Tool; name: string; short: string; help: string; placeholder: string; Icon: typeof Search }[] = [
  { id: "search", name: "Search papers", short: "Search", help: "Real records with a checked DOI, retractions flagged.", placeholder: "Ask about a topic, or paste a DOI…", Icon: Search },
  { id: "verify", name: "Check references", short: "References", help: "Paste a bibliography: does each reference exist, and does it say what you cited?", placeholder: "Paste your references, one per line…", Icon: ListChecks },
  { id: "idea", name: "Idea Check", short: "Idea", help: "Closest papers, part by part, and the gaps. Never a verdict on novelty.", placeholder: "Describe your idea in a few sentences…", Icon: Lightbulb },
  { id: "paper", name: "Ask a paper", short: "Papers", help: "Answers from your own papers, with the page and the exact quote.", placeholder: "Open My papers to ask one of your papers…", Icon: FileStack },
];
const STARTERS = ["graph neural networks", "NEP 2020 higher education India", "CRISPR off-target effects", "plagiarism detection techniques"];

const greeting = (name: string | null) => {
  const h = new Date().getHours();
  const part = h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const first = name?.trim().split(/\s+/)[0];
  return first ? `${part}, ${first}` : part;
};

function ModeMenu({ tool, onChange }: { tool: Tool; onChange: (t: Tool) => void }) {
  const current = TOOLS.find((t) => t.id === tool)!;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = refs.current.findIndex((b) => b === document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); refs.current[(i + 1) % TOOLS.length]?.focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); refs.current[(i - 1 + TOOLS.length) % TOOLS.length]?.focus(); }
  };
  return (
    <Pop
      label="What should I do?"
      align="start"
      trigger={(open) => (
        <button type="button" className="hm-mode" aria-haspopup="menu" aria-expanded={open}>
          <current.Icon size={16} aria-hidden="true" />
          <span>{current.name}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      )}
    >
      {(close) => (
        <div role="menu" aria-label="What should I do?" className="hm-menu" onKeyDown={onKey}>
          {TOOLS.map((t, i) => (
            <button
              key={t.id}
              ref={(el) => { refs.current[i] = el; }}
              type="button"
              role="menuitemradio"
              aria-checked={t.id === tool}
              className="hm-menu-item"
              autoFocus={t.id === tool}
              onClick={() => { onChange(t.id); close(); }}
            >
              <span className="hm-menu-ico"><t.Icon size={16} aria-hidden="true" /></span>
              <span className="hm-menu-txt"><b>{t.name}</b><small>{t.help}</small></span>
              <Check size={16} className="hm-tick" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </Pop>
  );
}

/**
 * The home of the new look: one prompt box. In this first step (W1) you choose the tool with the menu or the pills, and Enter opens that tool with what you wrote.
 * Choosing for you from what you write comes in W3; streamed answers in the same screen in W2.
 */
export function HomePage({ query, onQuery, onSearch, onOpenTool, inputRef }: { query: string; onQuery: (v: string) => void; onSearch: (q: string) => void; onOpenTool: (t: "verify" | "idea" | "papers") => void; inputRef: RefObject<HTMLTextAreaElement | null> }) {
  const { user, status } = useAuth();
  const docs = useDocs();
  const saved = useLibrary().length;
  const [tool, setTool] = useState<Tool>("search");
  const id = useId();
  const current = TOOLS.find((t) => t.id === tool)!;

  useEffect(() => {
    if (status === "ready" && user) void loadDocs();
  }, [status, user?.id]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [query, inputRef]);

  const ready = query.trim().length >= (tool === "search" ? 2 : 1) && tool !== "paper";
  const send = () => {
    const text = query.trim();
    if (tool === "paper") return onOpenTool("papers");
    if (!text) return;
    if (tool === "search") {
      if (text.length < 2) return;
      return onSearch(text);
    }
    putHandoff(tool, text);
    onOpenTool(tool);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const covers = useMemo(() => docs.items.filter((d) => d.hasCover).slice(0, 3), [docs.items]);
  const rise = (i: number) => ({ initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.6, ease: easeOut, delay: 0.06 + stagger(i, 0.08) } });

  return (
    <section className="hm" aria-labelledby="hm-h">
      <div className="orbs" aria-hidden="true">
        <span className="orb orb-1" />
        <span className="orb orb-2" />
      </div>
      <m.p className="hm-greet" {...rise(0)}><i aria-hidden="true" />{greeting(user?.name ?? null)}</m.p>
      <m.h1 id="hm-h" className="hm-title" {...rise(1)}>
        What would you like to{" "}
        <span className="hero-em">
          look into
          <svg className="hero-underline" viewBox="0 0 120 12" preserveAspectRatio="none" aria-hidden="true">
            <m.path d="M3 8c22-6 48-7 62-4s34 3 52-1" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, ease: easeOut, delay: 0.6 }} />
          </svg>
        </span>
        ?
      </m.h1>
      <m.p className="hm-sub" {...rise(2)}>Search real papers, check a bibliography, test an idea against the literature, or open one of your own papers. Pick the tool, write, press Enter.</m.p>

      <m.form className="hm-box" onSubmit={(e) => { e.preventDefault(); send(); }} {...rise(3)}>
        <label className="sr-only" htmlFor={`${id}-in`}>Your question or text</label>
        <textarea
          id={`${id}-in`}
          ref={inputRef}
          className="hm-input"
          rows={1}
          value={query}
          placeholder={current.placeholder}
          disabled={tool === "paper"}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={onKey}
          aria-describedby={`${id}-help`}
          maxLength={20000}
        />
        <div className="hm-bar">
          <ModeMenu tool={tool} onChange={setTool} />
          <m.button type="submit" className="hm-send" aria-label={tool === "paper" ? "Open My papers" : `${current.name}: send`} disabled={tool !== "paper" && !ready} whileTap={{ scale: 0.92 }} transition={springPop}>
            <ArrowUp size={18} aria-hidden="true" />
          </m.button>
        </div>
      </m.form>
      <p className="hm-fine" id={`${id}-help`}>{current.help} AI can misread a paper; every paper listed is a real record.</p>

      <m.div className="hm-pills" role="group" aria-label="Choose a tool" {...rise(4)}>
        {TOOLS.map((t) => (
          <button key={t.id} type="button" className="hm-pill" aria-pressed={tool === t.id} onClick={() => { setTool(t.id); inputRef.current?.focus(); }}>
            <span className="hm-pill-ico"><t.Icon size={15} aria-hidden="true" /></span>
            {t.name}
          </button>
        ))}
      </m.div>

      <m.div className="hm-cards" {...rise(5)}>
        {user ? (
          <button type="button" className="hm-card" onClick={() => onOpenTool("papers")}>
            <span className="hm-k">My papers</span>
            <strong>{docs.items.length > 0 ? `${docs.items.length} ${docs.items.length === 1 ? "paper" : "papers"} to read and ask` : "Upload a paper and ask it questions"}</strong>
            {covers.length > 0 ? (
              <span className="hm-stack" aria-hidden="true">
                {covers.map((d, i) => <img key={d.id} src={coverUrl(d)} alt="" loading="lazy" decoding="async" style={{ ["--r" as string]: `${[-6, 2, 8][i]}deg` }} />)}
              </span>
            ) : (
              <span className="hm-meta">PDFs, Word and scans are read in your browser</span>
            )}
          </button>
        ) : (
          <button type="button" className="hm-card" onClick={() => onOpenTool("papers")}>
            <span className="hm-k">My papers</span>
            <strong>Sign in to upload papers and ask them questions</strong>
            <span className="hm-meta">Private to your account</span>
          </button>
        )}
        <button type="button" className="hm-card" onClick={() => { setTool("idea"); inputRef.current?.focus(); }}>
          <span className="hm-k">Idea Check</span>
          <strong>See what is already written about your idea</strong>
          <span className="hm-meta">You approve the search first</span>
        </button>
        <button type="button" className="hm-card" onClick={() => { setTool("verify"); inputRef.current?.focus(); }}>
          <span className="hm-k">References</span>
          <strong>Find out which references do not exist</strong>
          <span className="hm-meta">{saved > 0 ? `${saved} saved in your library` : "Paste a bibliography"}</span>
          {saved > 0 && <Bookmark className="hm-card-ico" size={16} aria-hidden="true" />}
        </button>
      </m.div>

      <m.div className="hm-starters" role="group" aria-label="Example searches" {...rise(6)}>
        <span className="hm-try">Try</span>
        {STARTERS.map((s) => (
          <button key={s} type="button" className="chip-btn" onClick={() => onSearch(s)}>{s}</button>
        ))}
      </m.div>
    </section>
  );
}
