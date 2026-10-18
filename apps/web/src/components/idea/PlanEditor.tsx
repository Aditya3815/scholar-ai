import { AnimatePresence, m } from "motion/react";
import { ArrowLeft, Loader2, Plus, Search, ShieldCheck, X } from "lucide-react";
import { useId, useState } from "react";
import { MAX_KEYWORD_QUERIES, MAX_KEYWORD_QUERY_CHARS, MAX_SEMANTIC_QUERY_CHARS, type IdeaPlan } from "@scholar/shared";
import { easeOut, spring, stagger } from "../../lib/motion";

export type PlanDraft = { semanticQuery: string; keywordQueries: string[] };

const FACETS: { key: keyof IdeaPlan["facets"]; label: string }[] = [
  { key: "purpose", label: "Purpose" },
  { key: "mechanism", label: "Method" },
  { key: "evaluation", label: "Testing" },
  { key: "domain", label: "Field" },
];

/**
 * The search plan, before anything is sent. What the researcher reads here is exactly what OpenAlex and Semantic Scholar will receive,
 * so every query can be edited or removed. The idea itself is not part of it.
 */
export function PlanEditor({
  plan,
  draft,
  busy,
  onChange,
  onBack,
  onSearch,
}: {
  plan: IdeaPlan;
  draft: PlanDraft;
  busy: boolean;
  onChange: (d: PlanDraft) => void;
  onBack: () => void;
  onSearch: () => void;
}) {
  const id = useId();
  const [adding, setAdding] = useState("");
  const { semanticQuery, keywordQueries } = draft;
  const canSearch = !busy && (semanticQuery.trim().length >= 30 || keywordQueries.some((q) => q.trim().length >= 3));
  const full = keywordQueries.length >= MAX_KEYWORD_QUERIES;

  const add = () => {
    const q = adding.replace(/\s+/g, " ").trim();
    if (q.length < 3 || full || keywordQueries.some((k) => k.toLowerCase() === q.toLowerCase())) return;
    onChange({ ...draft, keywordQueries: [...keywordQueries, q] });
    setAdding("");
  };

  return (
    <div className="plan">
      <div className="card plan-read">
        <p className="eyebrow">What we understood</p>
        <h2 className="plan-title">{plan.title}</h2>
        {plan.summary && <p className="plan-summary reading">{plan.summary}</p>}
        <dl className="plan-facets">
          {FACETS.map(({ key, label }, i) => (
            <m.div key={key} className="plan-facet" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: easeOut, delay: 0.05 + stagger(i, 0.06) }}>
              <dt>{label}</dt>
              <dd data-empty={plan.facets[key] === "not stated"}>{plan.facets[key] === "not stated" ? "Not stated in your text" : plan.facets[key]}</dd>
            </m.div>
          ))}
        </dl>
      </div>

      <form
        className="card plan-send"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSearch) onSearch();
        }}
      >
        <div className="plan-send-head">
          <ShieldCheck size={20} aria-hidden="true" />
          <div>
            <h2 className="plan-send-title">This is all that will be sent to the search services</h2>
            <p className="vin-hint">OpenAlex and Semantic Scholar see only the text below, never your file or your full idea. Edit it, or remove anything you would rather not send.</p>
          </div>
        </div>

        <label className="plan-label" htmlFor={`${id}-sem`}>
          Description, searched by meaning <span className="idea-opt">(OpenAlex)</span>
        </label>
        <textarea
          id={`${id}-sem`}
          className="vin-text plan-sem"
          rows={5}
          value={semanticQuery}
          maxLength={MAX_SEMANTIC_QUERY_CHARS}
          onChange={(e) => onChange({ ...draft, semanticQuery: e.target.value })}
          readOnly={busy}
          spellCheck
        />
        <p className="plan-hint">{semanticQuery.trim().length.toLocaleString("en-IN")} of {MAX_SEMANTIC_QUERY_CHARS.toLocaleString("en-IN")} characters. Leave it empty to search by keywords only.</p>

        <p className="plan-label" id={`${id}-kw`}>
          Keyword searches <span className="idea-opt">(OpenAlex; Semantic Scholar uses the first three)</span>
        </p>
        <ul className="plan-kws" aria-labelledby={`${id}-kw`}>
          <AnimatePresence initial={false}>
            {keywordQueries.map((q, i) => (
              <m.li key={`${i}`} className="plan-kw" layout="position" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} transition={spring}>
                <Search size={14} aria-hidden="true" />
                <input
                  aria-label={`Keyword search ${i + 1}`}
                  value={q}
                  maxLength={MAX_KEYWORD_QUERY_CHARS}
                  onChange={(e) => onChange({ ...draft, keywordQueries: keywordQueries.map((k, j) => (j === i ? e.target.value : k)) })}
                  readOnly={busy}
                />
                <button type="button" className="icon-btn icon-btn-sm" aria-label={`Remove keyword search: ${q}`} onClick={() => onChange({ ...draft, keywordQueries: keywordQueries.filter((_, j) => j !== i) })} disabled={busy}>
                  <X size={14} aria-hidden="true" />
                </button>
              </m.li>
            ))}
          </AnimatePresence>
        </ul>
        <div className="plan-add">
          <input
            aria-label="Add a keyword search"
            placeholder={full ? `At most ${MAX_KEYWORD_QUERIES} keyword searches` : "Add a keyword search"}
            value={adding}
            maxLength={MAX_KEYWORD_QUERY_CHARS}
            disabled={full || busy}
            onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <button type="button" className="btn btn-ghost btn-sm" onClick={add} disabled={full || busy || adding.trim().length < 3}>
            <Plus size={15} aria-hidden="true" />
            <span>Add</span>
          </button>
        </div>

        <div className="vin-bar plan-bar">
          <button type="button" className="btn btn-ghost" onClick={onBack} disabled={busy}>
            <ArrowLeft size={16} aria-hidden="true" />
            <span>Edit my idea</span>
          </button>
          <button type="submit" className="btn btn-primary" disabled={!canSearch} aria-busy={busy}>
            {busy ? <Loader2 className="spin" size={17} aria-hidden="true" /> : <Search size={16} aria-hidden="true" />}
            <span>{busy ? "Searching…" : "Search the literature"}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
