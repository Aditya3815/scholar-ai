import { AnimatePresence, m } from "motion/react";
import { ArrowLeft, CircleAlert, Info, Loader2, Telescope } from "lucide-react";
import { useMemo, useState } from "react";
import type { IdeaFacets, IdeaPaper, IdeaSearched, IdeaSearchResult } from "@scholar/shared";
import { openPreview } from "../../lib/preview";
import { easeOut } from "../../lib/motion";
import { ReportButton } from "../ReportButton";
import { ResultCard } from "../ResultCard";
import { CompareAction, CoverageMap, PaperStrip, type CompareRun } from "./Compare";

const SOURCE_NAME = { openalex: "OpenAlex", s2: "Semantic Scholar" } as const;
const STAGE_TEXT = { searching: "Searching OpenAlex and Semantic Scholar…", ranking: "Choosing the papers closest to your idea…", checking: "Checking every DOI and retraction notice…" } as const;

export type IdeaRun = {
  stage: keyof typeof STAGE_TEXT | null;
  papers: IdeaPaper[];
  searched: IdeaSearched[];
  result: IdeaSearchResult | null;
};

function FoundBy({ paper }: { paper: IdeaPaper }) {
  if (paper.foundBy.length === 0) return null;
  return (
    <span className="badge idea-found" title="Which of the searches returned this paper">
      <Telescope size={14} aria-hidden="true" />
      {paper.foundBy.join(" · ")}
    </span>
  );
}

/** What was searched, in full: the report must say what it did not look at, not only what it found. */
function Coverage({ searched, considered, done }: { searched: IdeaSearched[]; considered: number | null; done: boolean }) {
  const failed = searched.filter((s) => !s.ok);
  return (
    <section className="card idea-cover" aria-label="What was searched">
      <div className="idea-cover-head">
        <Info size={18} aria-hidden="true" />
        <p>
          {done && considered != null ? (
            <>
              <strong>{considered.toLocaleString("en-IN")} papers</strong> came back from {searched.filter((s) => s.ok).length} searches; these are the closest.{" "}
            </>
          ) : (
            "Searching… "
          )}
          Not finding a paper here does not mean it does not exist: these services do not cover theses, many regional journals, preprint servers outside arXiv, or unpublished work.
        </p>
      </div>
      {failed.length > 0 && (
        <p className="idea-cover-warn" role="alert">
          <CircleAlert size={16} aria-hidden="true" />
          {failed.length} of {searched.length} searches did not answer ({[...new Set(failed.map((f) => SOURCE_NAME[f.source]))].join(", ")}), so some papers may be missing. You can search again.
        </p>
      )}
      <details className="idea-cover-list">
        <summary>Show every search that was run ({searched.length})</summary>
        <ul>
          {searched.map((s, i) => (
            <li key={i} data-ok={s.ok}>
              <span className="idea-cover-src">
                {SOURCE_NAME[s.source]} · {s.kind === "semantic" ? "by meaning" : "keywords"}
              </span>
              <span className="idea-cover-q">{s.query.length > 160 ? `${s.query.slice(0, 160)}…` : s.query}</span>
              <span className="idea-cover-n">{s.ok ? `${s.count} papers` : "did not answer"}</span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

export function IdeaResults({ run, compare, facets, onCompare, onEditPlan, onSearchAgain }: { run: IdeaRun; compare: CompareRun; facets: IdeaFacets | null; onCompare: () => void; onEditPlan: () => void; onSearchAgain: () => void }) {
  const [openOnly, setOpenOnly] = useState(false);
  const [hideRetracted, setHideRetracted] = useState(false);
  const done = run.result !== null;
  const papers = useMemo(() => run.papers.filter((p) => (!openOnly || p.oaUrl) && (!hideRetracted || !p.retracted)), [run.papers, openOnly, hideRetracted]);
  const failed = run.searched.filter((s) => !s.ok).length;
  const nothing = done && run.papers.length === 0;
  const byId = useMemo(() => new Map(run.papers.map((p) => [p.id, p])), [run.papers]);
  const strips = useMemo(() => new Map((compare.comparison?.comparisons ?? []).map((c) => [c.id, c])), [compare.comparison]);

  return (
    <div className="idea-results">
      <div className="idea-results-head">
        <div>
          <p className="eyebrow">Closest papers</p>
          <h2 className="idea-results-title" aria-live="polite">
            {done ? (nothing ? "No close papers found" : `${run.papers.length} papers closest to your idea`) : "Looking for the closest papers"}
          </h2>
        </div>
        <div className="vin-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onEditPlan}>
            <ArrowLeft size={15} aria-hidden="true" />
            <span>Edit the search</span>
          </button>
          {done && (
            <ReportButton
              label="Something missing or wrong?"
              body={{
                kind: "idea",
                semanticQuery: run.searched.find((s) => s.kind === "semantic")?.query,
                keywordQueries: [...new Set(run.searched.filter((s) => s.kind === "keyword").map((s) => s.query))],
              }}
            />
          )}
          {done && failed > 0 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onSearchAgain}>
              <span>Search again</span>
            </button>
          )}
        </div>
      </div>

      <AnimatePresence>
        {!done && run.stage && (
          <m.p key="stage" className="idea-stage" role="status" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25, ease: easeOut }}>
            <Loader2 className="spin" size={16} aria-hidden="true" />
            <span>{STAGE_TEXT[run.stage]}</span>
          </m.p>
        )}
      </AnimatePresence>

      {(run.searched.length > 0 || done) && <Coverage searched={run.searched} considered={run.result?.considered ?? null} done={done} />}

      {done && run.result && (!run.result.checked.doi || !run.result.checked.retraction) && (
        <p className="idea-cover-warn" role="alert">
          <CircleAlert size={16} aria-hidden="true" />
          {!run.result.checked.doi && !run.result.checked.retraction ? "The DOI and retraction checks could not run just now" : !run.result.checked.doi ? "The DOI check could not run just now" : "The retraction check could not run just now"}, so treat these papers as unchecked until you search again.
        </p>
      )}

      {done && <CompareAction run={compare} available={run.papers.filter((p) => (p.abstract?.length ?? 0) >= 80).length} onCompare={onCompare} />}
      {compare.comparison && facets && <CoverageMap comparison={compare.comparison} facets={facets} titles={byId} onOpen={(p) => openPreview(p, papers)} />}

      {run.papers.length > 0 && (
        <div className="filters" role="group" aria-label="Filters">
          <button type="button" className="chip-btn" aria-pressed={openOnly} onClick={() => setOpenOnly((v) => !v)}>Open access only</button>
          <button type="button" className="chip-btn" aria-pressed={hideRetracted} onClick={() => setHideRetracted((v) => !v)}>Hide retracted</button>
        </div>
      )}

      <ul className="results" aria-busy={!done} aria-label="Closest papers">
        <AnimatePresence initial>
          {papers.map((p, i) => (
            <ResultCard key={p.id} paper={p} index={i} onPreview={(paper) => openPreview(paper, papers)} extra={<FoundBy paper={p} />} below={strips.has(p.id) ? <PaperStrip comparison={strips.get(p.id)!} /> : undefined} />
          ))}
        </AnimatePresence>
      </ul>

      {nothing && (
        <div className="empty">
          <Telescope size={28} aria-hidden="true" />
          <p className="empty-title">Nothing close came back</p>
          <p>{failed > 0 ? "Some searches did not answer. Try again in a minute." : "Try describing the idea in more general words, or add a keyword search."}</p>
        </div>
      )}
      {run.papers.length > 0 && papers.length === 0 && (
        <div className="empty">
          <p className="empty-title">No papers match these filters</p>
          <button type="button" className="btn btn-ghost" onClick={() => { setOpenOnly(false); setHideRetracted(false); }}>Clear filters</button>
        </div>
      )}
    </div>
  );
}
