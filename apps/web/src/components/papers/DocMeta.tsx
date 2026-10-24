import { BookCheck, BookOpen, Bookmark, Tag, X } from "lucide-react";
import { useId, useState, type KeyboardEvent } from "react";
import { MAX_TAGS_PER_DOC, MAX_TAG_CHARS, cleanTag, tagKey, type DocumentInfo, type ReadState } from "@scholar/shared";
import { setMeta, useDocs } from "../../lib/documents";
import { showNotice } from "../../lib/notice";
import { Pop } from "../Pop";

export const STATE_LABEL: Record<ReadState, string> = { to_read: "To read", reading: "Reading", done: "Done" };
const STATE_ICON = { to_read: Bookmark, reading: BookOpen, done: BookCheck } as const;
export const STATES: ReadState[] = ["to_read", "reading", "done"];

/** One small control for what a reader wants to say about a paper: where it stands, and a few words of their own (tags). */
export function DocMeta({ doc, compact = false, onChange }: { doc: DocumentInfo; compact?: boolean; onChange?: (d: DocumentInfo) => void }) {
  const Icon = STATE_ICON[doc.readState];
  return (
    <Pop
      label={`Status and tags of ${doc.title}`}
      trigger={() => (
        <button type="button" className="meta-chip" data-state={doc.readState} aria-label={`${STATE_LABEL[doc.readState]}${doc.tags.length ? `, ${doc.tags.length} ${doc.tags.length === 1 ? "tag" : "tags"}` : ""}. Change status or tags`}>
          <Icon size={13} aria-hidden="true" />
          <span>{STATE_LABEL[doc.readState]}</span>
          {!compact && doc.tags.length > 0 && <span className="meta-chip-n"><Tag size={11} aria-hidden="true" />{doc.tags.length}</span>}
        </button>
      )}
    >
      <MetaEditor doc={doc} onChange={onChange} />
    </Pop>
  );
}

function MetaEditor({ doc, onChange }: { doc: DocumentInfo; onChange?: (d: DocumentInfo) => void }) {
  const all = useDocs().items;
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const listId = useId();
  const have = new Set(doc.tags.map(tagKey));
  // tags used on other papers, offered as suggestions (most used first)
  const counts = new Map<string, { label: string; n: number }>();
  for (const d of all) for (const t of d.tags) if (!have.has(tagKey(t))) counts.set(tagKey(t), { label: t, n: (counts.get(tagKey(t))?.n ?? 0) + 1 });
  const suggestions = [...counts.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label)).slice(0, 6);

  async function save(change: { readState?: ReadState; tags?: string[] }) {
    setBusy(true);
    try {
      const saved = await setMeta(doc.id, change); // not inside the optional call below: its arguments are not evaluated when there is no onChange
      onChange?.(saved);
    } catch {
      showNotice("That could not be saved. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  function add(raw: string) {
    // a comma or a paste of several words separated by commas adds each one
    const next = [...doc.tags];
    for (const part of raw.split(",")) {
      const t = cleanTag(part);
      if (t && !next.some((x) => tagKey(x) === tagKey(t))) next.push(t);
    }
    if (next.length === doc.tags.length) return setDraft("");
    if (next.length > MAX_TAGS_PER_DOC) return showNotice(`A paper can have ${MAX_TAGS_PER_DOC} tags at most.`);
    setDraft("");
    void save({ tags: next });
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(draft);
    } else if (e.key === "Backspace" && !draft && doc.tags.length) void save({ tags: doc.tags.slice(0, -1) });
  };

  return (
    <div className="meta-ed">
      <p className="meta-ed-h" id={`${listId}-s`}>Status</p>
      <div className="meta-states" role="group" aria-labelledby={`${listId}-s`}>
        {STATES.map((s) => {
          const I = STATE_ICON[s];
          return (
            <button key={s} type="button" className="meta-state" aria-pressed={doc.readState === s} disabled={busy} onClick={() => doc.readState !== s && void save({ readState: s })}>
              <I size={14} aria-hidden="true" />
              <span>{STATE_LABEL[s]}</span>
            </button>
          );
        })}
      </div>
      <p className="meta-ed-h" id={`${listId}-t`}>Tags</p>
      <ul className="meta-tags" aria-labelledby={`${listId}-t`}>
        {doc.tags.map((t) => (
          <li key={t} className="tag-chip">
            <span>{t}</span>
            <button type="button" aria-label={`Remove tag ${t}`} disabled={busy} onClick={() => void save({ tags: doc.tags.filter((x) => x !== t) })}>
              <X size={12} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {doc.tags.length < MAX_TAGS_PER_DOC ? (
        <>
          <label className="sr-only" htmlFor={`${listId}-i`}>Add a tag</label>
          <input
            id={`${listId}-i`}
            className="meta-input"
            value={draft}
            maxLength={MAX_TAG_CHARS}
            placeholder="Add a tag, then press Enter"
            autoComplete="off"
            enterKeyHint="done"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            onBlur={() => draft.trim() && add(draft)}
          />
        </>
      ) : (
        <p className="meta-fine">That is {MAX_TAGS_PER_DOC} tags, the most a paper can have.</p>
      )}
      {suggestions.length > 0 && doc.tags.length < MAX_TAGS_PER_DOC && (
        <div className="meta-sugg" aria-label="Tags you already use">
          {suggestions.map((s) => (
            <button key={s.label} type="button" className="tag-chip tag-chip-btn" disabled={busy} onClick={() => add(s.label)}>+ {s.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The tags of a paper as small read-only chips on its card; pressing one filters the list by it. */
export function TagChips({ tags, active, onPick }: { tags: string[]; active?: string | null; onPick?: (t: string) => void }) {
  if (tags.length === 0) return null;
  return (
    <ul className="dc-tags" aria-label="Tags">
      {tags.map((t) => (
        <li key={t}>
          {onPick ? (
            <button type="button" className="tag-chip tag-chip-btn" aria-pressed={active ? tagKey(active) === tagKey(t) : false} onClick={() => onPick(t)}>{t}</button>
          ) : (
            <span className="tag-chip">{t}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** How far a paper has been read: the furthest page reached, out of all its pages. Only drawn once there is something to show. */
export function progressOf(doc: Pick<DocumentInfo, "pages" | "maxPage" | "readState">): number {
  if (doc.readState === "done") return 1;
  if (!doc.pages || !doc.maxPage || doc.maxPage < 2) return 0;
  return Math.min(1, doc.maxPage / doc.pages);
}
