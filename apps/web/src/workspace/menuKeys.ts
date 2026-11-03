import type { KeyboardEvent } from "react";

/** The items of a menu a key can move to: every kind of menu item that is not disabled (a checkbox item is as much a part of the menu as a plain one). */
const ITEMS = '[role="menuitem"]:not(:disabled), [role="menuitemcheckbox"]:not(:disabled), [role="menuitemradio"]:not(:disabled)';

/**
 * The keys of a menu that is declared `role="menu"`: ArrowDown and ArrowUp move between its items (round the ends), Home and End go to the first and the last. A screen reader that has put the person in
 * its forms mode for a menu sends exactly these, and nothing else would move them: Tab is not what the menu pattern promises. Put on the menu's own element (`onKeyDown={menuKeys}`).
 */
export function menuKeys(e: KeyboardEvent<HTMLElement>) {
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>(ITEMS)];
  if (items.length === 0) return;
  const at = items.indexOf(document.activeElement as HTMLElement);
  const go = (to: number) => {
    e.preventDefault();
    items[(to + items.length) % items.length]?.focus();
  };
  if (e.key === "ArrowDown") go(at + 1);
  else if (e.key === "ArrowUp") go(at < 0 ? items.length - 1 : at - 1);
  else if (e.key === "Home") go(0);
  else if (e.key === "End") go(items.length - 1);
}
