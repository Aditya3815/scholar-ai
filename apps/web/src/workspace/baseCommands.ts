import { useEffect, useRef } from "react";
import { useAuth } from "../lib/auth";
import { registerCommands, type Command } from "../lib/commands";
import { useDocs } from "../lib/documents";
import { requestSearch } from "../lib/jump";
import { setThemePref } from "../lib/prefs";
import { PAPERS_NAME } from "../lib/workspace";
import type { View } from "../components/TopNav";

/** The commands that are always there in the new look: where to go, which paper to open, the theme, help. */
export function useBaseCommands({ navigate, goHome, openSheet }: { navigate: (v: View, docId?: string | null) => void; goHome: () => void; openSheet: () => void }) {
  const { user } = useAuth();
  const docs = useDocs().items;
  // the commands call the latest functions without being registered again at every render
  const live = useRef({ navigate, goHome, openSheet });
  live.current = { navigate, goHome, openSheet };

  useEffect(() => {
    const go = (label: string, run: () => void, keywords?: string): Command => ({ id: `go-${label}`, label, group: "Go to", keywords, run });
    const commands = (): Command[] => [
      go("Home", () => live.current.goHome(), "start search prompt"),
      go(PAPERS_NAME, () => live.current.navigate("papers"), "papers upload pdf workspace"),
      go("Library", () => live.current.navigate("library"), "saved"),
      go("Check references", () => live.current.navigate("verify"), "verify bibliography"),
      go("Idea Check", () => live.current.navigate("idea"), "novelty prior art"),
      ...(user ? [go("Settings", () => live.current.navigate("settings"), "account data export delete")] : []),
      ...(["auto", "light", "dark", "read"] as const).map((t): Command => ({ id: `theme-${t}`, label: `${t[0]!.toUpperCase()}${t.slice(1)} theme`, group: "Theme", keywords: t === "dark" ? "night" : t === "read" ? "reading sepia" : t === "auto" ? "system" : "day", run: () => setThemePref(t) })),
      ...docs.map((d): Command => ({ id: `paper-${d.id}`, label: d.title, group: "Your papers", keywords: `${d.tags.join(" ")} open`, hint: d.readState === "done" ? "Done" : d.readState === "reading" ? "Reading" : undefined, run: () => live.current.navigate("papers", d.id) })),
      { id: "help-keys", label: "Keyboard shortcuts", group: "Help", keywords: "keys shortcuts help", hint: "?", run: () => live.current.openSheet() },
    ];
    return registerCommands({
      id: "base",
      commands,
      dynamic: (q) => (user && q.length >= 2 ? [{ id: "search-papers", label: `Search my papers, highlights and notes for “${q}”`, group: "Search", run: () => { live.current.navigate("papers"); requestSearch(q); } }] : []),
    });
  }, [user, docs]);
}
