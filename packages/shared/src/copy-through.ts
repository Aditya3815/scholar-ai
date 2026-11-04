/*
 * Kept apart from `chat-copy.ts` on purpose: every button that copies something (apps/web/src/lib/copy.ts) needs this, and only the conversation needs the rest of chat-copy.ts (the sources are
 * built there, with the reference formatter of the literature scan). A bundler puts a module in the chunk of the first screen as a whole when one thing in it is wanted there, so what is
 * wanted at the start lives in a module of its own (docs/design/chatview-and-trending.md, C3). `chat-copy.ts` still exports it, so every import of it keeps working.
 */

/**
 * Write to the clipboard by one way after another until one works. A way that answers false, throws, or REJECTS (a refused permission, a page without the press that asked for it) hands over
 * to the next: a failure must not end as a button that did nothing. The first way starts before anything is awaited, because Safari and Firefox take a clipboard write only inside the press that
 * asked for it. The ways themselves (the clipboard API, a selected text field) are in the browser's code, `apps/web/src/lib/copy.ts`.
 */
export async function copyThrough(ways: readonly ((text: string) => boolean | Promise<boolean>)[], text: string): Promise<boolean> {
  for (const way of ways) {
    try {
      if (await way(text)) return true;
    } catch {
      /* the next way */
    }
  }
  return false;
}
