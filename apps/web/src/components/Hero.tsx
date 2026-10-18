import { m } from "motion/react";
import { ArrowRight, BadgeCheck, Layers, ShieldAlert } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { easeOut, stagger } from "../lib/motion";
import { SearchBox } from "./SearchBox";

const EXAMPLES = [
  "graph neural networks",
  "NEP 2020 higher education India",
  "CRISPR off-target effects",
  "plagiarism detection techniques",
];

const PRINCIPLES = [
  { Icon: BadgeCheck, title: "Real records only", body: "Every citation comes from OpenAlex, Semantic Scholar, Crossref or PubMed. Nothing is invented by AI." },
  { Icon: ShieldAlert, title: "Retractions flagged", body: "Each result is checked against Retraction Watch data, so you never cite a withdrawn paper by accident." },
  { Icon: Layers, title: "Four sources, one list", body: "Duplicates are merged by DOI, and papers that several sources agree on rise to the top." },
];

const rise = (i: number) => ({
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6, ease: easeOut, delay: 0.08 + stagger(i, 0.09) },
});

export function Hero({
  value,
  onChange,
  onSubmit,
  onPick,
  onVerify,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onPick: (q: string) => void;
  onVerify: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
}): ReactNode {
  return (
    <section className="hero" aria-labelledby="hero-h">
      <div className="orbs" aria-hidden="true">
        <span className="orb orb-1" />
        <span className="orb orb-2" />
      </div>

      <m.p className="eyebrow" {...rise(0)}>
        For researchers, scholars and professors
      </m.p>

      <m.h1 id="hero-h" className="hero-title" {...rise(1)}>
        Find papers you can{" "}
        <span className="hero-em">
          trust
          <svg className="hero-underline" viewBox="0 0 120 12" preserveAspectRatio="none" aria-hidden="true">
            <m.path d="M3 8c22-6 48-7 62-4s34 3 52-1" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, ease: easeOut, delay: 0.7 }} />
          </svg>
        </span>
        .
      </m.h1>

      <m.p className="hero-sub" {...rise(2)}>
        Search four scholarly sources at once. Verified metadata, automatic retraction checks, and citations you can paste straight into your thesis.
      </m.p>

      <m.div className="hero-search" {...rise(3)}>
        <SearchBox value={value} onChange={onChange} onSubmit={onSubmit} inputRef={inputRef} size="large" />
        <div className="examples" role="group" aria-label="Example searches">
          <span className="examples-label">Try</span>
          {EXAMPLES.map((q, i) => (
            <m.button key={q} type="button" className="chip-btn" onClick={() => onPick(q)} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: easeOut, delay: 0.55 + stagger(i, 0.07) }} whileTap={{ scale: 0.96 }}>
              {q}
            </m.button>
          ))}
        </div>
        <m.p className="hero-verify" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5, delay: 1 }}>
          Have a reference list to check?{" "}
          <a className="link-btn" href="/verify" onClick={(e) => { e.preventDefault(); onVerify(); }}>Verify your references <ArrowRight size={14} aria-hidden="true" /></a>
        </m.p>
      </m.div>

      <ul className="principles">
        {PRINCIPLES.map(({ Icon, title, body }, i) => (
          <m.li key={title} className="card principle" {...rise(4 + i)} whileHover={{ y: -3 }}>
            <span className="principle-ico" aria-hidden="true">
              <Icon size={20} />
            </span>
            <h2 className="principle-title">{title}</h2>
            <p>{body}</p>
          </m.li>
        ))}
      </ul>
    </section>
  );
}
