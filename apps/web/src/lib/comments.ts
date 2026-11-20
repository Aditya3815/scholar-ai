import { useCallback, useEffect, useMemo, useState } from "react";
import type { CommentAnchor, DocComment } from "@scholar/shared";
import { addComment, deleteComment, editComment, fetchComments } from "./share";

/**
 * A shared paper's comments (docs/design/paper-share.md, 5), for the reader: loaded once when sharing is on for the paper, kept here, and changed through the API. The counts of open
 * threads are what the dots and the Comments filter show; the threads themselves are drawn by the comments chunk.
 */
export type CommentsApi = {
  status: "off" | "loading" | "ready" | "error";
  comments: DocComment[];
  /** Open threads on one thing (a highlight, a block). */
  openOn: (anchor: CommentAnchor) => number;
  /** All open threads. */
  open: number;
  /** Read again; answers the comments as they are now (null when that failed). */
  reload: () => Promise<DocComment[] | null>;
  add: (q: { anchor?: CommentAnchor; parentId?: string; body: string }) => Promise<DocComment>;
  edit: (id: string, body: string) => Promise<void>;
  resolve: (id: string, resolved: boolean) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

export function useComments(docId: string, on: boolean): CommentsApi {
  const [status, setStatus] = useState<CommentsApi["status"]>(on ? "loading" : "off");
  const [comments, setComments] = useState<DocComment[]>([]);
  const reload = useCallback(async (): Promise<DocComment[] | null> => {
    if (!on) return null;
    try {
      const list = (await fetchComments(docId)).comments;
      setComments(list);
      setStatus("ready");
      return list;
    } catch {
      setStatus("error");
      return null;
    }
  }, [docId, on]);
  useEffect(() => {
    setStatus(on ? "loading" : "off");
    void reload();
  }, [reload, on]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of comments) if (!c.parentId && !c.resolved) m.set(c.anchor, (m.get(c.anchor) ?? 0) + 1);
    return m;
  }, [comments]);
  const openOn = useCallback((a: CommentAnchor) => counts.get(a) ?? 0, [counts]);
  const add = useCallback(
    async (q: { anchor?: CommentAnchor; parentId?: string; body: string }) => {
      const { comment } = await addComment(docId, q);
      setComments((cs) => [...cs.map((c) => (q.parentId && c.id === comment.parentId ? { ...c, resolved: false } : c)), comment]);
      return comment;
    },
    [docId],
  );
  const edit = useCallback(async (id: string, body: string) => {
    const { comment } = await editComment(docId, id, { body });
    setComments((cs) => cs.map((c) => (c.id === id ? comment : c)));
  }, [docId]);
  const resolve = useCallback(async (id: string, resolved: boolean) => {
    const { comment } = await editComment(docId, id, { resolved });
    setComments((cs) => cs.map((c) => (c.id === id ? comment : c)));
  }, [docId]);
  const remove = useCallback(async (id: string) => {
    await deleteComment(docId, id);
    setComments((cs) => cs.filter((c) => c.id !== id && c.parentId !== id));
  }, [docId]);
  return { status, comments, openOn, open: [...counts.values()].reduce((a, b) => a + b, 0), reload, add, edit, resolve, remove };
}
