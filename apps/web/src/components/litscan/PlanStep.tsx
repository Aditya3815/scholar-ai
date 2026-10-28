import { BookOpenCheck, Check, Landmark, Loader2, Pencil, Plus, ShieldCheck, X } from "lucide-react";
import { useId, useState } from "react";
import {
  INDIA_SCOPE_HELP,
  INDIA_SCOPE_LABEL,
  LITSCAN_LANGUAGES,
  LITSCAN_LANGUAGE_NAMES,
  LITSCAN_MAX_ITEMS,
  LITSCAN_MIN_ITEMS,
  LITSCAN_QUESTION_CHARS,
  LITSCAN_SEARCH_CHARS,
  LITSCAN_TITLE_CHARS,
  estimateScanTokens,
  type LitscanItem,
  type LitscanLanguage,
  type LitscanPlan,
  type SearchScope,
} from "@scholar/shared";

const tokens = (n: number) => n.toLocaleString("en-IN");

export type Draft = { topic: string; language: LitscanLanguage; scope: SearchScope; items: (LitscanItem & { key: number; editing?: boolean })[]; allowance: LitscanPlan["allowance"] };
let keyCounter = 0;
export const toDraft = (p: LitscanPlan, scope: SearchScope = "all"): Draft => ({ topic: p.topic, language: p.language, scope, items: p.items.map((i) => ({ ...i, key: ++keyCounter })), allowance: p.allowance });

/**
 * The plan, before anything is searched: the themes the review will cover, as cards. Each says its name, the question it is answered as and the English search words (the only part that
 * reaches the public indexes); a theme can be removed, or opened to change any of the three. One press starts the review: that press is the approval of the words shown.
 */
export function PlanStep({ draft, busy, onChange, onBack, onStart }: { draft: Draft; busy: boolean; onChange: (d: Draft) => void; onBack: () => void; onStart: () => void }) {
  const id = useId();
  const n = draft.items.length;
  const estimate = estimateScanTokens(n);
  const left = Math.max(0, draft.allowance.limit - draft.allowance.used);
  const enough = estimate <= left;
  const filled = draft.items.every((i) => (i.title ?? "").trim().length >= 2 && i.question.trim().length >= 3 && i.searchQuery.trim().length >= 2);
  const editing = draft.items.some((i) => i.editing);
  const why =
    n < LITSCAN_MIN_ITEMS ? `Keep at least ${LITSCAN_MIN_ITEMS} themes.`
    : !filled ? "Every theme needs a name, a question and some search words."
    : editing ? "Finish editing the open theme first (press Done)."
    : !enough ? "Today's AI allowance is not enough for this many themes. Remove one, or come back tomorrow."
    : "";
  const set = (key: number, patch: Partial<Draft["items"][number]>) => onChange({ ...draft, items: draft.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) });
  const india = draft.scope === "india";

  return (
    <form
      className="ls-plan"
      onSubmit={(e) => {
        e.preventDefault();
        if (!why && !busy) onStart();
      }}
    >
      <div className="card ls-card">
        <p className="eyebrow">Your topic</p>
        <h2 className="ls-topic">{draft.topic}</h2>
        <div className="ls-sendnote">
          <ShieldCheck size={20} aria-hidden="true" />
          <p>
            Your topic goes to a private AI service only. <b>Only each theme's search words</b> go to the public paper indexes{india ? " (OpenAlex and DOAJ)" : " (OpenAlex, Semantic Scholar and others)"}, so change or remove anything you would rather not send.
          </p>
        </div>
      </div>

      <div className="ls-themes-head">
        <h3 className="ls-section-h" id={`${id}-th`}>The themes your review will cover</h3>
        <p className="ls-hint">Each becomes a section of the review, answered from the papers found for its search words. Remove what you do not need, or edit a theme.</p>
      </div>
      <ol className="ls-themes" aria-labelledby={`${id}-th`}>
        {draft.items.map((it, i) => {
          const name = (it.title ?? "").trim() || `Theme ${i + 1}`;
          return (
            <li key={it.key} className="card ls-theme" data-editing={!!it.editing}>
              <div className="ls-theme-head">
                <span className="ls-n" aria-hidden="true">{i + 1}</span>
                {it.editing ? <span className="ls-theme-t">Editing theme {i + 1}</span> : <h4 className="ls-theme-t">{name}</h4>}
                {!it.editing && (
                  <button type="button" className="icon-btn icon-btn-sm" aria-label={`Edit theme ${i + 1}: ${name}`} onClick={() => set(it.key, { editing: true })} disabled={busy}>
                    <Pencil size={14} aria-hidden="true" />
                  </button>
                )}
                <button type="button" className="icon-btn icon-btn-sm" aria-label={`Remove theme ${i + 1}: ${name}`} onClick={() => onChange({ ...draft, items: draft.items.filter((x) => x.key !== it.key) })} disabled={busy || n <= LITSCAN_MIN_ITEMS}>
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
              {it.editing ? (
                <div className="ls-theme-edit">
                  <label className="ls-label ls-label-s" htmlFor={`${id}-t${it.key}`}>Name</label>
                  <input id={`${id}-t${it.key}`} className="ls-input" value={it.title ?? ""} maxLength={LITSCAN_TITLE_CHARS} onChange={(e) => set(it.key, { title: e.target.value })} autoFocus />
                  <label className="ls-label ls-label-s" htmlFor={`${id}-q${it.key}`}>Answered as the question</label>
                  <input id={`${id}-q${it.key}`} className="ls-input" value={it.question} maxLength={LITSCAN_QUESTION_CHARS} onChange={(e) => set(it.key, { question: e.target.value })} />
                  <label className="ls-label ls-label-s" htmlFor={`${id}-s${it.key}`}>Search words <span className="ls-opt">(English; this is what is sent)</span></label>
                  <input id={`${id}-s${it.key}`} className="ls-input" lang="en" value={it.searchQuery} maxLength={LITSCAN_SEARCH_CHARS} onChange={(e) => set(it.key, { searchQuery: e.target.value })} />
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => set(it.key, { editing: false })} disabled={(it.title ?? "").trim().length < 2 || it.question.trim().length < 3 || it.searchQuery.trim().length < 2}>
                    <Check size={14} aria-hidden="true" />
                    <span>Done</span>
                  </button>
                </div>
              ) : (
                <>
                  <p className="ls-theme-q">{it.question}</p>
                  <p className="ls-words"><span className="ls-words-k">Searches for</span> <span className="ls-words-v" lang="en">{it.searchQuery}</span></p>
                </>
              )}
            </li>
          );
        })}
      </ol>
      {n < LITSCAN_MAX_ITEMS && (
        <button type="button" className="btn btn-ghost btn-sm ls-add" disabled={busy || editing} onClick={() => onChange({ ...draft, items: [...draft.items, { title: "", question: "", searchQuery: "", key: ++keyCounter, editing: true }] })}>
          <Plus size={15} aria-hidden="true" />
          <span>Add a theme</span>
        </button>
      )}

      <div className="card ls-card ls-options">
        <div className="ls-opt-row">
          <div>
            <label className="ls-label" htmlFor={`${id}-lang`}>Write the review in</label>
            <select id={`${id}-lang`} className="ls-select" value={draft.language} onChange={(e) => onChange({ ...draft, language: e.target.value as LitscanLanguage })} disabled={busy}>
              {LITSCAN_LANGUAGES.map((l) => (
                <option key={l} value={l}>{LITSCAN_LANGUAGE_NAMES[l]}</option>
              ))}
            </select>
          </div>
          <div>
            <span className="ls-label" id={`${id}-scope-l`}>Where to search</span>
            <button type="button" className="hm-scope ls-scope" aria-pressed={india} aria-describedby={`${id}-scope-h`} onClick={() => onChange({ ...draft, scope: india ? "all" : "india" })} disabled={busy}>
              <Landmark size={15} aria-hidden="true" />
              <span>{INDIA_SCOPE_LABEL} only</span>
            </button>
          </div>
        </div>
        <p className="ls-hint" id={`${id}-scope-h`}>{india ? INDIA_SCOPE_HELP : "All the regular sources. Turn on Indian sources to search only journals published in India, Shodhganga theses and Indian institutions."}</p>
        <p className="ls-cost" data-over={!enough}>
          <b>This review is expected to use about {tokens(estimate)} AI tokens</b> of the {tokens(draft.allowance.limit)} you have a day ({tokens(left)} left today). It reads abstracts only, and each claim it writes is checked against a sentence of an abstract.
        </p>
      </div>

      {why && <p className="ls-why" role="note">{why}</p>}
      <div className="ls-bar">
        <button type="button" className="btn btn-ghost" onClick={onBack} disabled={busy}>Edit the topic</button>
        <button type="submit" className="btn btn-primary" disabled={!!why || busy} aria-busy={busy}>
          {busy ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <BookOpenCheck size={16} aria-hidden="true" />}
          <span>{busy ? "Starting…" : `Start the review (${n} themes)`}</span>
        </button>
      </div>
    </form>
  );
}
