import { animate, m, motionValue, useInView, useMotionValue, useReducedMotion, useScroll, useSpring, useTransform, type MotionValue } from "motion/react";
import { ArrowRight, Lock, Share2, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Logo } from "../../components/Logo";
import { Footer } from "../../components/Footer";
import { ProviderButtons } from "../../components/ProviderButtons";
import { SignInDialog } from "../../components/AccountMenu";
import { ThemeSwitch } from "../../components/ThemeSwitch";
import { useAuth } from "../../lib/auth";
import { useMediaQuery } from "../../lib/media";
import { easeOut } from "../../lib/motion";
import { FEATURES } from "../../lib/workspace";
import { SCENES, SearchScene, useScrub, type SceneId } from "./scenes";
import "../../styles/intro.css";

/* ====================================================================================================================
 * The intro page for people who are not signed in: a scroll-animated story. Why it is built this way (Motion's scroll
 * timelines, native scrolling, sticky chapters, a plain stacked layout for phones and reduced motion): docs/design/scroll-site.md.
 * ==================================================================================================================== */

const CHAPTERS: { id: SceneId; kicker: string; title: string; body: string; points: string[] }[] = [
  {
    id: "search",
    kicker: "Find papers",
    title: "Real papers, not guesses.",
    body: "Ask a question or paste a DOI. You get a short summary written from the records, and the records themselves.",
    points: ["Every DOI is checked; one that does not exist is removed before you can cite it", "A retracted paper wears a red banner everywhere it appears", "Open-access papers are marked, with a link"],
  },
  {
    id: "verify",
    kicker: "Check your references",
    title: "Find the references that do not exist.",
    body: "Paste a bibliography, even a messy one from Word. Each entry is looked up and compared on title, authors and year.",
    points: ["Verdicts in words, not only colours", "“Not found” says that a book or a thesis may simply not be indexed", "Download a report to send to your supervisor"],
  },
  {
    id: "idea",
    kicker: "Check an idea",
    title: "See what is already written about your idea.",
    body: "Describe it, or open a file. You approve the search first; then the closest papers are compared with each part of your idea.",
    points: ["You see and edit what is searched; your text is never sent", "Every match shows the sentence it rests on", "It never says your idea is new or not new"],
  },
  {
    id: "paper",
    kicker: "Ask a paper",
    title: "Ask your papers. Check the answer.",
    body: "Upload a PDF, scans included, and ask it questions. Every answer shows the page and the exact quote.",
    points: ["A quote that is not in the paper is never shown", "Private to your account, never used to train AI", FEATURES.hinglish ? "Ask in English, Hindi or Hinglish" : "Hindi and other Indian languages work too"],
  },
];

const N = CHAPTERS.length;
const ONE = motionValue(1);

/** Words arrive one by one (the headline). */
function HeroWords({ words, emphasis }: { words: string[]; emphasis?: number }) {
  return (
    <>
      {words.map((w, i) => (
        <span key={i}>
          <m.span
            className="in-wd"
            initial={{ opacity: 0.02, y: "0.35em", filter: "blur(8px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.8, ease: easeOut, delay: 0.08 * i + 0.05 }}
          >
            {i === emphasis ? (
              <em>
                {w}
                <svg viewBox="0 0 120 12" preserveAspectRatio="none" aria-hidden="true">
                  <m.path d="M3 8c22-6 48-7 62-4s34 3 52-1" fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1, ease: easeOut, delay: 0.9 }} />
                </svg>
              </em>
            ) : (
              w
            )}
          </m.span>
          {i < words.length - 1 ? " " : ""}
        </span>
      ))}
    </>
  );
}

/** Fades and rises once when it comes into view; `data-seen` lets CSS start small animations inside it. */
function Reveal({ children, className, delay = 0, as = "div" }: { children: ReactNode; className?: string; delay?: number; as?: "div" | "article" | "li" | "section" }) {
  const ref = useRef<HTMLElement>(null);
  const seen = useInView(ref, { once: true, amount: 0.3 });
  const Tag = m[as] as typeof m.div;
  return (
    <Tag ref={ref as never} className={className} data-seen={seen} initial={{ opacity: 0, y: 28 }} animate={seen ? { opacity: 1, y: 0 } : undefined} transition={{ duration: 0.7, ease: easeOut, delay }}>
      {children}
    </Tag>
  );
}

/* ---------------------------------------------------------------- header */
function Header({ onTop }: { onTop: () => void }) {
  const { scrollYProgress } = useScroll();
  const bar = useSpring(scrollYProgress, { stiffness: 220, damping: 32, restDelta: 0.001 });
  const [solid, setSolid] = useState(false);
  const reduce = useReducedMotion();
  useEffect(() => {
    const on = () => setSolid(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  const jump = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };
  return (
    <header className="in-head" data-solid={solid}>
      <div className="in-head-in">
        <button type="button" className="logo-btn" onClick={onTop} aria-label="Scholar AI, back to the top">
          <Logo />
        </button>
        <nav className="in-links" aria-label="On this page">
          <a href="#tour" onClick={jump("tour")}>What it does</a>
          <a href="#trust" onClick={jump("trust")}>Why you can trust it</a>
          {FEATURES.hinglish && <a href="#hinglish" onClick={jump("hinglish")}>Hindi and Hinglish</a>}
          <a href="#privacy" onClick={jump("privacy")}>Privacy</a>
        </nav>
        <div className="in-head-end">
          <ThemeSwitch scope="intro" />
          <SignInDialog />
        </div>
      </div>
      <m.div className="in-progress" style={{ scaleX: bar }} aria-hidden="true" />
    </header>
  );
}

/* ---------------------------------------------------------------- hero */
function Cta({ onStart }: { onStart: () => void }) {
  const { providers } = useAuth();
  return (
    <div className="in-cta">
      {providers.length > 0 && <ProviderButtons />}
      <a className={`btn ${providers.length > 0 ? "btn-ghost" : "btn-primary"} btn-lg`} href="/home" onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); onStart(); }}>
        Try it without signing in <ArrowRight size={16} aria-hidden="true" />
      </a>
    </div>
  );
}

function Hero({ onStart, stacked }: { onStart: () => void; stacked: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const aurora = useTransform(scrollYProgress, [0, 1], ["0%", "22%"]);
  const grid = useTransform(scrollYProgress, [0, 1], ["0%", "9%"]);
  const gridFade = useTransform(scrollYProgress, [0, 0.8], [0.55, 0]);
  const winY = useTransform(scrollYProgress, [0, 1], [0, -70]);
  const winTilt = useTransform(scrollYProgress, [0, 1], [0, 9]);
  const winScale = useTransform(scrollYProgress, [0, 1], [1, 0.95]);
  // the window types and answers once when the page opens (5 seconds, then it stays as it is)
  const p = useMotionValue(stacked ? 1 : 0);
  useEffect(() => {
    if (stacked) {
      p.set(1);
      return;
    }
    const a = animate(p, 1, { duration: 5, ease: "linear", delay: 0.5 });
    return () => a.stop();
  }, [stacked, p]);

  return (
    <section ref={ref} className="in-hero" aria-labelledby="in-h1">
      <m.div className="in-aurora" style={stacked ? undefined : { y: aurora }} aria-hidden="true" />
      <m.div className="in-grid" style={stacked ? undefined : { y: grid, opacity: gridFade }} aria-hidden="true" />
      <div className="in-wrap in-herogrid">
        <div className="in-copy">
          <p className="in-eyebrow">For researchers, scholars and professors</p>
          <h1 id="in-h1" className="in-h1">
            <HeroWords words={["Research", "you", "can", "trust."]} emphasis={3} />
          </h1>
          <m.p className="in-sub" initial={{ opacity: 0.02, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: easeOut, delay: 0.5 }}>
            Ask anything. Scholar AI finds real papers, checks that each one exists and was not retracted, and answers from the paper itself, with the exact quote.
          </m.p>
          <m.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: easeOut, delay: 0.65 }}>
            <Cta onStart={onStart} />
            <p className="in-small">Your papers and ideas stay private to your account.</p>
            <ul className="in-checks" aria-label="What is checked">
              {["Every DOI checked", "Retractions flagged", "Quotes checked against the text", "No citation written by AI"].map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </m.div>
        </div>
        <m.div className="in-herowin" style={stacked ? undefined : { y: winY, rotateX: winTilt, scale: winScale }} initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1 }} transition={{ duration: 0.9, ease: easeOut, delay: 0.35 }}>
          <div role="img" aria-label="A sample session: a question is typed, the assistant says it understood a search, checks the records and answers with citations.">
            <div aria-hidden="true"><SearchScene p={p} /></div>
          </div>
        </m.div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- the tour */
/**
 * Where chapter i fades in and out along the scroll progress. Every number stays inside 0 to 1 and never decreases: the browser's own scroll
 * timeline (which Motion uses where it can) rejects anything else.
 */
const fadeRange = (i: number): number[] => [i === 0 ? 0 : i / N - 0.025, i / N + 0.02, (i + 1) / N - 0.03, i === N - 1 ? 1 : (i + 1) / N + 0.015];

function ChapterText({ i, p }: { i: number; p: MotionValue<number> }) {
  const c = CHAPTERS[i]!;
  const opacity = useTransform(p, fadeRange(i), [i === 0 ? 1 : 0, 1, 1, i === N - 1 ? 1 : 0]);
  const y = useTransform(p, fadeRange(i), [i === 0 ? 0 : 36, 0, 0, i === N - 1 ? 0 : -36]);
  return (
    <m.div className="in-chap" style={{ opacity, y }}>
      <p className="in-kicker">{c.kicker}</p>
      <h3 className="in-chap-h">{c.title}</h3>
      <p className="in-chap-p">{c.body}</p>
      <ul className="in-points">{c.points.map((t) => <li key={t}>{t}</li>)}</ul>
    </m.div>
  );
}

function ChapterWin({ i, p }: { i: number; p: MotionValue<number> }) {
  const Scene = SCENES[CHAPTERS[i]!.id];
  const opacity = useTransform(p, fadeRange(i), [i === 0 ? 1 : 0, 1, 1, i === N - 1 ? 1 : 0]);
  const scale = useTransform(p, fadeRange(i), [i === 0 ? 1 : 0.94, 1, 1, i === N - 1 ? 1 : 0.94]);
  const local = useTransform(p, [i / N + 0.012, (i + 1) / N - 0.1], [0, 1], { clamp: true });
  return (
    <m.div className="in-winslot" style={{ opacity, scale }}>
      <Scene p={local} />
    </m.div>
  );
}

function TourPinned() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const active = useScrub(p, (v) => Math.min(N - 1, Math.max(0, Math.floor(v * N + 0.0001))));
  const beam = useTransform(p, [0, 1], [0, 1]);
  const reduce = useReducedMotion();
  const jump = (i: number) => {
    const el = ref.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    const dist = el.offsetHeight - window.innerHeight;
    window.scrollTo({ top: top + (i / N) * dist + 4 + (i === 0 ? 0 : dist * 0.02), behavior: reduce ? "auto" : "smooth" });
  };
  return (
    <section ref={ref} id="tour" className="in-tour" style={{ height: `${N * 90 + 100}svh` }} aria-labelledby="in-tour-h">
      <h2 id="in-tour-h" className="sr-only">What Scholar AI does</h2>
      <div className="in-stage">
        <div className="in-stage-in">
          <nav className="in-rail" aria-label="Chapters of the tour">
            <span className="in-rail-line" aria-hidden="true"><m.span style={{ scaleY: beam }} /></span>
            <ol>
              {CHAPTERS.map((c, i) => (
                <li key={c.id}>
                  <button type="button" aria-current={active === i ? "step" : undefined} onClick={() => jump(i)}>
                    <span className="in-rail-dot" aria-hidden="true" />
                    <span className="in-rail-name">{c.kicker}</span>
                  </button>
                </li>
              ))}
            </ol>
          </nav>
          <div className="in-chaps" aria-hidden="true">{CHAPTERS.map((c, i) => <ChapterText key={c.id} i={i} p={p} />)}</div>
          <div className="in-wins" aria-hidden="true">{CHAPTERS.map((c, i) => <ChapterWin key={c.id} i={i} p={p} />)}</div>
        </div>
      </div>
      {/* the same four chapters as plain text, once, for screen readers (the animated copy above is hidden from them) */}
      <ol className="sr-only">
        {CHAPTERS.map((c) => (
          <li key={c.id}>
            <h3>{c.kicker}: {c.title}</h3>
            <p>{c.body}</p>
            <ul>{c.points.map((t) => <li key={t}>{t}</li>)}</ul>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Phones, reduced motion: every chapter one after another, each scene in its finished state, no pinning. */
function TourStacked() {
  return (
    <section id="tour" className="in-tour-s" aria-labelledby="in-tour-h">
      <div className="in-wrap">
        <h2 id="in-tour-h" className="in-h2">What Scholar AI <em>does</em></h2>
        {CHAPTERS.map((c) => {
          const Scene = SCENES[c.id];
          return (
            <Reveal key={c.id} as="article" className="in-chap-s">
              <p className="in-kicker">{c.kicker}</p>
              <h3 className="in-chap-h">{c.title}</h3>
              <p className="in-chap-p">{c.body}</p>
              <ul className="in-points">{c.points.map((t) => <li key={t}>{t}</li>)}</ul>
              <div className="in-herowin in-static" role="img" aria-label={`Sample: ${c.kicker}. ${c.points[0]}.`}>
                <div aria-hidden="true"><Scene p={ONE} /></div>
              </div>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- manifesto: words light up as you scroll */
const MANIFESTO = "An AI that sounds sure is not an answer you can cite. So every paper here is a real record, every quote is checked against the paper, every retraction is flagged. And where we cannot be sure, we say so.";

function Word({ w, i, n, p }: { w: string; i: number; n: number; p: MotionValue<number> }) {
  const opacity = useTransform(p, [i / n, Math.min(1, (i + 1.6) / n)], [0, 1], { clamp: true });
  // the faint copy stays in the readable muted colour; the full-colour copy fades in over it, so every moment of the fade is AA
  return (
    <span className="in-mw">
      {w}
      <m.span className="in-mw-fill" style={{ opacity }} aria-hidden="true">{w}</m.span>
    </span>
  );
}

function Manifesto({ stacked }: { stacked: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.85", "end 0.55"] });
  const words = useMemo(() => MANIFESTO.split(" "), []);
  return (
    <section ref={ref} className="in-manifesto" aria-label="What we believe">
      <div className="in-wrap">
        <p className="in-manifesto-p">
          {stacked ? MANIFESTO : words.map((w, i) => <span key={i}><Word w={w} i={i} n={words.length} p={scrollYProgress} />{" "}</span>)}
        </p>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- trust */
function Trust() {
  return (
    <section id="trust" className="in-sec" aria-labelledby="trust-h">
      <div className="in-wrap">
        <Reveal><h2 id="trust-h" className="in-h2">Built so you can <em>check the checker</em>.</h2></Reveal>
        <Reveal delay={0.08}><p className="in-lead">Three rules hold everywhere in the product, and each can be seen at work.</p></Reveal>
        <div className="in-three">
          <Reveal as="article" className="in-card" delay={0.05}>
            <div className="in-vis" aria-hidden="true">
              <span className="in-doi"><svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5" /></svg>10.1016/j.example.2022.01</span>
              <span className="in-doi in-doi-2"><svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5" /></svg>Title and authors agree</span>
            </div>
            <h3>Every paper is a real record</h3>
            <p>Papers come from scholarly indexes, not from a model. Each DOI is checked, and a DOI that does not exist is removed before you can cite it.</p>
          </Reveal>
          <Reveal as="article" className="in-card" delay={0.15}>
            <div className="in-vis" aria-hidden="true">
              <p className="in-vq">Readings agreed with the manual samples (r = 0.92). <mark>The map was used to plan irrigation per strip.</mark></p>
            </div>
            <h3>Every quote is checked</h3>
            <p>The model points at a sentence by number; the sentence shown is copied from the paper. If it is not in the text, it is not shown.</p>
          </Reveal>
          <Reveal as="article" className="in-card" delay={0.25}>
            <div className="in-vis" aria-hidden="true">
              <p className="in-retr"><TriangleIcon />Retracted: do not rely on this result</p>
            </div>
            <h3>Retractions are never missed</h3>
            <p>Retraction notices are checked for every paper listed, and a retracted paper wears a red banner everywhere it appears.</p>
          </Reveal>
        </div>
        <Reveal><p className="in-honest-card"><strong>Honest about its limits.</strong> &ldquo;Not found&rdquo; does not mean &ldquo;made up&rdquo;: books, theses and regional-language journals are often not indexed, and the product says so. Idea Check never says an idea is new or not new. It shows you what is there, and you decide.</p></Reveal>
      </div>
    </section>
  );
}
const TriangleIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
);

/* ---------------------------------------------------------------- Hinglish (only once the product does it) */
function Hinglish() {
  return (
    <section id="hinglish" className="in-sec" aria-labelledby="hing-h">
      <div className="in-wrap in-two">
        <div>
          <Reveal><h2 id="hing-h" className="in-h2">Ask the way <em>you think</em>.</h2></Reveal>
          <Reveal delay={0.08}><p className="in-lead">English, Hindi or Hinglish: write it the way you would say it to a colleague. Scholar AI works out what you want, shows you what it understood, and replies in your language.</p></Reveal>
          <Reveal delay={0.16}><ul className="in-pills"><li>English</li><li lang="hi">हिन्दी</li><li>Hinglish</li><li>Scanned pages</li></ul></Reveal>
        </div>
        <div className="in-chatpair" aria-label="Example exchange">
          <Reveal className="in-you">Mere thesis ke references check kar do, kuch galat toh nahi?</Reveal>
          <Reveal delay={0.25}>
            <p className="in-understood-s">I understood this as <strong>Check references</strong></p>
            <p className="in-bot" lang="hi-Latn">Aapki list mein 38 references hain. 33 mil gaye, 3 mein saal ya author ka mismatch hai, aur 2 kisi database mein nahi mile. Inme se ek paper retract ho chuka hai.</p>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- privacy and the end */
function Privacy({ onStart }: { onStart: () => void }) {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], ["-8%", "10%"]);
  return (
    <section id="privacy" ref={ref} className="in-sec" aria-labelledby="priv-h">
      <div className="in-wrap">
        <Reveal><h2 id="priv-h" className="in-h2">Your work stays <em>yours</em>.</h2></Reveal>
        <Reveal delay={0.08}><p className="in-lead">An unpublished idea is the most sensitive thing a researcher has. The product is built around that.</p></Reveal>
        <div className="in-three">
          {[
            { Icon: Lock, t: "Private to your account", b: "Your papers, notes and questions are visible to nobody else, and the admin page shows numbers only." },
            { Icon: Share2, t: "Only an approved search leaves", b: "For an idea, you see and edit the search first. Only that search, never your text or file, goes to the scholarly indexes." },
            { Icon: Trash2, t: "Delete all of it, any time", b: "Export everything as one file, or delete your account and your papers in a click." },
          ].map(({ Icon, t, b }, i) => (
            <Reveal key={t} as="article" className="in-card in-card-s" delay={0.05 + i * 0.1}>
              <span className="in-ico"><Icon size={18} aria-hidden="true" /></span>
              <h3>{t}</h3>
              <p>{b}</p>
            </Reveal>
          ))}
        </div>
        <Reveal className="in-final">
          <m.div className="in-final-glow" style={{ y }} aria-hidden="true" />
          <h2 className="in-h2">Start with <em>one question</em>.</h2>
          <p>Sign in and ask. Every line of the answer can be checked.</p>
          <Cta onStart={onStart} />
        </Reveal>
      </div>
    </section>
  );
}

export default function IntroPage({ onStart }: { onStart: () => void }) {
  const small = useMediaQuery("(max-width: 900px)");
  const reduce = useReducedMotion();
  const stacked = small || !!reduce;
  return (
    <div className="intro">
      <a className="skip-link" href="#in-h1">Skip to the page</a>
      <Header onTop={() => window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" })} />
      <main id="main">
        <Hero onStart={onStart} stacked={stacked} />
        {stacked ? <TourStacked /> : <TourPinned />}
        <Manifesto stacked={stacked} />
        <Trust />
        {FEATURES.hinglish && <Hinglish />}
        <Privacy onStart={onStart} />
      </main>
      <Footer />
    </div>
  );
}

