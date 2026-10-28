/** What the section of your own papers is called: you draw and highlight on the papers there, so it is a workspace, not a list. */
export const PAPERS_NAME = "My Workspace";

/** A one-line hand-off from the home box to a tool page that keeps its own draft (read once, then removed). */
const HANDOFF = "scholar.handoff";
export function putHandoff(tool: "verify" | "idea", text: string) {
  try {
    sessionStorage.setItem(HANDOFF, JSON.stringify({ tool, text }));
  } catch {
    /* private mode: the tool opens empty */
  }
}
export function takeHandoff(tool: "verify" | "idea"): string {
  try {
    const raw = sessionStorage.getItem(HANDOFF);
    if (!raw) return "";
    const v = JSON.parse(raw) as { tool?: string; text?: string };
    if (v.tool !== tool) return "";
    sessionStorage.removeItem(HANDOFF);
    return typeof v.text === "string" ? v.text : "";
  } catch {
    return "";
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
