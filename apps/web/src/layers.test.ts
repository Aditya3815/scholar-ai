import { describe, expect, it } from "vitest";
import { violations } from "@scholar/test-support/layers.mjs";

/**
 * The dependency rule of the page (docs/design/untangle.md, 1.5), checked on every import of apps/web/src. Allowed, and nothing else:
 *   - App.tsx, main.tsx and routes.ts import anything of this package;
 *   - lib/ imports shared and lib/, never a component;
 *   - components/ui/ imports lib/ and shared;
 *   - a feature (a folder of components/, and today workspace/ and the loose files of components/, which F18 to F21 sort into ui/ and the
 *     features) imports ui/, lib/, shared, its own files, and of another feature only its index.ts;
 *   - src/test/ (the stand-ins of the browser's storage) is imported by tests only;
 *   - nothing imports apps/api, packages/test-support (tests may) or a file of shared by its path (`@scholar/shared/src/...`);
 *   - a test imports and reads its own package, shared and test-support only (never apps/api).
 * Style sheets, pictures and .riv files are not code: which folder imports which sheet is F23 (Stylesheets by owner), not this rule.
 * ALLOW lists the edges that break it today (12 Nov 2026). Each wave of the untangle takes edges off it; a new edge fails, and so does an entry that is
 * no longer an edge (take it off). The plan is done when ALLOW is empty.
 */

type Place = { kind: "root" } | { kind: "lib" } | { kind: "ui" } | { kind: "feature"; feature: string } | { kind: "harness" } | { kind: "test" };
const SRC = "apps/web/src/";
const ROOT_FILES = new Set(["App.tsx", "main.tsx", "routes.ts"]);

function placeOf(path: string): Place {
  const p = path.slice(SRC.length);
  if (/\.test\.tsx?$/.test(p)) return { kind: "test" };
  if (p.startsWith("test/")) return { kind: "harness" };
  if (ROOT_FILES.has(p)) return { kind: "root" };
  const parts = p.split("/");
  if (parts[0] === "lib") return { kind: "lib" };
  if (parts[0] === "components") {
    if (parts.length === 2) return { kind: "feature", feature: "components" };
    if (parts[1] === "ui") return { kind: "ui" };
    return { kind: "feature", feature: parts[1]! };
  }
  return { kind: "feature", feature: parts[0]! };
}

type Edge = { from: string; to: string; spec: string; typeOnly: boolean; kind: string; test: boolean };

function rule(e: Edge): string | null {
  if (e.to.startsWith("apps/api/")) return "the page never imports or reads the API";
  if (e.to.startsWith("packages/test-support/")) return e.test ? null : "test support is for tests";
  if (e.to.startsWith("packages/shared/")) return e.spec.startsWith("@scholar/shared/src/") ? "a file of shared by its path" : null;
  if (!e.to.startsWith(SRC)) return e.test ? null : "outside this package";
  if (e.test) return null; // a test may reach any file of its own package
  if (!/.(ts|tsx|mjs|js)$/.test(e.to)) return null; // a style sheet, a picture or a .riv file: where styles live is F23, not this rule
  const from = placeOf(e.from);
  const to = placeOf(e.to);
  if (to.kind === "test") return "production imports a test";
  if (to.kind === "harness") return from.kind === "harness" ? null : "src/test/ is for tests";
  if (from.kind === "root" || from.kind === "harness") return null;
  if (from.kind === "lib") return to.kind === "lib" ? null : "lib/ imports a component or the app";
  if (from.kind === "ui") return to.kind === "ui" || to.kind === "lib" ? null : "ui/ imports a feature or the app";
  if (from.kind === "feature") {
    if (to.kind === "lib" || to.kind === "ui") return null;
    if (to.kind === "root") return "a feature imports the app";
    if (to.kind === "feature") {
      if (to.feature === from.feature) return null;
      if (/\/index\.tsx?$/.test(e.to)) return null;
      return `${from.feature} imports ${to.feature} past its index.ts`;
    }
  }
  return null;
}

/** Today's edges against the rule. */
const ALLOW: string[] = [
  "web/App.tsx -> shared/trending-row.ts",
  "web/components/idea/IdeaPage.tsx -> web/components/ProviderButtons.tsx",
  "web/components/idea/IdeaPage.tsx -> web/components/legal/PrivacyCard.tsx",
  "web/components/idea/IdeaResults.tsx -> web/components/ReportButton.tsx",
  "web/components/idea/IdeaResults.tsx -> web/components/ResultCard.tsx",
  "web/components/litscan/LitscanPage.tsx -> web/components/ConfirmDialog.tsx",
  "web/components/litscan/LitscanPage.tsx -> web/components/ProviderButtons.tsx",
  "web/components/litscan/LitscanPage.tsx -> web/components/legal/PrivacyCard.tsx",
  "web/components/litscan/Review.tsx -> web/components/Pop.tsx",
  "web/components/litscan/Setu.tsx -> web/components/RivePiece.tsx",
  "web/components/oa/OaAskSheet.tsx -> web/components/SignInDialog.tsx",
  "web/components/oa/OaAskSheet.tsx -> web/components/papers/AskPanel.tsx",
  "web/components/papers/AskPanel.tsx -> web/components/ReportButton.tsx",
  "web/components/papers/AskPanel.tsx -> web/components/ResultCard.tsx",
  "web/components/papers/DocMeta.tsx -> web/components/Pop.tsx",
  "web/components/papers/DocWorkspace.tsx -> web/components/Pop.tsx",
  "web/components/papers/DocWorkspace.tsx -> web/components/ThemeSwitch.tsx",
  "web/components/papers/DropBox.tsx -> web/components/RivePiece.tsx",
  "web/components/papers/PapersPage.tsx -> web/components/ConfirmDialog.tsx",
  "web/components/papers/PapersPage.tsx -> web/components/ProviderButtons.tsx",
  "web/components/papers/PapersPage.tsx -> web/components/legal/PrivacyCard.tsx",
  "web/components/papers/PdfViewer.tsx -> web/components/Pop.tsx",
  "web/components/papers/Reading.tsx -> web/components/RivePiece.tsx",
  "web/components/papers/ReferencesPanel.tsx -> web/components/verify/RefCard.tsx",
  "web/components/papers/ReferencesPanel.tsx -> web/components/verify/VerifySummary.tsx",
  "web/components/verify/RefCard.tsx -> web/components/CiteMenu.tsx",
  "web/components/verify/RefCard.tsx -> web/components/ReportButton.tsx",
  "web/components/verify/VerifySummary.tsx -> web/components/CiteMenu.tsx",
  "web/lib/annotated-pdf.ts -> web/components/papers/InkLayer.tsx",
  "web/lib/trending.ts -> shared/trending-row.ts",
  "web/workspace/ChatTool.tsx -> web/components/SignInDialog.tsx",
  "web/workspace/ChatTool.tsx -> web/components/oa/OaAskSheet.tsx",
  "web/workspace/ChatTool.tsx -> web/components/papers/AskPanel.tsx",
  "web/workspace/ChatView.tsx -> web/components/Pop.tsx",
  "web/workspace/ChatView.tsx -> web/components/ResultCard.tsx",
  "web/workspace/ChatView.tsx -> web/components/SignInDialog.tsx",
  "web/workspace/ChatView.tsx -> web/components/idea/IdeaPage.tsx",
  "web/workspace/HomeChips.tsx -> shared/trending-row.ts",
  "web/workspace/HomeExtras.tsx -> web/components/papers/DocMeta.tsx",
  "web/workspace/HomePage.tsx -> shared/trending-row.ts",
  "web/workspace/HomePage.tsx -> web/components/Pop.tsx",
  "web/workspace/Pages.tsx -> web/components/LibraryList.tsx",
  "web/workspace/Pages.tsx -> web/components/ProviderButtons.tsx",
  "web/workspace/Pages.tsx -> web/components/ReadingControls.tsx",
  "web/workspace/Pages.tsx -> web/components/SettingsDialog.tsx",
  "web/workspace/Pages.tsx -> web/components/ThemeSwitch.tsx",
  "web/workspace/Shell.tsx -> web/components/Logo.tsx",
  "web/workspace/Shell.tsx -> web/components/SignInDialog.tsx",
  "web/workspace/Shell.tsx -> web/components/ThemeSwitch.tsx",
  "web/workspace/intro/IntroPage.tsx -> web/components/Footer.tsx",
  "web/workspace/intro/IntroPage.tsx -> web/components/Logo.tsx",
  "web/workspace/intro/IntroPage.tsx -> web/components/ProviderButtons.tsx",
  "web/workspace/intro/IntroPage.tsx -> web/components/SignInDialog.tsx",
  "web/workspace/intro/IntroPage.tsx -> web/components/ThemeSwitch.tsx",
  "web/workspace/starters.test.ts -> shared/trending.ts",
];

describe("the page's dependency rule (docs/design/untangle.md, 1.5)", () => {
  const found = violations("apps/web/src", rule);

  it("finds the imports (the parser read the files)", () => {
    expect(found.files).toBeGreaterThan(100);
    expect(found.edges).toBeGreaterThan(400);
  });

  it("has no edge against the rule that is not on the allowlist, and no allowlist entry that is no longer an edge", () => {
    const allow = new Set(ALLOW);
    const fresh = found.lines.filter((l: string) => !allow.has(l)).map((l: string) => found.reasons.get(l));
    const gone = ALLOW.filter((l) => !found.lines.includes(l));
    expect(fresh, "new edges against the rule: change the import, or the plan").toEqual([]);
    expect(gone, "edges that are gone: take them off ALLOW").toEqual([]);
  });
});
