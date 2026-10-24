import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, m } from "motion/react";
import { CornerDownLeft, Keyboard, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { paletteRank } from "@scholar/shared";
import { useProviders, type Command } from "../lib/commands";
import { easeOut } from "../lib/motion";

/** Keys that are not "typing": the palette and the sheet are opened with them even from the page, but never from a text field (except Ctrl+K). */
const typing = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable=true]");

/** Ctrl+K (or Cmd+K) opens the palette from anywhere; ? opens the list of shortcuts when nothing is being typed. */
export function useGlobalKeys(openPalette: () => void, openSheet: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openPalette();
      } else if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey && !typing(e.target) && !(e.target as HTMLElement | null)?.closest?.("[role=dialog]")) {
        e.preventDefault();
        openSheet();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openPalette, openSheet]);
}

/**
 * The command palette: type to find a place to go, a paper to open, a theme, or something to do in the paper that is open. The commands come from the parts of the
 * app that are on screen (see `registerCommands`). A combobox and a list, as the ARIA pattern asks: arrows move, Enter does it, Esc closes.
 */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const providers = useProviders();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const id = useId();
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  const results = useMemo(() => {
    if (!open) return [];
    const all = providers.flatMap((p) => p.commands());
    const extra = query.trim() ? providers.flatMap((p) => p.dynamic?.(query.trim()) ?? []) : [];
    // "go to page 12" goes first; "search my papers for ..." is the last resort, after what matched by name
    return [...extra.filter((c) => c.group !== "Search"), ...paletteRank(all, query), ...extra.filter((c) => c.group === "Search")].slice(0, 60);
  }, [open, providers, query]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    onOpenChange(false);
    // after the dialog has closed, so that focus goes back to the page before the command moves it
    window.setTimeout(() => c.run(), 30);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Home" && e.ctrlKey) {
      setActive(0);
    } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      run(results[active]);
    }
  };

  // the groups, in the order their first command appears
  const groups: { name: string; items: { c: Command; index: number }[] }[] = [];
  results.forEach((c, index) => {
    let g = groups.find((x) => x.name === c.group);
    if (!g) groups.push((g = { name: c.group, items: [] }));
    g.items.push({ c, index });
  });

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <m.div className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} />
            </Dialog.Overlay>
            <div className="palette-wrap">
              <Dialog.Content asChild forceMount aria-describedby={undefined}>
                <m.div className="palette" initial={{ opacity: 0, y: -12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18, ease: easeOut }} onKeyDown={onKey}>
                  <Dialog.Title className="sr-only">Command palette</Dialog.Title>
                  <div className="palette-in">
                    <Search size={17} aria-hidden="true" />
                    <input
                      autoFocus
                      role="combobox"
                      aria-expanded="true"
                      aria-controls={`${id}-list`}
                      aria-activedescendant={results[active] ? `${id}-o${active}` : undefined}
                      aria-autocomplete="list"
                      aria-label="Search commands, papers and pages"
                      placeholder="Go to a page, open a paper, change the theme…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <Dialog.Close className="palette-x" aria-label="Close">
                      <X size={16} aria-hidden="true" />
                    </Dialog.Close>
                  </div>
                  <ul ref={list} id={`${id}-list`} className="palette-list" role="listbox" aria-label="Results">
                    {groups.map((g) => (
                      <li key={g.name} role="presentation">
                        <p className="palette-g" role="presentation">{g.name}</p>
                        <ul role="group" aria-label={g.name}>
                          {g.items.map(({ c, index }) => (
                            <li
                              key={c.id}
                              id={`${id}-o${index}`}
                              role="option"
                              data-index={index}
                              aria-selected={index === active}
                              className="palette-opt"
                              onMouseMove={() => active !== index && setActive(index)}
                              onClick={() => run(c)}
                            >
                              <span className="palette-label">{c.label}</span>
                              {c.hint && <span className="palette-hint">{c.hint}</span>}
                              {index === active && <CornerDownLeft size={14} className="palette-enter" aria-hidden="true" />}
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                    {results.length === 0 && <li className="palette-none" role="presentation">Nothing matches “{query}”.</li>}
                  </ul>
                  <p className="palette-foot" aria-hidden="true">
                    <span><kbd>↑</kbd> <kbd>↓</kbd> choose</span>
                    <span><kbd>Enter</kbd> do it</span>
                    <span><kbd>Esc</kbd> close</span>
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

const SECTIONS: { name: string; rows: [string[], string][] }[] = [
  {
    name: "Anywhere",
    rows: [
      [["Ctrl", "K"], "Command palette: go anywhere, open a paper, change the theme"],
      [["?"], "This list"],
      [["/"], "Go to the search box"],
    ],
  },
  {
    name: "Reading a paper",
    rows: [
      [["Ctrl", "F"], "Find in this paper"],
      [["F"], "Focus mode: the paper takes the whole window (press again to bring the side panel back)"],
    ],
  },
  {
    name: "Drawing tools (when they are open)",
    rows: [
      [["V"], "Select and read"],
      [["P"], "Pen"],
      [["H"], "Highlighter"],
      [["E"], "Eraser"],
      [["L"], "Line"],
      [["A"], "Arrow"],
      [["R"], "Rectangle"],
      [["O"], "Ellipse"],
      [["T"], "Text box"],
      [["N"], "Sticky note"],
      [["S"], "Lasso: loop round things to move or delete them"],
      [["Shift"], "Hold while drawing a line for a straight angle, a rectangle or ellipse for a square or circle"],
      [["Ctrl", "Z"], "Undo"],
      [["Ctrl", "Shift", "Z"], "Redo (also Ctrl+Y)"],
      [["Delete"], "Delete what the lasso chose"],
      [["Esc"], "Clear the choice; press again to close the tools"],
    ],
  },
];

/** Every shortcut in one place; opened with ? (and from the palette). */
export function ShortcutSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <m.div className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} />
            </Dialog.Overlay>
            <div className="modal-wrap">
              <Dialog.Content asChild forceMount aria-describedby="keys-desc">
                <m.div className="modal keys" initial={{ opacity: 0, y: 14, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.2, ease: easeOut }}>
                  <div className="modal-head">
                    <Dialog.Title className="modal-title"><Keyboard size={18} aria-hidden="true" /> Keyboard shortcuts</Dialog.Title>
                    <Dialog.Close className="icon-btn icon-btn-sm" aria-label="Close"><X size={16} aria-hidden="true" /></Dialog.Close>
                  </div>
                  <Dialog.Description id="keys-desc" className="modal-sub">On a Mac, use Cmd where it says Ctrl.</Dialog.Description>
                  {SECTIONS.map((s) => (
                    <section key={s.name} className="keys-sec" aria-label={s.name}>
                      <h3 className="keys-h">{s.name}</h3>
                      <dl className="keys-list">
                        {s.rows.map(([keys, what]) => (
                          <div key={keys.join("+")} className="keys-row">
                            <dt>{keys.map((k, i) => <span key={k}>{i > 0 && " + "}<kbd>{k}</kbd></span>)}</dt>
                            <dd>{what}</dd>
                          </div>
                        ))}
                      </dl>
                    </section>
                  ))}
                </m.div>
              </Dialog.Content>
            </div>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
