import { AnimatePresence, m } from "motion/react";
import { Lightbulb, LockKeyhole, ShieldCheck, Telescope } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { COMPARE_PAPERS, PRIVACY_VERSION, buildIdeaReport, relatedIds, type IdeaPlan } from "@scholar/shared";
import { useAuth } from "../../lib/auth";
import { ApiError } from "../../lib/documents";
import { compareIdea, downloadText, insightsIdea, isData, planIdea, reportFileName, searchIdea } from "../../lib/idea";
import { easeOut, stagger } from "../../lib/motion";
import { showNotice } from "../../lib/notice";
import { takeHandoff } from "../../lib/workspace";
import { ProviderButtons } from "../ProviderButtons";
import { PrivacyCard } from "../legal/PrivacyCard";
import { IdeaInput } from "./IdeaInput";
import type { CompareRun } from "./Compare";
import type { InsightsRun } from "./Insights";
import { IdeaResults, type IdeaRun } from "./IdeaResults";
import { PlanEditor, type PlanDraft } from "./PlanEditor";

const rise = (i: number) => ({
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6, ease: easeOut, delay: 0.08 + stagger(i, 0.09) },
});

const HOW = [
  { Icon: Lightbulb, title: "Bring an idea", body: "A paragraph, your notes, or a file: PDF, Word, LaTeX, Markdown or text. It is read in your browser." },
  { Icon: ShieldCheck, title: "You approve the search", body: "You see exactly what will be sent to OpenAlex and Semantic Scholar, and can change it. Your idea itself is never sent." },
  { Icon: Telescope, title: "Real papers, checked", body: "The closest papers, each a real record with its DOI checked and retractions flagged. Nothing is written by AI." },
];

const STEPS = [
  { id: "input", label: "Your idea" },
  { id: "plan", label: "Search plan" },
  { id: "results", label: "Closest papers" },
] as const;
type Step = (typeof STEPS)[number]["id"];

const EMPTY_RUN: IdeaRun = { stage: null, papers: [], searched: [], result: null };
const EMPTY_COMPARE: CompareRun = { status: "idle", stage: null, comparison: null, error: "" };
const EMPTY_INSIGHTS: InsightsRun = { status: "idle", stage: null, insights: null, error: "" };

function Steps({ step }: { step: Step }) {
  const at = STEPS.findIndex((s) => s.id === step);
  return (
    <ol className="idea-steps" aria-label="Progress">
      {STEPS.map((s, i) => (
        <li key={s.id} data-state={i < at ? "done" : i === at ? "now" : "todo"} aria-current={i === at ? "step" : undefined}>
          <span className="idea-step-n">{i + 1}</span>
          <span>{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

/** What to tell the researcher: the service's own words when it gave some, a fallback otherwise, nothing when they cancelled. */
const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : e instanceof Error && e.name !== "AbortError" ? fallback : "");

export function IdeaPage() {
  const { status, user } = useAuth();
  const [step, setStep] = useState<Step>("input");
  const [text, setText] = useState(() => takeHandoff("idea"));
  const [question, setQuestion] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [plan, setPlan] = useState<IdeaPlan | null>(null);
  const [draft, setDraft] = useState<PlanDraft>({ semanticQuery: "", keywordQueries: [] });
  const [run, setRun] = useState<IdeaRun>(EMPTY_RUN);
  const [searching, setSearching] = useState(false);
  const [compare, setCompare] = useState<CompareRun>(EMPTY_COMPARE);
  const [insights, setInsights] = useState<InsightsRun>(EMPTY_INSIGHTS);
  const abort = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const topRef = useRef<HTMLDivElement>(null);

  // Leaving the page cancels a running search: nobody is waiting for it.
  useEffect(() => () => abort.current?.abort(), []);

  const go = (next: Step) => {
    setStep(next);
    window.setTimeout(() => topRef.current?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }), 40);
  };

  const prepare = useCallback(async () => {
    setPlanning(true);
    try {
      const p = await planIdea(text, question.trim());
      setPlan(p);
      setDraft({ semanticQuery: p.semanticQuery, keywordQueries: p.keywordQueries });
      setRun(EMPTY_RUN);
      go("plan");
    } catch (e) {
      showNotice(errorText(e, "We could not read the idea just now. Please try again.") || "We could not read the idea just now.");
    } finally {
      setPlanning(false);
    }
  }, [text, question]);

  const search = useCallback(async () => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setSearching(true);
    setRun({ ...EMPTY_RUN, stage: "searching" });
    setCompare(EMPTY_COMPARE);
    setInsights(EMPTY_INSIGHTS);
    go("results");
    try {
      const result = await searchIdea(
        { semanticQuery: draft.semanticQuery.trim(), keywordQueries: draft.keywordQueries.map((q) => q.trim()).filter(Boolean) },
        (e) => {
          if (e.type === "stage") setRun((r) => ({ ...r, stage: e.stage }));
          else if (e.type === "papers") setRun((r) => ({ ...r, papers: e.papers, searched: e.searched }));
        },
        ctl.signal,
      );
      setRun({ stage: null, papers: result.papers, searched: result.searched, result });
    } catch (e) {
      const msg = errorText(e, "The search was interrupted. Please try again.");
      if (msg) {
        showNotice(msg);
        go("plan");
      }
    } finally {
      if (abort.current === ctl) setSearching(false);
    }
  }, [draft]);

  const runCompare = useCallback(async () => {
    if (!plan) return;
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setCompare({ status: "running", stage: "reading", comparison: null, error: "" });
    const papers = run.papers.filter((p) => !isData(p) && (p.abstract?.length ?? 0) >= 80).slice(0, COMPARE_PAPERS).map((p) => ({ id: p.id, title: p.title, year: p.year, abstract: p.abstract! }));
    try {
      const comparison = await compareIdea(
        { title: plan.title, summary: plan.summary, facets: plan.facets, question: question.trim() || undefined, ideaExcerpt: text.slice(0, 3000), papers },
        (stage) => setCompare((c) => ({ ...c, stage })),
        ctl.signal,
      );
      setCompare({ status: "done", stage: null, comparison, error: "" });
    } catch (e) {
      const msg = errorText(e, "The comparison was interrupted. Please try again.");
      if (msg) setCompare({ status: "error", stage: null, comparison: null, error: msg });
    }
  }, [plan, run.papers, question, text]);

  const runInsights = useCallback(async () => {
    if (!plan) return;
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setInsights({ status: "running", stage: "reading", insights: null, error: "" });
    // Only the papers that match some part of the idea are read further: what an unrelated paper reports says nothing about this idea.
    const related = compare.comparison ? relatedIds(compare.comparison) : null;
    const papers = run.papers.filter((p) => !isData(p) && (!related || related.has(p.id)) && (p.abstract?.length ?? 0) >= 80).slice(0, COMPARE_PAPERS).map((p) => ({ id: p.id, title: p.title, year: p.year, abstract: p.abstract! }));
    try {
      const result = await insightsIdea(
        { title: plan.title, summary: plan.summary, facets: plan.facets, question: question.trim() || undefined, papers },
        (stage) => setInsights((i) => ({ ...i, stage })),
        ctl.signal,
      );
      setInsights({ status: "done", stage: null, insights: result, error: "" });
    } catch (e) {
      const msg = errorText(e, "Reading the papers was interrupted. Please try again.");
      if (msg) setInsights({ status: "error", stage: null, insights: null, error: msg });
    }
  }, [plan, run.papers, question, compare.comparison]);

  /** The whole check as a Markdown file: built here from what is on the page, never sent anywhere. */
  const reportText = useCallback(
    () =>
      buildIdeaReport({
        appName: "Scholar AI",
        generatedAt: new Date().toISOString(),
        title: plan?.title ?? "",
        summary: plan?.summary ?? "",
        facets: plan?.facets ?? { purpose: "", mechanism: "", evaluation: "", domain: "" },
        question: question.trim() || undefined,
        searched: run.searched,
        considered: run.result?.considered ?? run.papers.length,
        papers: run.papers.filter((p) => !isData(p)),
        comparison: compare.comparison,
        insights: insights.insights,
      }),
    [plan, question, run, compare.comparison, insights.insights],
  );
  const downloadReport = () => downloadText(reportFileName(plan?.title ?? ""), reportText());

  const clearAll = () => {
    setText("");
    setQuestion("");
    setFileName(null);
    setTruncated(false);
    setPlan(null);
    setRun(EMPTY_RUN);
    inputRef.current?.focus();
  };

  return (
    <div className="idea" ref={topRef}>
      <section className="vhead" aria-labelledby="idea-h">
        <div className="orbs" aria-hidden="true">
          <span className="orb orb-1" />
          <span className="orb orb-2" />
        </div>
        <m.p className="eyebrow" {...rise(0)}>Idea Check</m.p>
        <m.h1 id="idea-h" className="vtitle" {...rise(1)}>
          Has your idea been{" "}
          <span className="hero-em">
            tried
            <svg className="hero-underline" viewBox="0 0 120 12" preserveAspectRatio="none" aria-hidden="true">
              <m.path d="M3 8c22-6 48-7 62-4s34 3 52-1" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, ease: easeOut, delay: 0.7 }} />
            </svg>
          </span>
          ?
        </m.h1>
        <m.p className="vsub" {...rise(2)}>
          Describe an idea or open a file. We find the closest papers in the literature, with real, checked citations, so you can see what already exists before you start.
        </m.p>
      </section>

      {status === "loading" ? (
        <div className="empty" aria-busy="true"><span className="pulse-dot" /></div>
      ) : !user ? (
        <m.div className="card papers-gate" {...rise(3)}>
          <span className="principle-ico" aria-hidden="true"><LockKeyhole size={20} /></span>
          <h2 className="papers-gate-title">Sign in to check an idea</h2>
          <p>Your idea is read by a private AI, so we need to know it is you. It takes one click.</p>
          <ProviderButtons />
        </m.div>
      ) : (
        <>
          <m.div {...rise(3)}>
            <Steps step={step} />
          </m.div>

          <AnimatePresence mode="wait" initial={false}>
            {step === "input" && (
              <m.div key="input" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10, transition: { duration: 0.15 } }} transition={{ duration: 0.35, ease: easeOut }}>
                <PrivacyCard kind="ideas" />
                <IdeaInput
                  locked={user.privacyAck !== PRIVACY_VERSION}
                  text={text}
                  question={question}
                  fileName={fileName}
                  truncated={truncated}
                  busy={planning}
                  onText={(v) => { setText(v); setFileName(null); setTruncated(false); }}
                  onQuestion={setQuestion}
                  onFile={(name, t, cut) => { setText(t); setFileName(name); setTruncated(cut); }}
                  onSubmit={() => void prepare()}
                  onClear={clearAll}
                  inputRef={inputRef}
                />
                <ul className="principles vhow" aria-label="How Idea Check works">
                  {HOW.map(({ Icon, title, body }, i) => (
                    <m.li key={title} className="card principle" {...rise(4 + i)}>
                      <span className="principle-ico" aria-hidden="true"><Icon size={20} /></span>
                      <h2 className="principle-title">{title}</h2>
                      <p>{body}</p>
                    </m.li>
                  ))}
                </ul>
              </m.div>
            )}

            {step === "plan" && plan && (
              <m.div key="plan" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10, transition: { duration: 0.15 } }} transition={{ duration: 0.35, ease: easeOut }}>
                <PlanEditor plan={plan} draft={draft} busy={searching} onChange={setDraft} onBack={() => go("input")} onSearch={() => void search()} />
              </m.div>
            )}

            {step === "results" && (
              <m.div key="results" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10, transition: { duration: 0.15 } }} transition={{ duration: 0.35, ease: easeOut }}>
                <IdeaResults run={run} compare={compare} insights={insights} hasQuestion={question.trim().length > 0} facets={plan?.facets ?? null} onCompare={() => void runCompare()} onInsights={() => void runInsights()} onDownload={downloadReport} onPrint={() => window.print()} onEditPlan={() => { abort.current?.abort(); setSearching(false); go("plan"); }} onSearchAgain={() => void search()} />
              </m.div>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
}
