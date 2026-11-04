/** What the section of your own papers is called: you draw and highlight on the papers there, so it is a workspace, not a list. */
export const PAPERS_NAME = "My Workspace";

/** A one-line hand-off from the home box to a tool page that keeps its own draft (read when the page is drawn, removed once it is on screen). */
const HANDOFF = "scholar.handoff";
export function putHandoff(tool: "verify" | "idea", text: string) {
  try {
    sessionStorage.setItem(HANDOFF, JSON.stringify({ tool, text }));
  } catch {
    /* private mode: the tool opens empty */
  }
}
/**
 * The text Home handed to this tool's page, or "". It only READS: it is called while the page is being drawn, and React may draw a page twice (it throws a first try away when something below it is still
 * being fetched, or when another update comes in while it is drawing; both were seen when the page's code was already in the browser). A read that took the text out would leave the second try with nothing,
 * and the page would open with an empty box. The page calls `clearHandoff` once it is on screen.
 */
export function readHandoff(tool: "verify" | "idea"): string {
  try {
    const raw = sessionStorage.getItem(HANDOFF);
    if (!raw) return "";
    const v = JSON.parse(raw) as { tool?: string; text?: string };
    return v.tool === tool && typeof v.text === "string" ? v.text : "";
  } catch {
    return "";
  }
}
/** The page has taken what it was handed: it is used once, so a later visit to the page opens as it does on its own. */
export function clearHandoff(tool: "verify" | "idea"): void {
  try {
    const raw = sessionStorage.getItem(HANDOFF);
    if (raw && (JSON.parse(raw) as { tool?: string }).tool === tool) sessionStorage.removeItem(HANDOFF);
  } catch {
    /* nothing to clear */
  }
}

/**
 * Things the intro page may promise only once the product does them. Each is switched on in the phase that builds it
 * (docs/design/unified-workspace.md), so the page never says something the product cannot do yet.
 */

/**
 * Built and tested, but set aside for now (decision of 25 Oct): naming the highlight colours, and reading two papers side by side. Their code stays; they are off
 * for everyone. To look at one, put its name in this browser's storage: localStorage.setItem("scholar.parked", "names,split") (the test of each does exactly that).
 */
function parkedOn(name: string): boolean {
  try {
    return (localStorage.getItem("scholar.parked") ?? "").split(",").map((x) => x.trim()).includes(name);
  } catch {
    return false;
  }
}
export const PARKED = {
  colourNames: typeof localStorage === "undefined" ? false : parkedOn("names"),
  splitView: typeof localStorage === "undefined" ? false : parkedOn("split"),
} as const;
