import { m } from "motion/react";
import { BookOpenCheck, CircleDashed, FileDown, Layers, Loader2, MessageSquareQuote, Printer, TriangleAlert, UserRoundPen } from "lucide-react";
import { FACET_LABELS, combinationGaps, uncoveredParts, type IdeaComparison, type IdeaFacets, type IdeaInsights, type IdeaPaper, type OutcomeKind } from "@scholar/shared";
import { easeOut } from "../../lib/motion";

export type InsightsRun = { status: "idle" | "running" | "done" | "error"; stage: "reading" | "analysing" | "checking" | null; insights: IdeaInsights | null; error: string };

const STAGE_TEXT = { reading: "Reading the abstracts…", analysing: "Looking for open problems, results and an answer…", checking: "Checking every quote against the abstract…" } as const;
const OUTCOME: Record<OutcomeKind, string> = { positive: "Reports that it worked", mixed: "Reports mixed results", negative: "Reports that it did not work", not_stated: "No result stated" };

type Titles = Map<string, IdeaPaper>;
type Open = (p: IdeaPaper) => void;

function PaperLink({ id, titles, onOpen }: { id: string; titles: Titles; onOpen: Open }) {
  const p = titles.get(id);
  if (!p) return <span className="cmp-paper">A paper</span>;
  return (
    <button type="button" className="link-btn cmp-paper" onClick={() => onOpen(p)}>
      {p.title}
      {p.year ? ` (${p.year})` : ""}
    </button>
  );
}

/**
 * Gaps among the compared papers. Two kinds need no AI at all and are worked out from the checked matches: a part of the idea that no compared paper covers,
 * and two parts that each have a close paper but never in the same one. The third kind, what the papers themselves say is still open, comes from reading them.
 */
export function GapsPanel({ comparison, facets, insights, titles, onOpen }: { comparison: IdeaComparison; facets: IdeaFacets; insights: IdeaInsights | null; titles: Titles; onOpen: Open }) {
  const none = uncoveredParts(comparison);
  const pairs = combinationGaps(comparison);
  const open = insights?.openProblems ?? [];
  const nothing = none.length === 0 && pairs.length === 0 && open.length === 0;
  return (
    <m.section className="card ins-card" aria-labelledby="gaps-h" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: easeOut }}>
      <h2 id="gaps-h" className="cmp-title">Gaps among the {comparison.compared} compared papers</h2>
      <p className="cmp-lead">What these papers do not cover. This is not proof that nothing exists: it may be in a paper that was not compared, or outside the sources searched.</p>

      {none.length > 0 && (
        <div className="ins-block">
          <h3 className="ins-h3">No compared paper covers</h3>
          <ul className="ins-list">
            {none.map((k) => (
              <li key={k}>
                <CircleDashed size={15} aria-hidden="true" />
                <span><strong>{FACET_LABELS[k]}:</strong> {facets[k]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {pairs.length > 0 && (
        <div className="ins-block">
          <h3 className="ins-h3">Covered separately, never together in one paper</h3>
          <ul className="ins-list">
            {pairs.map((g) => (
              <li key={`${g.a}-${g.b}`}>
                <Layers size={15} aria-hidden="true" />
                <span>
                  <strong>{FACET_LABELS[g.a]}</strong> is covered by <PaperLink id={g.aPapers[0]!} titles={titles} onOpen={onOpen} />
                  {g.aPapers.length > 1 ? ` and ${g.aPapers.length - 1} more` : ""}; <strong>{FACET_LABELS[g.b]}</strong> by <PaperLink id={g.bPapers[0]!} titles={titles} onOpen={onOpen} />
                  {g.bPapers.length > 1 ? ` and ${g.bPapers.length - 1} more` : ""}. No single compared paper does both.
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {open.length > 0 && (
        <div className="ins-block">
          <h3 className="ins-h3">What the papers themselves say is still open</h3>
          <ul className="ins-quotes">
            {open.map((o) => (
              <li key={`${o.id}-${o.quote}`}>
                <PaperLink id={o.id} titles={titles} onOpen={onOpen} />
                <blockquote className="cmp-quote">“{o.quote}”</blockquote>
              </li>
            ))}
          </ul>
        </div>
      )}
      {insights && open.length === 0 && <p className="ins-none">None of the {insights.papersRead} abstracts states an open problem or future work in a sentence we could check.</p>}
      {!insights && <p className="ins-none">What the papers say is still open appears after you read them (below).</p>}
      {nothing && insights && <p className="ins-none">No gap was found: every part of your idea has a close paper, and each combination appears in a paper.</p>}
    </m.section>
  );
}

/** The button (before) and the progress (during) of the second reading. It costs AI use, so the researcher asks for it. */
export function InsightsAction({ run, available, hasQuestion, onRun }: { run: InsightsRun; available: number; hasQuestion: boolean; onRun: () => void }) {
  if (run.status === "done" || available === 0) return null;
  return (
    <section className="card cmp-action" aria-label="Read the papers for gaps and feasibility">
      <span className="principle-ico" aria-hidden="true"><BookOpenCheck size={20} /></span>
      <div className="cmp-action-text">
        <h2 className="cmp-title">What is still open, what worked, and what it would take</h2>
        <p>
          The private AI reads the {available} compared {available === 1 ? "paper that matches" : "papers that match"} some part of your idea again, for what the authors say is still open, what each paper reports (with its data and method), {hasQuestion ? "an answer to your question, " : ""}and a few notes on time, cost and skills.
          Everything taken from a paper comes with its sentence, checked to be in the abstract. The notes on time, cost and skills are the AI's opinion and are marked as such. It takes about a minute and uses roughly a fifth of your daily AI allowance.
        </p>
        {run.status === "error" && <p className="cmp-error" role="alert"><TriangleAlert size={15} aria-hidden="true" /> {run.error}</p>}
      </div>
      <button type="button" className="btn btn-primary" onClick={onRun} disabled={run.status === "running"} aria-busy={run.status === "running"}>
        {run.status === "running" ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <BookOpenCheck size={16} aria-hidden="true" />}
        <span>{run.status === "running" ? (run.stage ? STAGE_TEXT[run.stage] : "Starting…") : run.status === "error" ? "Try again" : "Read the papers"}</span>
      </button>
    </section>
  );
}

/** What each paper reports, and the practical side as the model's labelled opinion. */
export function FeasibilityPanel({ insights, related, titles, onOpen }: { insights: IdeaInsights; related: Set<string> | null; titles: Titles; onOpen: Open }) {
  // a paper that matches no part of the idea says nothing about whether this idea works
  const rows = insights.readings.filter((r) => (!related || related.has(r.id)) && (r.outcome.kind !== "not_stated" || r.data || r.method));
  return (
    <m.section className="card ins-card" aria-labelledby="feas-h" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: easeOut, delay: 0.05 }}>
      <h2 id="feas-h" className="cmp-title">Has it been tried, and what did it take?</h2>
      <p className="cmp-lead">From the abstracts of the {insights.papersRead} papers that match some part of your idea. A result is shown only with the sentence it comes from.</p>
      {rows.length === 0 ? (
        <p className="ins-none">These abstracts say nothing about results, data or methods that could be quoted.</p>
      ) : (
        <ul className="ins-readings">
          {rows.map((r) => (
            <li key={r.id} className="ins-reading" data-outcome={r.outcome.kind}>
              <div className="ins-reading-head">
                <PaperLink id={r.id} titles={titles} onOpen={onOpen} />
                <span className="cmp-chip ins-outcome" data-outcome={r.outcome.kind}>{OUTCOME[r.outcome.kind]}</span>
              </div>
              {r.outcome.quote && <blockquote className="cmp-quote">“{r.outcome.quote}”</blockquote>}
              {r.method && <p className="ins-fact"><span>Method</span> “{r.method}”</p>}
              {r.data && <p className="ins-fact"><span>Data</span> “{r.data}”</p>}
            </li>
          ))}
        </ul>
      )}

      {insights.opinion.length > 0 && (
        <aside className="ins-opinion" aria-labelledby="opinion-h">
          <h3 id="opinion-h" className="ins-h3"><UserRoundPen size={15} aria-hidden="true" /> Practical side: the AI's opinion</h3>
          <p className="ins-opinion-note">Written by the AI from your idea alone. It is opinion, not checked against any paper.</p>
          <ul className="ins-list ins-list-plain">
            {insights.opinion.map((o) => <li key={o}>{o}</li>)}
          </ul>
        </aside>
      )}
      {insights.droppedClaims > 0 && (
        <p className="cmp-dropped" role="note">
          <TriangleAlert size={14} aria-hidden="true" /> The AI also made {insights.droppedClaims} {insights.droppedClaims === 1 ? "claim" : "claims"} whose sentence is not in the abstract (or has nothing to do with what was claimed). {insights.droppedClaims === 1 ? "It is" : "They are"} not shown.
        </p>
      )}
    </m.section>
  );
}

/** An answer to the researcher's own question, from the abstracts only, each statement next to its sentence. */
export function AnswerPanel({ insights, titles, onOpen }: { insights: IdeaInsights; titles: Titles; onOpen: Open }) {
  if (!insights.answer) return null;
  const { question, statements } = insights.answer;
  return (
    <m.section className="card ins-card" aria-labelledby="answer-h" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: easeOut, delay: 0.1 }}>
      <h2 id="answer-h" className="cmp-title"><MessageSquareQuote size={18} aria-hidden="true" /> Your question</h2>
      <p className="ins-question">{question}</p>
      {statements.length === 0 ? (
        <p className="ins-none">The abstracts of these papers do not answer it. That does not mean it cannot be answered: the answer may be in a full text, or in a paper that was not found.</p>
      ) : (
        <>
          <p className="cmp-lead">What the abstracts say. The sentence of the abstract is the evidence; a line in the AI's own words appears above it only where the sentence supports it.</p>
          <ul className="ins-quotes">
            {statements.map((s) => (
              <li key={s.text}>
                {s.text ? <p className="ins-statement">{s.text}</p> : <p className="ins-picked">A sentence the AI picked for your question</p>}
                {s.cites.map((c) => (
                  <div key={c.id + c.quote}>
                    <PaperLink id={c.id} titles={titles} onOpen={onOpen} />
                    <blockquote className="cmp-quote">“{c.quote}”</blockquote>
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </>
      )}
    </m.section>
  );
}

/** Keeping the check: a Markdown file, or the browser's own print (which can save a PDF). */
export function ReportBar({ onDownload, onPrint }: { onDownload: () => void; onPrint: () => void }) {
  return (
    <section className="card ins-report" aria-labelledby="report-h" data-print="hide">
      <div>
        <h2 id="report-h" className="cmp-title">Keep this check</h2>
        <p className="cmp-lead">A report with your idea, what was searched, the closest papers and everything above, each with its sentence. It says what the papers show; it does not say whether the idea is new.</p>
      </div>
      <div className="ins-report-actions">
        <button type="button" className="btn btn-primary" onClick={onDownload}>
          <FileDown size={16} aria-hidden="true" />
          <span>Download the report</span>
        </button>
        <button type="button" className="btn btn-ghost" onClick={onPrint}>
          <Printer size={16} aria-hidden="true" />
          <span>Print or save as PDF</span>
        </button>
      </div>
    </section>
  );
}
