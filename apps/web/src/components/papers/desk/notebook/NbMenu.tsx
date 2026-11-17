import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

/**
 * The Notebook's small pop-overs (docs/design/paper-reader.md, 19.5): a button and what it opens, under it, inside the panel. Esc and a press outside close it, and the focus goes back to the
 * button. `kind` says what it holds: a menu (the arrows move between its items, Home and End go to its ends), a listbox (the page picker: the arrows choose, Enter takes it) or a dialog
 * (the quote picker, with a search field). Its own small thing, not the app's Pop, so that the notebook's chunk adds no edge to the layer rule.
 */
export function NbPop({
  label,
  kind,
  align = "start",
  className,
  trigger,
  children,
}: {
  label: string;
  kind: "menu" | "listbox" | "dialog";
  align?: "start" | "end";
  className?: string;
  trigger: (p: { open: boolean; toggle: () => void; id: string; ref: React.RefObject<HTMLButtonElement | null> }) => ReactNode;
  children: (close: (refocus?: boolean) => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) window.setTimeout(() => btn.current?.focus({ preventScroll: true }), 0);
  }, []);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!box.current?.contains(t) && !btn.current?.contains(t)) close(false);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [open, close]);
  // opened: the focus goes in (the chosen option of a listbox, the first item of a menu, the field of a dialog)
  useLayoutEffect(() => {
    if (!open) return;
    const el = box.current;
    const first = el?.querySelector<HTMLElement>("[data-autofocus]") ?? el?.querySelector<HTMLElement>('[role="menuitem"], [role="menuitemradio"], input, button, [tabindex="0"]');
    first?.focus({ preventScroll: true });
  }, [open]);
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      return close();
    }
    if (kind !== "menu") return;
    const items = [...(box.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled]), [role="menuitemradio"]:not([disabled])') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const to = e.key === "ArrowDown" ? (i + 1) % items.length : e.key === "ArrowUp" ? (i - 1 + items.length) % items.length : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    items[to]?.focus();
  };
  return (
    <div className={`nb-popwrap${className ? ` ${className}` : ""}`}>
      {trigger({ open, toggle: () => setOpen((o) => !o), id, ref: btn })}
        {open && (
          <div
            ref={box}
            id={id}
            className="nb-pop"
            data-align={align}
            data-kind={kind}
            role={kind === "dialog" ? "dialog" : undefined}
            aria-label={kind === "dialog" ? label : undefined}
            onKeyDown={keys}
          >
            {children(close)}
          </div>
        )}

    </div>
  );
}

/** A menu's item: a button with role="menuitem" (or menuitemradio, with aria-checked), not in the tab order (the arrows reach it). */
export function NbItem({ children, onPick, checked, disabled, danger }: { children: ReactNode; onPick: () => void; checked?: boolean; disabled?: boolean; danger?: boolean }) {
  return (
    <button type="button" role={checked === undefined ? "menuitem" : "menuitemradio"} aria-checked={checked} tabIndex={-1} disabled={disabled} className="desk-menu-item" data-danger={danger || undefined} onClick={onPick}>
      {children}
    </button>
  );
}
