import { useMotionValueEvent, type MotionValue } from "motion/react";
import { BadgeCheck, FileText, Lightbulb, ListChecks, Search, TriangleAlert } from "lucide-react";
import { useState, type ReactNode } from "react";
import { FEATURES } from "../../lib/workspace";

/**
 * The four scenes shown inside the product window of the intro page. Each one is a pure function of a progress number from 0 to 1, so the same
 * scene is scrubbed by scroll in the pinned tour, plays once on load in the hero, and shows its finished state in the stacked layout (progress 1).
 * Everything here is SAMPLE DATA, drawn to look like the product; nothing is searched. Nothing in a scene is focusable.
 *
 * Layout never changes while a scene plays: the finished layout is always in the page and what is not yet "on" is only hidden (visibility), so
 * the scroll story causes no layout shift (CLS 0 is a budget of this page).
 */

/** Re-render only when the picked value changes (typed characters, number of words, step), not on every scroll frame. */
export function useScrub<T>(p: MotionValue<number>, pick: (v: number) => T): T {
  const [val, setVal] = useState<T>(() => pick(p.get()));
  useMotionValueEvent(p, "change", (v) => {
    const next = pick(v);
    setVal((prev) => (Object.is(prev, next) ? prev : next));
  });
  return val;
}
/** 0 before `a`, 1 after `b`, linear between. */
export const seg = (v: number, a: number, b: number) => Math.min(1, Math.max(0, (v - a) / (b - a)));

export type SceneId = "search" | "verify" | "idea" | "paper";
const MODE: Record<SceneId, { name: string; Icon: typeof Search }> = {
  search: { name: "Search papers", Icon: Search },
  verify: { name: "Check references", Icon: ListChecks },
  idea: { name: "Idea Check", Icon: Lightbulb },
  paper: { name: "Ask a paper", Icon: FileText },
};

/** Takes its place in the layout from the start; shows (with a small rise) when `on`. */
function Rv({ on, className = "", children }: { on: boolean; className?: string; children: ReactNode }) {
  return <div className={`in-rv ${className}`} data-on={on}>{children}</div>;
}

const Understood = ({ id, on }: { id: SceneId; on: boolean }) => {
  const { name, Icon } = MODE[id];
  return (
    <Rv on={on} className="in-understood">
      <Icon size={14} aria-hidden="true" />
      <span>I understood this as <strong>{name}</strong></span>
      <span className="in-fakebtn">Change</span>
    </Rv>
  );
};

function Steps({ labels, done, on }: { labels: string[]; done: number; on: boolean }) {
  return (
    <div className="in-steps in-rv" data-on={on}>
      {labels.map((l, i) => (
        <div key={l} className="in-step" data-s={i < done ? "done" : i === done ? "now" : "todo"}>
          <span className="in-sd">
            {i < done && (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            )}
          </span>
          <span>{l}</span>
        </div>
      ))}
    </div>
  );
}

/** The window: a prompt box with a typed line and a mode chip, and the answer area under it. */
export function Win({ id, full, typed, chip, children }: { id: SceneId; full: string; typed: number; chip: boolean; children: ReactNode }) {
  const { name, Icon } = MODE[id];
  return (
    <div className="in-win">
      <div className="in-win-top">
        <span className="in-dots"><i /><i /><i /></span>
        <span>Sample data. Nothing is searched here.</span>
      </div>
      <div className="in-win-in">
        <div className="in-typed">
          {full.slice(0, typed)}
          {typed > 0 && typed < full.length && <span className="in-caret" />}
          <span className="in-ghost">{full.slice(typed)}</span>
        </div>
        <span className="in-chip" data-on={chip}>
          <span className="in-chip-a" data-show={!chip}><Search size={14} aria-hidden="true" />Auto</span>
          <span className="in-chip-b" data-show={chip}><Icon size={14} aria-hidden="true" />{name}</span>
        </span>
      </div>
      <div className="in-win-out">{children}</div>
    </div>
  );
}

const cite = (n: number) => <span className="in-cite" key={`c${n}`}>{n}</span>;

function Words({ text, shown }: { text: string; shown: number }) {
  return (
    <p className="in-answer">
      {text.split(" ").map((w, i) => {
        const m = /^\[(\d)\]([.,]?)$/.exec(w);
        return (
          <span key={i} className="in-w" data-on={i < shown}>
            {m ? <>{cite(Number(m[1]))}{m[2]}</> : w}{" "}
          </span>
        );
      })}
    </p>
  );
}

/** Steps and the answer share one place: the steps show first, the answer replaces them without moving anything. */
const Over = ({ children }: { children: ReactNode }) => <div className="in-over">{children}</div>;

/* ---------------------------------------------------------------- 1. find papers */
const Q1 = "Which studies measured soil moisture from a moving tractor?";
const A1 = "Two studies mounted sensors on a tractor and compared the readings with hand samples [1]. A third found that low-cost probes drift after a season [2]. One record in the list was retracted, so its result should not be relied on [3].";
const A1_WORDS = A1.split(" ").length;

export function SearchScene({ p }: { p: MotionValue<number> }) {
  const typed = useScrub(p, (v) => Math.round(seg(v, 0, 0.18) * Q1.length));
  const chip = useScrub(p, (v) => v > 0.2);
  const step = useScrub(p, (v) => (v < 0.24 ? -1 : v < 0.33 ? 0 : v < 0.42 ? 1 : 2));
  const words = useScrub(p, (v) => Math.round(seg(v, 0.5, 0.76) * A1_WORDS));
  const cards = useScrub(p, (v) => (v > 0.88 ? 2 : v > 0.78 ? 1 : 0));
  return (
    <Win id="search" full={Q1} typed={typed} chip={chip}>
      <Understood id="search" on={chip} />
      <Over>
        <Steps labels={["Understanding the question", "Finding and checking records", "Writing the summary"]} done={step} on={step >= 0 && words === 0} />
        <div className="in-rv" data-on={words > 0}><Words text={A1} shown={words} /></div>
      </Over>
      <Rv on={cards >= 1} className="in-paper">
        <h4>Tractor-mounted soil moisture sensing for strip-level irrigation</h4>
        <p className="in-meta">Sample, Example · 2022</p>
        <div className="in-badges"><span className="in-badge ok"><BadgeCheck size={12} aria-hidden="true" />DOI checked</span><span className="in-badge">Open access</span></div>
      </Rv>
      <Rv on={cards >= 2} className="in-paper in-paper-bad">
        <h4>Sensor-based irrigation scheduling</h4>
        <p className="in-meta">Retracted, F. · 2017</p>
        <div className="in-badges"><span className="in-badge bad"><TriangleAlert size={12} aria-hidden="true" />Retracted: do not rely on this result</span></div>
      </Rv>
    </Win>
  );
}

/* ---------------------------------------------------------------- 2. check references */
const HI: boolean = FEATURES.hinglish;
const Q2 = HI ? "Mere thesis ke references check kar do" : "Check the references in my thesis";
const REFS: { t: string; why: string; kind: "ok" | "warn" | "none" | "bad"; label: string }[] = [
  { t: "Sample, A. (2022). Tractor-mounted soil moisture sensing for strip-level irrigation.", why: "Title, authors and year match a record.", kind: "ok", label: "Verified" },
  { t: "Placeholder, C. (2020). Low-cost probes for smallholder fields.", why: "A paper with this title exists; the year differs (2021).", kind: "warn", label: "Check the year" },
  { t: "Nobody, N. (2019). A study that the databases do not list.", why: "Not found. Books and regional journals are often not indexed.", kind: "none", label: "Not found" },
  { t: "Retracted, F. (2017). Sensor-based irrigation scheduling.", why: "Matches a record that was retracted.", kind: "bad", label: "Retracted" },
];

export function VerifyScene({ p }: { p: MotionValue<number> }) {
  const typed = useScrub(p, (v) => Math.round(seg(v, 0, 0.16) * Q2.length));
  const chip = useScrub(p, (v) => v > 0.18);
  const step = useScrub(p, (v) => (v < 0.22 ? -1 : v < 0.34 ? 0 : v < 0.44 ? 1 : 2));
  const rows = useScrub(p, (v) => Math.round(seg(v, 0.44, 0.84) * REFS.length));
  const sum = useScrub(p, (v) => v > 0.9);
  return (
    <Win id="verify" full={Q2} typed={typed} chip={chip}>
      <Understood id="verify" on={chip} />
      <Over>
        <Steps labels={["Reading your list", "Looking up each reference"]} done={step} on={step >= 0 && step < 2 && rows === 0} />
        <div className="in-rows">
          {REFS.map((r, i) => (
            <Rv key={i} on={i < rows} className="in-ref">
              <span className="in-n">{i + 1}</span>
              <div><p>{r.t}</p><p className="in-meta">{r.why}</p></div>
              <span className={`in-badge ${r.kind}`}>{r.label}</span>
            </Rv>
          ))}
        </div>
      </Over>
      <Rv on={sum} className="in-honest">&ldquo;Not found&rdquo; does not mean made up: books, theses and regional journals are often not indexed. A database outage is shown as &ldquo;could not check&rdquo;, never as &ldquo;not found&rdquo;.</Rv>
    </Win>
  );
}

/* ---------------------------------------------------------------- 3. check an idea */
const Q3 = "Idea: screening glaucoma in rural clinics with a phone camera";
const FACETS = ["Purpose", "Method", "Testing", "Field"];
const CELLS = [
  ["same", "like", "", "", "like", ""],
  ["same", "like", "like", "", "", ""],
  ["same", "", "", "", "", "like"],
  ["", "same", "", "like", "", ""],
];

export function IdeaScene({ p }: { p: MotionValue<number> }) {
  const typed = useScrub(p, (v) => Math.round(seg(v, 0, 0.2) * Q3.length));
  const chip = useScrub(p, (v) => v > 0.22);
  const parts = useScrub(p, (v) => Math.round(seg(v, 0.26, 0.42) * 4));
  const cells = useScrub(p, (v) => Math.round(seg(v, 0.46, 0.88) * 24));
  const note = useScrub(p, (v) => v > 0.92);
  return (
    <Win id="idea" full={Q3} typed={typed} chip={chip}>
      <Understood id="idea" on={chip} />
      <div className="in-facets">
        {FACETS.map((f, i) => <Rv key={f} on={i < parts} className="in-facet">{f}</Rv>)}
      </div>
      <Rv on={cells > 0}>
        <p className="in-meta" style={{ margin: "0.4rem 0 0.2rem" }}>What six papers have in common with each part of your idea</p>
        <div className="in-mx">
          {FACETS.map((f, r) => (
            <div key={f} className="in-mxr">
              <span>{f}</span>
              {CELLS[r]!.map((c, k) => {
                const shown = r * 6 + k < cells;
                return <span key={k} className={`in-cell ${shown ? c : ""}`} />;
              })}
            </div>
          ))}
        </div>
      </Rv>
      <Rv on={note} className="in-honest">It shows what is already written. It never says your idea is new or not new.</Rv>
    </Win>
  );
}

/* ---------------------------------------------------------------- 4. ask a paper */
const Q4 = HI ? "Is paper ki limitations kya hain?" : "What are the limitations of this paper?";
const A4 = HI ? "Authors ek limitation batate hain: ek season ke baad calibration drift ho gaya, isliye readings dobara check karni padi [1]." : "The authors name one limitation: calibration of the probes drifted after one season, so the readings had to be re-checked [1].";
const A4_WORDS = A4.split(" ").length;

export function PaperScene({ p }: { p: MotionValue<number> }) {
  const typed = useScrub(p, (v) => Math.round(seg(v, 0, 0.16) * Q4.length));
  const chip = useScrub(p, (v) => v > 0.18);
  const step = useScrub(p, (v) => (v < 0.22 ? -1 : v < 0.34 ? 0 : v < 0.46 ? 1 : 2));
  const words = useScrub(p, (v) => Math.round(seg(v, 0.46, 0.7) * A4_WORDS));
  const sweep = useScrub(p, (v) => Math.round(seg(v, 0.72, 0.92) * 20) / 20);
  return (
    <Win id="paper" full={Q4} typed={typed} chip={chip}>
      <Understood id="paper" on={chip} />
      <Over>
        <Steps labels={["Finding the right passages", "Checking every quote against the paper"]} done={step} on={step >= 0 && words === 0} />
        <div className="in-rv" data-on={words > 0}>
          <p className="in-label"><b>From your paper</b> Tractor-mounted soil moisture sensing</p>
          <div lang={HI ? "hi-Latn" : "en"}><Words text={A4} shown={words} /></div>
        </div>
      </Over>
      <Rv on={sweep > 0} className="in-paper">
        <div className="in-badges"><span className="in-badge ok"><BadgeCheck size={12} aria-hidden="true" />Quote found on page 4</span></div>
        <p className="in-quote">
          &ldquo;<mark style={{ backgroundSize: `${sweep * 100}% 100%` }}>Calibration drifted after one season and needed re-checking.</mark>&rdquo;
        </p>
      </Rv>
    </Win>
  );
}

export const SCENES: Record<SceneId, (props: { p: MotionValue<number> }) => ReactNode> = {
  search: SearchScene,
  verify: VerifyScene,
  idea: IdeaScene,
  paper: PaperScene,
};
