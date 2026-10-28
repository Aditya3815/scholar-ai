import { useSyncExternalStore } from "react";
import { createPersistedStore } from "./store";

/* ---------- Theme ----------
 * "auto" = OS preference follow karo (data-theme attribute hata do).
 * Key "theme" wahi hai jo index.html ka inline script padhta hai (flash-free first paint). */
export type ThemePref = "auto" | "light" | "dark" | "read";

const listeners = new Set<() => void>();

function readTheme(): ThemePref {
  try {
    const t = localStorage.getItem("theme");
    if (t === "light" || t === "dark" || t === "read") return t;
  } catch {
    /* ignore */
  }
  return "auto";
}

let themePref: ThemePref = readTheme();

export function setThemePref(next: ThemePref) {
  const root = document.documentElement;
  root.classList.add("theme-anim"); // 260 ms cross-fade, phir hata do
  window.setTimeout(() => root.classList.remove("theme-anim"), 320);
  if (next === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", next);
  try {
    if (next === "auto") localStorage.removeItem("theme");
    else localStorage.setItem("theme", next);
  } catch {
    /* ignore */
  }
  themePref = next;
  listeners.forEach((l) => l());
}

/** The theme preference now (outside React, for code that must read it at one moment). */
export const getThemePref = (): ThemePref => themePref;

export function useThemePref(): ThemePref {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => themePref,
    () => "auto",
  );
}

/* ---------- Reading preferences ---------- */
export type ReadingPrefs = {
  size: number; // px, 15..24
  width: "narrow" | "medium" | "wide";
  font: "serif" | "sans" | "easy";
};

const DEFAULT_READING: ReadingPrefs = { size: 17, width: "medium", font: "serif" };
const WIDTH: Record<ReadingPrefs["width"], string> = { narrow: "56ch", medium: "66ch", wide: "80ch" };
const FONT: Record<ReadingPrefs["font"], string> = {
  serif: "var(--font-serif)",
  sans: "var(--font-ui)",
  easy: "var(--font-easy)",
};

export const readingStore = createPersistedStore<ReadingPrefs>("scholar.reading.v1", DEFAULT_READING, (raw) => {
  const r = (raw ?? {}) as Partial<ReadingPrefs>;
  return {
    size: typeof r.size === "number" ? Math.min(24, Math.max(15, r.size)) : DEFAULT_READING.size,
    width: r.width && r.width in WIDTH ? r.width : DEFAULT_READING.width,
    font: r.font && r.font in FONT ? r.font : DEFAULT_READING.font,
  };
});

export function applyReadingPrefs(p: ReadingPrefs) {
  const s = document.documentElement.style;
  s.setProperty("--read-size", `${p.size / 16}rem`);
  s.setProperty("--read-measure", WIDTH[p.width]);
  s.setProperty("--read-font", FONT[p.font]);
  s.setProperty("--read-leading", p.font === "easy" ? "1.8" : "1.7");
}

export function initPrefs() {
  applyReadingPrefs(readingStore.get());
  readingStore.subscribe(() => applyReadingPrefs(readingStore.get()));
}
