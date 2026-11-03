import { Suspense, lazy, useEffect, useState } from "react";

/** Keys that are not "typing": the palette and the sheet are opened with them even from the page, but never from a text field (except Ctrl+K). */
const typing = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable=true]");

/**
 * The palette and the list of shortcuts are in a chunk of their own (`CommandPaletteBody.tsx`): a first visit wants neither, and what it downloads at once has a size budget
 * (apps/web/scripts/budget.mjs). The chunk is fetched a few seconds after the page is idle, so that the first Ctrl+K does not wait for it, and in any case when one of them is first opened.
 */
const loadBody = () => import("./CommandPaletteBody");
const Palette = lazy(() => loadBody().then((m) => ({ default: m.PaletteBody })));
const Sheet = lazy(() => loadBody().then((m) => ({ default: m.SheetBody })));

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
    // out of the way of the first load: the chunk comes a few seconds after the page is up
    const warm = window.setTimeout(() => void loadBody().catch(() => {}), 4000);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(warm);
    };
  }, [openPalette, openSheet]);
}

/** True from the first time `open` is true on: what is shown only when asked for is not even loaded before that, and stays once it was (so that it can leave with its closing animation). */
function useEverOpen(open: boolean): boolean {
  const [ever, setEver] = useState(open);
  if (open && !ever) setEver(true);
  return ever;
}

/**
 * The command palette: type to find a place to go, a paper to open, a theme, or something to do in the paper that is open. The commands come from the parts of the
 * app that are on screen (see `registerCommands`). A combobox and a list, as the ARIA pattern asks: arrows move, Enter does it, Esc closes.
 */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const ever = useEverOpen(open);
  return ever ? (
    <Suspense fallback={null}>
      <Palette open={open} onOpenChange={onOpenChange} />
    </Suspense>
  ) : null;
}

/** Every shortcut in one place; opened with ? (and from the palette). */
export function ShortcutSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const ever = useEverOpen(open);
  return ever ? (
    <Suspense fallback={null}>
      <Sheet open={open} onOpenChange={onOpenChange} />
    </Suspense>
  ) : null;
}
