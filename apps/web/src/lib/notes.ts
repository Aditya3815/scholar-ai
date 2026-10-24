import { useCallback, useEffect, useRef, useState } from "react";
import { notesMarkdown, type DocNote, type MarkdownOptions, type NoteColor } from "@scholar/shared";
import { ApiError } from "./documents";

async function call<T>(docId: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/v1/documents/${docId}/notes${path}`, {
    credentials: "same-origin",
    ...init,
    headers: init.body ? { "Content-Type": "application/json" } : undefined,
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { type?: string; title?: string; detail?: string } | null;
    throw new ApiError(res.status, j?.type ?? "error", j?.title ?? "That could not be saved", j?.detail);
  }
  return (await res.json()) as T;
}

export type NotesApi = {
  status: "loading" | "ready" | "error";
  notes: DocNote[];
  /** A message to show when the last change failed (and was not kept). */
  error: string;
  add: (n: { page: number; quote: string; note?: string; color?: NoteColor }) => Promise<DocNote | null>;
  update: (id: string, change: { note?: string; color?: NoteColor }) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

/** The highlights and notes of one paper: loaded once, changed on the server first, then shown (a failed change leaves the list as it was). */
export function useNotes(docId: string): NotesApi {
  const [state, setState] = useState<{ status: NotesApi["status"]; notes: DocNote[]; error: string }>({ status: "loading", notes: [], error: "" });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    setState({ status: "loading", notes: [], error: "" });
    call<{ items: DocNote[] }>(docId, "")
      .then((r) => alive.current && setState({ status: "ready", notes: r.items, error: "" }))
      .catch(() => alive.current && setState({ status: "error", notes: [], error: "Your notes could not be loaded." }));
    return () => {
      alive.current = false;
    };
  }, [docId]);

  const fail = (e: unknown) => setState((s) => ({ ...s, error: e instanceof Error ? e.message : "That could not be saved." }));
  const byPage = (a: DocNote, b: DocNote) => a.page - b.page || a.createdAt - b.createdAt;

  const add = useCallback<NotesApi["add"]>(
    async (n) => {
      try {
        const { note } = await call<{ note: DocNote }>(docId, "", { method: "POST", body: JSON.stringify(n) });
        setState((s) => ({ ...s, error: "", notes: [...s.notes, note].sort(byPage) }));
        return note;
      } catch (e) {
        fail(e);
        return null;
      }
    },
    [docId],
  );

  const update = useCallback<NotesApi["update"]>(
    async (id, change) => {
      try {
        const { note } = await call<{ note: DocNote }>(docId, `/${id}`, { method: "PATCH", body: JSON.stringify(change) });
        setState((s) => ({ ...s, error: "", notes: s.notes.map((x) => (x.id === id ? note : x)) }));
      } catch (e) {
        fail(e);
      }
    },
    [docId],
  );

  const remove = useCallback<NotesApi["remove"]>(
    async (id) => {
      try {
        await call<{ ok: boolean }>(docId, `/${id}`, { method: "DELETE" });
        setState((s) => ({ ...s, error: "", notes: s.notes.filter((x) => x.id !== id) }));
      } catch (e) {
        fail(e);
      }
    },
    [docId],
  );

  return { ...state, add, update, remove };
}

/** The notes as Markdown: the quote with its page, then the researcher's own words (the same text the server-side tests cover, see `notesMarkdown` in the shared package). */
export const notesToMarkdown = (title: string, notes: DocNote[], opts?: MarkdownOptions): string => notesMarkdown(title, notes, opts);
