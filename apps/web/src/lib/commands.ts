import { useSyncExternalStore } from "react";

/** One thing the command palette (Ctrl+K) can do. */
export type Command = {
  id: string;
  label: string;
  /** The group it is listed under ("Go to", "Theme", "Your papers", "This paper"...). */
  group: string;
  /** Extra words that find it ("dark" finds "Dark theme", "split" finds "Open another paper beside this one"). */
  keywords?: string;
  /** What is shown at the right: a shortcut, or a few words about it. */
  hint?: string;
  run: () => void;
};

/** A part of the app that adds commands while it is on screen (the reader adds its own while a paper is open). */
export type CommandProvider = {
  id: string;
  /** The commands now. */
  commands: () => Command[];
  /** Commands that depend on what is typed ("Go to page 12"). */
  dynamic?: (query: string) => Command[];
};

let providers: CommandProvider[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Add a provider; the returned function removes it. A second provider with the same id replaces the first. */
export function registerCommands(p: CommandProvider): () => void {
  providers = [...providers.filter((x) => x.id !== p.id), p];
  emit();
  return () => {
    if (providers.includes(p)) {
      providers = providers.filter((x) => x !== p);
      emit();
    }
  };
}

export const useProviders = (): readonly CommandProvider[] =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => providers,
    () => providers,
  );
