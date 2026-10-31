import { m, useReducedMotion, useScroll, useSpring } from "motion/react";
import { ArrowRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Logo } from "../../components/Logo";
import { Footer } from "../../components/Footer";
import { ProviderButtons } from "../../components/ProviderButtons";
import { SignInDialog } from "../../components/SignInDialog";
import { ThemeSwitch } from "../../components/ThemeSwitch";
import { useAuth } from "../../lib/auth";
import { useMediaQuery } from "../../lib/media";
import { getThemePref, useThemePref } from "../../lib/prefs";
import { Film } from "./Film";
import "../../styles/intro.css";

/* ====================================================================================================================
 * The intro page for people who are not signed in: a short film in nine scenes (docs/design/cinematic-story.md). Native scrolling only; on a phone or with reduced
 * motion the same page is stacked at its finished state. The header, the sign-in and the theme switch are the app's own.
 * ==================================================================================================================== */

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
        <button type="button" className="logo-btn" onClick={onTop} aria-label="Sodhsetu, back to the top">
          <Logo />
        </button>
        <nav className="in-links" aria-label="On this page">
          <a href="#film-question" onClick={jump("film-question")}>What it does</a>
          <a href="#film-workspace" onClick={jump("film-workspace")}>Your papers</a>
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

/**
 * The film was made for the dark theme: a visitor who has not chosen a theme ("Auto") sees it dark; one who chose Light or Read sees it in that theme. Leaving the page puts
 * "Auto" back as it was.
 */
function useFilmTheme() {
  const pref = useThemePref();
  useEffect(() => {
    if (pref !== "auto") return;
    const root = document.documentElement;
    root.setAttribute("data-theme", "dark");
    // a choice made on this page (Light, Dark, Read) has already set its theme: only "Auto" is given back
    return () => {
      if (getThemePref() === "auto") root.removeAttribute("data-theme");
    };
  }, [pref]);
}

export default function IntroPage({ onStart }: { onStart: () => void }) {
  const small = useMediaQuery("(max-width: 900px)");
  const reduce = useReducedMotion();
  const animated = !small && !reduce;
  const tc = useRef<HTMLParagraphElement>(null);
  useFilmTheme();
  return (
    <div className="intro">
      <a className="skip-link" href="#film-end">Skip the film</a>
      <Header onTop={() => window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" })} />
      <main id="main">
        <Film
          animated={animated}
          cta={<Cta onStart={onStart} />}
          onTimecode={(_i, text, lb) => {
            if (!tc.current) return;
            tc.current.textContent = text;
            tc.current.style.opacity = String(lb);
          }}
        />
      </main>
      {animated && <p className="fm-tc" ref={tc} aria-hidden="true" />}
      <Footer />
    </div>
  );
}
