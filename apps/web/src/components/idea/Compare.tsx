import { m } from "motion/react";
import { Check, CircleDashed, Layers, Loader2, Minus, ScanSearch, TriangleAlert } from "lucide-react";
import { COMPARE_PAPERS, FACET_KEYS, FACET_LABELS, type CoverageRow, type FacetKey, type FacetMatch, type IdeaComparison, type IdeaFacets, type IdeaPaper, type PaperComparison, type PaperLevel } from "@scholar/shared";
import { easeOut, stagger } from "../../lib/motion";

export type CompareRun = { status: "idle" | "running" | "done" | "error"; stage: "reading" | "comparing" | "checking" | null; comparison: IdeaComparison | null; error: string };

const STAGE_TEXT = { reading: "Reading the abstracts…", comparing: "Comparing each paper with each part of your idea…", checking: "Checking every quote against the abstract…" } as const;

const LEVEL: Record<PaperLevel, { label: string; tone: "ok" | "info" | "muted" }> = {
  close: { label: "Closely related", tone: "ok" },
  partial: { label: "Partly related", tone: "info" },
  related: { label: "Slightly related", tone: "info" },
  unrelated: { label: "Not related to your idea", tone: "muted" },
  no_abstract: { label: "No abstract to compare", tone: "muted" },
};

const MATCH: Record<FacetMatch, string> = { same: "Same", similar: "Similar", different: "Different", not_stated: "Not said", unverified: "Not confirmed" };

/** The button (before) and the progress (during) of a comparison. It costs AI use, so the researcher asks for it. */
export function CompareAction({ run, available, onCompare }: { run: CompareRun; available: number; onCompare: () => void }) {
  if (run.status === "done" || available === 0) return null;
  return (
    <section className="card cmp-action" aria-label="Compare with your idea">
      <span className="principle-ico" aria-hidden="true"><ScanSearch size={20} /></span>
      <div className="cmp-action-text">
        <h2 className="cmp-title">See what the closest papers actually do</h2>
        <p>
          A private AI reads the abstracts of the {Math.min(available, COMPARE_PAPERS)} closest papers and compares each with the four parts of your idea. Every match comes with the sentence it is based on, checked to be in
          the abstract. It never says whether your idea is new.
        </p>
        {run.status === "error" && <p className="cmp-error" role="alert"><TriangleAlert size={15} aria-hidden="true" /> {run.error}</p>}
      </div>
      <button type="button" className="btn btn-primary" onClick={onCompare} disabled={run.status === "running"} aria-busy={run.status === "running"}>
        {run.status === "running" ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <ScanSearch size={16} aria-hidden="true" />}
        <span>{run.status === "running" ? (run.stage ? STAGE_TEXT[run.stage] : "Starting…") : run.status === "error" ? "Try again" : "Compare with my idea"}</span>
      </button>
    </section>
  );
}

const STATUS: Record<CoverageRow["status"], { label: string; icon: typeof Check; tone: string }> = {
  covered: { label: "Done in a close paper", icon: Check, tone: "ok" },
  similar: { label: "Something similar exists", icon: Layers, tone: "info" },
  none: { label: "Not found in these papers", icon: CircleDashed, tone: "muted" },
  not_stated: { label: "Your text does not say", icon: Minus, tone: "muted" },
};

/** One row per part of the idea: which of the compared papers cover it, each with its checked quote. */
export function CoverageMap({ comparison, facets, titles, onOpen }: { comparison: IdeaComparison; facets: IdeaFacets; titles: Map<string, IdeaPaper>; onOpen: (p: IdeaPaper) => void }) {
  const combo = comparison.combination;
  return (
    <m.section className="card cmp-map" aria-labelledby="cmp-map-h" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: easeOut }}>
      <h2 id="cmp-map-h" className="cmp-title">What the {comparison.compared} closest papers cover</h2>
      <p className="cmp-lead">Part by part. This describes these papers only: something not found here may still exist elsewhere.</p>
      <ul className="cmp-rows">
        {comparison.coverage.map((row, i) => {
          const s = STATUS[row.status];
          return (
            <m.li key={row.facet} className="cmp-row" data-tone={s.tone} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: easeOut, delay: 0.08 + stagger(i, 0.07) }}>
              <div className="cmp-row-head">
                <span className="cmp-facet">{FACET_LABELS[row.facet]}</span>
                <span className="cmp-status" data-tone={s.tone}><s.icon size={14} aria-hidden="true" /> {s.label}</span>
              </div>
              <p className="cmp-yours">{facets[row.facet] && facets[row.facet].toLowerCase() !== "not stated" ? facets[row.facet] : "Not stated in your text"}</p>
              {row.papers.length > 0 && (
                <ul className="cmp-hits">
                  {row.papers.slice(0, 3).map((hit) => {
                    const paper = titles.get(hit.id);
                    return (
                      <li key={hit.id}>
                        <span className="cmp-chip" data-match={hit.match}>{MATCH[hit.match]}</span>
                        <div>
                          {paper ? <button type="button" className="link-btn cmp-paper" onClick={() => onOpen(paper)}>{paper.title}{paper.year ? ` (${paper.year})` : ""}</button> : <span className="cmp-paper">A paper</span>}
                          <blockquote className="cmp-quote">“{hit.quote}”</blockquote>
                        </div>
                      </li>
                    );
                  })}
                  {row.papers.length > 3 && <li className="cmp-more">and {row.papers.length - 3} more below, on their cards</li>}
                </ul>
              )}
            </m.li>
          );
        })}
      </ul>
      {combo && (
        <p className="cmp-combo" data-found={combo.found.length > 0}>
          {combo.found.length > 0
            ? `Your method and your field appear together in ${combo.found.length} of the ${combo.compared} papers compared.`
            : `None of the ${combo.compared} papers compared covers both your method and your field. That can be a gap, or the paper that does is not in these ${combo.compared}.`}
        </p>
      )}
      {comparison.droppedClaims > 0 && (
        <p className="cmp-dropped" role="note">
          <TriangleAlert size={14} aria-hidden="true" /> The AI also claimed {comparison.droppedClaims} {comparison.droppedClaims === 1 ? "match" : "matches"} whose sentence is not in the abstract. {comparison.droppedClaims === 1 ? "It is" : "They are"} not shown as {comparison.droppedClaims === 1 ? "a match" : "matches"}.
        </p>
      )}
    </m.section>
  );
}

/** Under a paper's abstract: how it relates to each part of the idea, with the quote for the parts it matches. */
export function PaperStrip({ comparison }: { comparison: PaperComparison }) {
  const lv = LEVEL[comparison.level];
  if (comparison.level === "no_abstract") return <p className="cmp-strip-none">{lv.label}.</p>;
  return (
    <div className="cmp-strip" data-tone={lv.tone}>
      <p className="cmp-strip-head"><strong>{lv.label}</strong> to your idea</p>
      <ul className="cmp-strip-facets" aria-label="Part by part">
        {FACET_KEYS.map((k: FacetKey) => {
          const f = comparison.facets[k];
          return (
            <li key={k} data-match={f.match}>
              <span className="cmp-strip-name">{FACET_LABELS[k]}</span>
              <span className="cmp-chip" data-match={f.match}>{MATCH[f.match]}</span>
              {f.quote && <span className="cmp-strip-quote">“{f.quote}”</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

