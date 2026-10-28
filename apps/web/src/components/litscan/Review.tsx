import * as Tabs from "@radix-ui/react-tabs";
import { Check, CircleAlert, Copy, Download, ExternalLink, FileSpreadsheet, FileText, Landmark, Loader2, Printer, Search, ShieldCheck, X } from "lucide-react";
import { Fragment, useId, useMemo, useState } from "react";
import {
  INDIA_SCOPE_LABEL,
  LITSCAN_GAP_TEXT,
  STUDY_DESIGNS,
  apaReference,
  buildEvidenceTable,
  buildReviewMarkdown,
  evidenceCsv,
  reviewFileName,
  reviewGlance,
  toBibtex,
  toRis,
  type EvidenceRow,
  type LitscanLanguage,
  type LitscanWorkerStage,
  type Report,
  type ReportSection,
  type SearchScope,
} from "@scholar/shared";
import { downloadText, downloadBlob } from "../../lib/download";
import { showNotice } from "../../lib/notice";
import { Pop } from "../Pop";

const STAGE_TEXT: Record<LitscanWorkerStage, string> = { searching: "Searching the papers…", reading: "Reading the abstracts…" };
const who = (authors: readonly string[]) => (authors.length ? `${authors[0]!.split(/\s+/).pop()}${authors.length > 1 ? " et al." : ""}` : "");

/* ---------------------------------------------------------------- while it runs: one tile a theme */

/** The themes as tiles while the review is written: where each one is, and how it ended. No words of an answer before it is checked. */
export function ThemeBoard({ report, stages }: { report: Report; stages: Record<number, LitscanWorkerStage> }) {
  return (
    <ol className="ls-board" aria-label="Themes">
      {report.sections.map((s) => {
        const stage = stages[s.idx];
        const state = s.status === "answered" ? "done" : s.status === "gap" ? "gap" : stage ? "busy" : "wait";
        return (
          <li key={s.idx} className="ls-tile" data-state={state}>
            <span className="ls-n" aria-hidden="true">{s.idx + 1}</span>
            <span className="ls-tile-t">{s.title}</span>
            <span className="ls-tile-s">
              {s.status === "answered" ? (
                <><Check size={14} aria-hidden="true" /> Answered from {new Set(s.evidence.map((e) => e.g)).size} {new Set(s.evidence.map((e) => e.g)).size === 1 ? "paper" : "papers"}</>
              ) : s.status === "gap" ? (
                <><CircleAlert size={14} aria-hidden="true" /> No answer: see Gaps</>
              ) : stage ? (
                <><span className="pulse-dot" aria-hidden="true" /> {STAGE_TEXT[stage]}</>
              ) : (
                "Waiting…"
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* ---------------------------------------------------------------- the review */

/** A section's text with its [n] marks as buttons; a mark opens the paper it points at, under the paragraph (APA reference, the sentence, the link), without leaving the page. */
function MarkedText({ text, rows, sentences }: { text: string; rows: Map<number, EvidenceRow>; sentences: Map<number, string[]> }) {
  const [peek, setPeek] = useState<number | null>(null);
  const id = useId();
  const row = peek ? rows.get(peek) : undefined;
  return (
    <>
      <p className="reading ls-text">
        {text.split(/(\[\d{1,3}\])/g).map((part, i) => {
          const g = /^\[(\d{1,3})\]$/.exec(part)?.[1];
          if (!g) return <Fragment key={i}>{part}</Fragment>;
          const r = rows.get(Number(g));
          return (
            <button key={i} type="button" className="cite-chip" aria-expanded={peek === Number(g)} aria-controls={`${id}-peek`} aria-label={`Source ${g}: ${r?.title ?? ""}. Show it`} onClick={() => setPeek(peek === Number(g) ? null : Number(g))}>
              {g}
            </button>
          );
        })}
      </p>
      <div id={`${id}-peek`} className="ls-peek" hidden={!row} role="region" aria-label={row ? `Source ${row.g}` : undefined}>
        {row && (
          <>
            <button type="button" className="icon-btn icon-btn-sm ls-peek-x" aria-label="Close the source" onClick={() => setPeek(null)}><X size={14} aria-hidden="true" /></button>
            <p className="ls-peek-ref"><span className="chat-ev-n" aria-hidden="true">{row.g}</span> {apaReference(row)}</p>
            {sentences.get(row.g)?.map((q, i) => <p key={i} className="ls-peek-q">“{q}”</p>)}
            <p className="ls-peek-m">{row.design}{row.link && <> · <a href={row.link} target="_blank" rel="noopener noreferrer">Open the paper<span className="sr-only"> (opens in a new tab)</span></a></>}</p>
          </>
        )}
      </div>
    </>
  );
}

function ThemeSection({ s, rows }: { s: Extract<ReportSection, { status: "answered" }>; rows: Map<number, EvidenceRow> }) {
  const h = useId();
  const papers = [...new Set(s.evidence.map((e) => e.g))];
  const sentences = new Map<number, string[]>();
  for (const e of s.evidence) sentences.set(e.g, [...(sentences.get(e.g) ?? []), e.sentence]);
  return (
    <section className="card ls-section" aria-labelledby={h}>
      <h3 id={h} className="ls-section-h">{s.title}</h3>
      <p className="ls-section-m"><ShieldCheck size={14} aria-hidden="true" /> {papers.length} {papers.length === 1 ? "paper" : "papers"} · each claim points at a sentence of an abstract</p>
      <MarkedText text={s.text} rows={rows} sentences={sentences} />
      <details className="chat-evidence">
        <summary>The sentences behind it</summary>
        <ul>
          {s.evidence.map((e, i) => (
            <li key={i} className="chat-ev">
              <span className="chat-ev-n">{e.g}</span>
              <span>
                <span className="chat-ev-t">{rows.get(e.g)?.title}</span>
                <span className="chat-ev-q">“{e.sentence}”</span>
              </span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

function Glance({ report, rows, scope }: { report: Report; rows: EvidenceRow[]; scope?: SearchScope }) {
  const g = reviewGlance(report, rows);
  return (
    <div className="ls-glance" role="group" aria-label="At a glance">
      <p className="ls-stat"><b>{g.answered}<span>/{g.themes}</span></b><span>themes answered</span></p>
      <p className="ls-stat"><b>{g.papers}</b><span>{g.papers === 1 ? "paper cited" : "papers cited"}</span></p>
      <p className="ls-stat"><b>{g.yearFrom ? (g.yearFrom === g.yearTo ? g.yearFrom : `${g.yearFrom}–${String(g.yearTo).slice(-2)}`) : "–"}</b><span>{g.yearFrom === g.yearTo ? "year" : "years"}</span></p>
      <div className="ls-stat ls-designs">
        <span className="ls-designs-h">Study designs</span>
        <ul>{g.designs.slice(0, 4).map((d) => <li key={d.design}><b>{d.n}</b> {d.design}</li>)}</ul>
      </div>
      {scope === "india" && <p className="ls-scope-badge"><Landmark size={14} aria-hidden="true" /> {INDIA_SCOPE_LABEL} only</p>}
    </div>
  );
}

function EvidenceTable({ rows, themes }: { rows: EvidenceRow[]; themes: string[] }) {
  const id = useId();
  const [theme, setTheme] = useState("all");
  const [design, setDesign] = useState("all");
  const [sort, setSort] = useState<"no" | "new" | "old">("no");
  const shown = useMemo(() => {
    const list = rows.filter((r) => (theme === "all" || r.themes.includes(theme)) && (design === "all" || r.design === design));
    if (sort === "no") return list;
    return [...list].sort((a, b) => (sort === "new" ? (b.year ?? 0) - (a.year ?? 0) : (a.year ?? 9999) - (b.year ?? 9999)) || a.g - b.g);
  }, [rows, theme, design, sort]);
  const designs = STUDY_DESIGNS.filter((d) => rows.some((r) => r.design === d));
  return (
    <div className="ls-table-wrap">
      <div className="ls-filters">
        <label htmlFor={`${id}-th`}>Theme</label>
        <select id={`${id}-th`} className="ls-select" value={theme} onChange={(e) => setTheme(e.target.value)}>
          <option value="all">All themes</option>
          {themes.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <label htmlFor={`${id}-de`}>Design</label>
        <select id={`${id}-de`} className="ls-select" value={design} onChange={(e) => setDesign(e.target.value)}>
          <option value="all">All designs</option>
          {designs.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <label htmlFor={`${id}-so`}>Order</label>
        <select id={`${id}-so`} className="ls-select" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          <option value="no">By number</option>
          <option value="new">Newest first</option>
          <option value="old">Oldest first</option>
        </select>
      </div>
      <p className="ls-hint" role="status">{shown.length} of {rows.length} papers. The design is read from the paper's own words (its title and the sentences cited); "Not stated" when they do not say.</p>
      <table className="ls-table">
        <caption className="sr-only">Evidence table: one row a paper, with the sentences of its abstract that the review rests on</caption>
        <thead>
          <tr><th scope="col">No.</th><th scope="col">Study</th><th scope="col">Design</th><th scope="col">Key finding</th><th scope="col">Theme</th></tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.g}>
              <td data-label="No."><span className="chat-ev-n">{r.g}</span></td>
              <td data-label="Study">
                <span className="ls-study">{who(r.authors)}{r.year ? ` (${r.year})` : ""}</span>
                <span className="ls-study-t">{r.link ? <a href={r.link} target="_blank" rel="noopener noreferrer">{r.title}<span className="sr-only"> (opens in a new tab)</span></a> : r.title}</span>
                {r.venue && <span className="ls-study-v">{r.venue}</span>}
              </td>
              <td data-label="Design">{r.design}</td>
              <td data-label="Key finding">{r.findings.map((f, i) => <p key={i} className="ls-finding">“{f.sentence}”</p>)}</td>
              <td data-label="Theme">{r.themes.join("; ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Gaps({ report }: { report: Report }) {
  const gaps = report.sections.filter((s) => s.status !== "answered");
  if (gaps.length === 0) return <p className="ls-empty"><Check size={16} aria-hidden="true" /> Every theme has a checked answer.</p>;
  return (
    <ul className="ls-gaps">
      {gaps.map((s) => (
        <li key={s.idx} className="card ls-gapcard">
          <h3 className="ls-section-h">{s.title}</h3>
          <p className="ls-gap">{s.status === "gap" ? LITSCAN_GAP_TEXT[s.reason] : "Not finished yet."}</p>
          <p className="ls-gap-m">Searched for <span lang="en">“{s.searchQuery}”</span> · <a href={`/?q=${encodeURIComponent(s.searchQuery)}`} target="_blank" rel="noopener"><Search size={13} aria-hidden="true" /> Look at the papers yourself<span className="sr-only"> (opens in a new tab)</span></a></p>
        </li>
      ))}
    </ul>
  );
}

function References({ report }: { report: Report }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report.sources.map((r) => `${r.g}. ${apaReference(r)}`).join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      showNotice("Your browser would not copy them. Select the list and copy it by hand.");
    }
  };
  return (
    <div className="ls-refs">
      <div className="ls-bar">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copy()}>
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          <span>{copied ? "Copied" : "Copy all (APA)"}</span>
        </button>
        <span className="sr-only" role="status">{copied ? "The references are copied." : ""}</span>
      </div>
      <p className="ls-hint">APA 7, as far as the indexes' records go: check volume and pages before you submit. Only abstracts were read, not the full papers.</p>
      <ol className="ls-sources">
        {report.sources.map((r) => (
          <li key={r.g}>
            <span className="chat-ev-n" aria-hidden="true">{r.g}</span>
            <span>
              <span className="ls-ref">{apaReference(r)}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Downloads: the whole review (Markdown and Word), the evidence table (CSV for Excel or Sheets), the references (BibTeX, RIS), and print. */
export function ExportMenu({ topic, language, report, scope }: { topic: string; language: LitscanLanguage; report: Report; scope?: SearchScope }) {
  const rows = () => buildEvidenceTable(report);
  const items: { label: string; hint: string; Icon: typeof FileText; run: () => void }[] = [
    { label: "Review (Markdown)", hint: "Text with headings, tables and references, for any editor", Icon: FileText, run: () => downloadText(reviewFileName(topic, "md"), buildReviewMarkdown({ appName: "Scholar AI", generatedAt: new Date().toISOString(), topic, language, report, indian: scope === "india" }), "text/markdown;charset=utf-8") },
    {
      label: "Review (Word)",
      hint: "Opens in Word and Google Docs, with its table, links and references",
      Icon: FileText,
      run: () => void (async () => {
        try {
          const { reviewDocxBlob } = await import("../../lib/docx");
          downloadBlob(reviewFileName(topic, "docx"), await reviewDocxBlob({ appName: "Scholar AI", generatedAt: new Date().toISOString(), topic, language, report, indian: scope === "india" }));
        } catch {
          showNotice("The Word file could not be made. Download the Markdown review instead.");
        }
      })(),
    },
    { label: "Evidence table (CSV)", hint: "For Excel or Google Sheets", Icon: FileSpreadsheet, run: () => downloadText(reviewFileName(topic, "csv"), evidenceCsv(rows()), "text/csv;charset=utf-8") },
    { label: "References (BibTeX)", hint: "For LaTeX, Zotero, JabRef", Icon: FileText, run: () => downloadText(reviewFileName(topic, "bib"), toBibtex(report.sources), "application/x-bibtex;charset=utf-8") },
    { label: "References (RIS)", hint: "For Zotero, Mendeley, EndNote", Icon: FileText, run: () => downloadText(reviewFileName(topic, "ris"), toRis(report.sources), "application/x-research-info-systems;charset=utf-8") },
    { label: "Print or save as PDF", hint: "Everything, on paper", Icon: Printer, run: () => window.print() },
  ];
  return (
    <Pop
      label="Download the review"
      align="start"
      trigger={(open) => (
        <button type="button" className="btn btn-primary" aria-haspopup="menu" aria-expanded={open}>
          <Download size={16} aria-hidden="true" />
          <span>Download</span>
        </button>
      )}
    >
      {(close) => (
        <div role="menu" aria-label="Download the review" className="hm-menu ls-export">
          {items.map((it) => (
            <button key={it.label} type="button" role="menuitem" className="hm-menu-item" onClick={() => { close(); it.run(); }}>
              <span className="hm-menu-ico"><it.Icon size={16} aria-hidden="true" /></span>
              <span className="hm-menu-txt"><b>{it.label}</b><small>{it.hint}</small></span>
              <span aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </Pop>
  );
}

/**
 * The review: at a glance, then four tabs (the findings by theme, the evidence table, the gaps, the references). All four are in the page (only one shown), so printing gives all of them.
 */
export function Review({ report, scope, running }: { report: Report; scope?: SearchScope; running?: boolean }) {
  const rows = useMemo(() => buildEvidenceTable(report), [report]);
  const byG = useMemo(() => new Map(rows.map((r) => [r.g, r])), [rows]);
  const answered = report.sections.filter((s): s is Extract<ReportSection, { status: "answered" }> => s.status === "answered");
  const gapCount = report.sections.length - answered.length;
  const [tab, setTab] = useState("summary");
  return (
    <div className="ls-review">
      <Glance report={report} rows={rows} scope={scope} />
      <Tabs.Root value={tab} onValueChange={setTab} className="ls-tabs">
        <Tabs.List className="ls-tablist" aria-label="The review">
          <Tabs.Trigger value="summary" className="ls-tab">Summary</Tabs.Trigger>
          <Tabs.Trigger value="table" className="ls-tab">Evidence table <span className="ls-tab-n">{rows.length}</span></Tabs.Trigger>
          <Tabs.Trigger value="gaps" className="ls-tab">Gaps <span className="ls-tab-n">{gapCount}</span></Tabs.Trigger>
          <Tabs.Trigger value="refs" className="ls-tab">References <span className="ls-tab-n">{report.sources.length}</span></Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="summary" forceMount hidden={tab !== "summary"} className="ls-panel">
          <h2 className="ls-print-h">Findings by theme</h2>
          {answered.length === 0 ? <p className="ls-empty">{running ? <><Loader2 className="spin" size={16} aria-hidden="true" /> The first answers appear here as their themes finish.</> : "No theme could be answered from the abstracts found. See Gaps."}</p> : answered.map((s) => <ThemeSection key={s.idx} s={s} rows={byG} />)}
        </Tabs.Content>
        <Tabs.Content value="table" forceMount hidden={tab !== "table"} className="ls-panel">
          <h2 className="ls-print-h">Evidence table</h2>
          {rows.length ? <EvidenceTable rows={rows} themes={answered.map((s) => s.title)} /> : <p className="ls-empty">No paper is cited yet.</p>}
        </Tabs.Content>
        <Tabs.Content value="gaps" forceMount hidden={tab !== "gaps"} className="ls-panel">
          <h2 className="ls-print-h">Gaps</h2>
          <Gaps report={report} />
        </Tabs.Content>
        <Tabs.Content value="refs" forceMount hidden={tab !== "refs"} className="ls-panel">
          <h2 className="ls-print-h">References</h2>
          {report.sources.length ? <References report={report} /> : <p className="ls-empty">No paper is cited yet.</p>}
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
