/**
 * What would be lost if the page went to a new chat now. The Home link starts a new chat, and a person can press it by slip. A conversation that is kept stays in the list of chats, so leaving it loses
 * nothing; two things are not kept anywhere: a message being edited whose words were changed (the draft lives in the editor and nowhere else), and a private chat (gone when it is left, which its own note
 * says). A part of the page that holds such a thing registers a guard for as long as it does: it answers with the sentence to ask the person, or null when nothing would be lost.
 */
const guards = new Set<() => string | null>();

/** Registers a guard. Returns the function that takes it away again (what an effect returns). */
export function registerLeaveGuard(guard: () => string | null): () => void {
  guards.add(guard);
  return () => {
    guards.delete(guard);
  };
}

/** The first thing that would be lost, in a sentence for the person, or null. */
export function leaveWarning(): string | null {
  for (const guard of guards) {
    const said = guard();
    if (said) return said;
  }
  return null;
}

export const PRIVATE_LEAVE_WARNING = "This is a private chat. It is not kept, so if you leave it now it is gone for good. Leave it?";
export const EDIT_LEAVE_WARNING = "You have an edit that is not sent. If you leave now, the change is lost. Leave it?";
