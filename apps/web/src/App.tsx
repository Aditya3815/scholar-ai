import { AnimatePresence, LazyMotion, MotionConfig, m } from "motion/react";
import { SearchX, WifiOff } from "lucide-react";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccountMenu } from "./components/AccountMenu";
import { Hero } from "./components/Hero";
import { LibraryDrawer } from "./components/LibraryDrawer";
import { PaperPreview } from "./components/PaperPreview";
import { Logo } from "./components/Logo";
import { ReadingControls } from "./components/ReadingControls";
import { ResultCard, SkeletonCard } from "./components/ResultCard";
import { SearchBox } from "./components/SearchBox";
import { SourceStatus } from "./components/SourceStatus";
import { ThemeSwitch } from "./components/ThemeSwitch";
import { TopNav, type View } from "./components/TopNav";
import { VerifyPage } from "./components/verify/VerifyPage";
import { DocWorkspace } from "./components/papers/DocWorkspace";
import { PapersPage } from "./components/papers/PapersPage";
import { IdeaPage } from "./components/idea/IdeaPage";
import { AdminPage } from "./components/admin/AdminPage";
import { HowWeVerifyPage, PrivacyPage, TermsPage } from "./components/legal/LegalPages";
import { Footer } from "./components/Footer";
import { takeAuthError, useAuth } from "./lib/auth";
import { easeOut } from "./lib/motion";
import { clearNotice, showNotice, useNotice } from "./lib/notice";
import { openPreview } from "./lib/preview";
import { useSearch } from "./lib/search";
import { PAPERS_NAME, WORKSPACE } from "./lib/workspace";
import { Shell } from "./workspace/Shell";
import { HomePage } from "./workspace/HomePage";
import { LibraryPage, SettingsPage } from "./workspace/Pages";

// the intro page is its own chunk: people who are signed in never download it
const loadIntro = () => import("./workspace/intro/IntroPage");
const IntroPage = lazy(loadIntro);
// Someone who has never signed in on this browser is probably about to see the intro page: ask for its chunk now, in parallel with the "who am I" request, not after it.
if (WORKSPACE && typeof localStorage !== "undefined" && !(() => { try { return localStorage.getItem("scholar.signedin") === "1"; } catch { return false; } })()) void loadIntro();

const loadFeatures = () => import("./lib/motion-features").then((mod) => mod.default);

type Sort = "relevance" | "citations" | "year";

type Route = { view: View; docId: string | null; /** /home: the home screen for people who are not signed in (the new look only) */ home?: boolean };
/** Real URLs for every page: / (search), /verify, /idea, /papers and /papers/<id>. No router library for five pages. */
const routeFromPath = (): Route => {
  const p = location.pathname.replace(/\/+$/, "");
  if (p === "/verify") return { view: "verify", docId: null };
  if (p === "/idea") return { view: "idea", docId: null };
  if (p === "/admin") return { view: "admin", docId: null };
  if (p === "/privacy") return { view: "privacy", docId: null };
  if (p === "/terms") return { view: "terms", docId: null };
  if (p === "/how-we-verify") return { view: "how", docId: null };
  if (WORKSPACE && p === "/library") return { view: "library", docId: null };
  if (WORKSPACE && p === "/settings") return { view: "settings", docId: null };
  if (WORKSPACE && p === "/home") return { view: "search", docId: null, home: true };
  const m = /^\/papers(?:\/([a-f0-9]{8,40}))?$/.exec(p);
  if (m) return { view: "papers", docId: m[1] ?? null };
  return { view: "search", docId: null };
};
const TITLES: Record<View, string> = { search: "Scholar AI", verify: "Verify references · Scholar AI", papers: `${PAPERS_NAME} · Scholar AI`, idea: "Idea Check · Scholar AI", admin: "Admin · Scholar AI", privacy: "Privacy · Scholar AI", terms: "Terms · Scholar AI", how: "How we verify · Scholar AI", library: "Library · Scholar AI", settings: "Settings · Scholar AI" };

export function App() {
  const { state, run, reset } = useSearch();
  const [query, setQuery] = useState(() => new URLSearchParams(location.search).get("q") ?? "");
  const [openOnly, setOpenOnly] = useState(false);
  const [hideRetracted, setHideRetracted] = useState(false);
  const [sort, setSort] = useState<Sort>("relevance");
  const notice = useNotice();
  const [route, setRoute] = useState<Route>(routeFromPath);
  const view = route.view;
  const inputRef = useRef<HTMLInputElement>(null);
  const homeRef = useRef<HTMLTextAreaElement>(null);
  const { user, status: authStatus } = useAuth();

  // Real URLs (/ and /verify) with back/forward support; no router library for two pages.
  useEffect(() => {
    const onPop = () => setRoute(routeFromPath());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    document.title = WORKSPACE && view === "search" && !user && !route.home && state.status === "idle" ? "Scholar AI: research you can trust" : TITLES[view];
  }, [view, user, route.home, state.status]);
  useEffect(() => {
    if (view === "papers") window.scrollTo(0, 0);
  }, [view, route.docId]);

  const navigate = useCallback(
    (next: View, docId: string | null = null) => {
      if (next === view && docId === route.docId) return;
      const path = next === "verify" ? "/verify" : next === "idea" ? "/idea" : next === "library" ? "/library" : next === "settings" ? "/settings" : next === "papers" ? (docId ? `/papers/${docId}` : "/papers") : state.status === "idle" ? "/" : `/?q=${encodeURIComponent(query)}`;
      history.pushState(null, "", path);
      setRoute({ view: next, docId });
      window.scrollTo(0, 0);
    },
    [view, route.docId, state.status, query],
  );

  // ?auth_error=... left by the server redirect becomes a dismissible banner
  useEffect(() => {
    const message = takeAuthError();
    if (message) showNotice(message);
  }, []);

  const submit = useCallback(
    (q: string) => {
      const clean = q.trim();
      if (clean.length < 2) return;
      setQuery(clean);
      history.replaceState(null, "", `?q=${encodeURIComponent(clean)}`);
      run(clean);
    },
    [run],
  );

  // Shareable link: ?q=... se load hone par search chalao
  useEffect(() => {
    const q = new URLSearchParams(location.search).get("q");
    if (q && routeFromPath().view === "search") submit(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "/" se search focus (jab kisi input mein na ho)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && t?.tagName !== "INPUT" && t?.tagName !== "TEXTAREA") {
        e.preventDefault();
        (inputRef.current ?? homeRef.current)?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const results = useMemo(() => {
    let r = state.results;
    if (openOnly) r = r.filter((p) => p.oaUrl);
    if (hideRetracted) r = r.filter((p) => !p.retracted);
    if (sort === "citations") r = [...r].sort((a, b) => (b.citationCount ?? -1) - (a.citationCount ?? -1));
    if (sort === "year") r = [...r].sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
    return r;
  }, [state.results, openOnly, hideRetracted, sort]);

  const idle = state.status === "idle";
  const loading = state.status === "loading";
  const allFailed = state.status === "done" && state.results.length === 0 && Object.values(state.providers).every((p) => !p.ok);
  const empty = state.status === "done" && state.results.length === 0 && !allFailed;
  const filteredOut = state.results.length > 0 && results.length === 0;

  const goHome = () => {
    reset();
    setQuery("");
    // the new look: signed-in people land on the home screen at "/", anonymous people on "/home" (the intro page is "/" for them)
    const homePath = WORKSPACE && !user ? "/home" : "/";
    if (view !== "search" || (WORKSPACE && location.pathname !== homePath)) {
      history.pushState(null, "", homePath);
      setRoute({ view: "search", docId: null, home: homePath === "/home" });
    } else {
      history.replaceState(null, "", location.pathname);
    }
    window.setTimeout(() => (inputRef.current ?? homeRef.current)?.focus(), 0);
  };
  /** The intro page's "Try it without signing in". */
  const startAnonymous = () => {
    history.pushState(null, "", "/home");
    setRoute({ view: "search", docId: null, home: true });
    window.scrollTo(0, 0);
  };

  const noticeEl = (
    <AnimatePresence>
      {notice && (
        <m.div className="notice" role="alert" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.25, ease: easeOut }}>
          <span>{notice}</span>
          <button type="button" className="link-btn" onClick={clearNotice}>Dismiss</button>
        </m.div>
      )}
    </AnimatePresence>
  );
  const mainEl = (
    <main id="main" className="main" data-view={view === "papers" && route.docId ? "paper" : view}>
      {view === "verify" ? (
        <VerifyPage />
      ) : view === "privacy" ? (
        <PrivacyPage />
      ) : view === "terms" ? (
        <TermsPage />
      ) : view === "how" ? (
        <HowWeVerifyPage />
      ) : view === "admin" ? (
        <AdminPage />
      ) : view === "idea" ? (
        <IdeaPage />
      ) : view === "library" ? (
        <LibraryPage />
      ) : view === "settings" ? (
        <SettingsPage />
      ) : view === "papers" ? (
        route.docId ? <DocWorkspace key={route.docId} id={route.docId} onBack={() => navigate("papers")} /> : <PapersPage onOpen={(id) => navigate("papers", id)} />
      ) : (
      <AnimatePresence mode="wait" initial={false}>
        {idle ? (
          <m.div key="home" exit={{ opacity: 0, y: -12, transition: { duration: 0.18 } }}>
            {WORKSPACE ? (
              <HomePage query={query} onQuery={setQuery} onSearch={submit} onOpenTool={(tool) => navigate(tool === "papers" ? "papers" : tool)} inputRef={homeRef} />
            ) : (
            <Hero value={query} onChange={setQuery} onSubmit={() => submit(query)} onPick={submit} onVerify={() => navigate("verify")} onPapers={() => navigate("papers")} onIdea={() => navigate("idea")} inputRef={inputRef} />
            )}
          </m.div>
        ) : (
          <m.div key="results" className="results-view" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: easeOut }}>
            <div className="results-head">
              <SearchBox value={query} onChange={setQuery} onSubmit={() => submit(query)} inputRef={inputRef} size="compact" busy={loading} />
              <SourceStatus state={state} />
              {state.results.length > 0 && (
                <div className="filters" role="group" aria-label="Filters">
                  <button type="button" className="chip-btn" aria-pressed={openOnly} onClick={() => setOpenOnly((v) => !v)}>Open access only</button>
                  <button type="button" className="chip-btn" aria-pressed={hideRetracted} onClick={() => setHideRetracted((v) => !v)}>Hide retracted</button>
                  <label className="select-wrap">
                    <span className="sr-only">Sort by</span>
                    <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort by">
                      <option value="relevance">Sort: Relevance</option>
                      <option value="citations">Sort: Citations</option>
                      <option value="year">Sort: Newest</option>
                    </select>
                  </label>
                </div>
              )}
            </div>

            <ul className="results" aria-busy={loading} aria-label="Search results">
              {loading && state.results.length === 0 && [0, 1, 2, 3].map((i) => <SkeletonCard key={i} />)}
              <AnimatePresence initial>
                {results.map((p, i) => (
                  <ResultCard key={p.id} paper={p} index={i} onPreview={(paper) => openPreview(paper, results)} />
                ))}
              </AnimatePresence>
            </ul>

            {state.status === "error" && (
              <div className="empty" role="alert">
                <WifiOff size={28} aria-hidden="true" />
                <p className="empty-title">We could not reach the search service</p>
                <p>{state.error}. Check your connection and try again.</p>
                <button type="button" className="btn btn-primary" onClick={() => submit(query)}>Try again</button>
              </div>
            )}
            {allFailed && (
              <div className="empty" role="alert">
                <WifiOff size={28} aria-hidden="true" />
                <p className="empty-title">All sources are unavailable right now</p>
                <p>This is usually temporary. Please try again in a minute.</p>
                <button type="button" className="btn btn-primary" onClick={() => submit(query)}>Try again</button>
              </div>
            )}
            {empty && (
              <div className="empty">
                <SearchX size={28} aria-hidden="true" />
                <p className="empty-title">No papers found for “{state.query}”</p>
                <p>Try fewer or broader keywords, or search by the paper's DOI.</p>
              </div>
            )}
            {filteredOut && (
              <div className="empty">
                <p className="empty-title">No results match these filters</p>
                <button type="button" className="btn btn-ghost" onClick={() => { setOpenOnly(false); setHideRetracted(false); }}>Clear filters</button>
              </div>
            )}
          </m.div>
        )}
      </AnimatePresence>
      )}
    </main>
  );

  // the new look: people who are not signed in see the intro page at "/"; everyone else gets the rail and the home screen
  const onIntro = WORKSPACE && view === "search" && idle && !route.home && !user;
  const booting = onIntro && authStatus === "loading";

  if (WORKSPACE && onIntro) {
    return (
      <MotionConfig reducedMotion="user">
        <LazyMotion features={loadFeatures} strict={false}>
          {noticeEl}
          {booting ? null : (
            <Suspense fallback={null}>
              <IntroPage onStart={startAnonymous} />
            </Suspense>
          )}
          <PaperPreview />
        </LazyMotion>
      </MotionConfig>
    );
  }
  if (WORKSPACE) {
    return (
      <MotionConfig reducedMotion="user">
        <LazyMotion features={loadFeatures} strict={false}>
          <Shell view={view === "search" ? "home" : view} onNavigate={navigate} onHome={goHome} title={view === "search" && idle ? "Home" : TITLES[view].replace(" · Scholar AI", "")} focus={view === "papers" && !!route.docId} footer={view === "papers" ? null : <Footer />}>
            {noticeEl}
            {mainEl}
          </Shell>
          <PaperPreview />
        </LazyMotion>
      </MotionConfig>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <LazyMotion features={loadFeatures} strict={false}>
        <a className="skip-link" href="#main">Skip to content</a>

        <header className={`topbar ${idle && view === "search" ? "" : "topbar-solid"}`}>
          <div className="topbar-inner">
            <button type="button" className="logo-btn" onClick={goHome} aria-label="Scholar AI, home">
              <Logo />
            </button>
            <TopNav view={view} onNavigate={navigate} />
            <div className="topbar-actions">
              <ReadingControls />
              <ThemeSwitch />
              <LibraryDrawer />
              <AccountMenu />
            </div>
          </div>
        </header>

        {noticeEl}

        {mainEl}

        <Footer />
        <PaperPreview />
      </LazyMotion>
    </MotionConfig>
  );
}
