// A module of its own (no imports), so that its few lines go with the lazy chunks that use them, not into the first load where notebook.ts sits.
/**
 * A page's name on screen (the notes polish of 19 Nov): its title, or "Page N" by its place when it has none. Pages made before 19 Nov were given the title "Untitled page", which
 * is read as none, so ten such pages no longer look alike. Display only: the stored title is not changed.
 */
export const LEGACY_PAGE_TITLE = "Untitled page";
export const pageLabel = (title: string, index: number): string => (title.trim() && title.trim() !== LEGACY_PAGE_TITLE ? title : `Page ${index + 1}`);
/** A new page's title: "Page N", N the page count plus one, or the next number after it that no page shows. */
export const nextPageName = (labels: readonly string[]): string => {
  const used = new Set(labels.map((l) => l.trim()));
  let n = labels.length + 1;
  while (used.has(`Page ${n}`)) n++;
  return `Page ${n}`;
};
/** A paper's name on screen ("grid" is called Graph, as in the mock; the stored value stays `grid`). */
export const NOTEBOOK_STYLE_NAMES = { plain: "Plain", ruled: "Ruled", dotted: "Dotted", grid: "Graph" } as const;
