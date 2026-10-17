import { useEffect, useState } from "react";
import type { HealthResponse, Theme } from "@scholar/shared";

const THEMES: { id: Theme; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "read", label: "Read" },
];

function currentTheme(): Theme | null {
  const t = document.documentElement.getAttribute("data-theme");
  return t === "light" || t === "dark" || t === "read" ? t : null;
}

function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme | null>(currentTheme);

  const choose = (t: Theme) => {
    document.documentElement.setAttribute("data-theme", t);
    try {
      localStorage.setItem("theme", t);
    } catch {
      /* private mode: theme sirf is session ke liye */
    }
    setTheme(t);
  };

  return (
    <div className="theme-switch" role="group" aria-label="Theme">
      {THEMES.map((t) => (
        <button key={t.id} type="button" aria-pressed={theme === t.id} onClick={() => choose(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

type State =
  | { kind: "loading" }
  | { kind: "ok"; data: HealthResponse }
  | { kind: "error"; message: string };

function ApiStatus() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/v1/health", { signal: ctrl.signal })
      .then(async (r) => {
        const data = (await r.json()) as HealthResponse;
        setState(r.ok ? { kind: "ok", data } : { kind: "error", message: `API ne ${r.status} diya` });
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        setState({ kind: "error", message: e instanceof Error ? e.message : "Network error" });
      });
    return () => ctrl.abort();
  }, []);

  if (state.kind === "loading") {
    return (
      <p className="status" data-state="loading" role="status">
        API check ho rahi hai…
      </p>
    );
  }
  if (state.kind === "error") {
    return (
      <p className="status" data-state="error" role="alert">
        ✖ API nahi mili: {state.message}
      </p>
    );
  }
  return (
    <p className="status" data-state="ok" role="status">
      ✔ API OK · DB {state.data.db} · <code>{state.data.time}</code>
    </p>
  );
}

export function App() {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className="shell">
        <header className="topbar">
          <span className="brand">Scholar</span>
          <ThemeSwitch />
        </header>
        <main id="main">
          <section className="card" aria-labelledby="status-h">
            <h1 id="status-h" style={{ marginTop: 0, fontSize: "1.25rem" }}>
              Walking skeleton
            </h1>
            <ApiStatus />
          </section>
          <section className="card reading" aria-label="Typography preview">
            <p style={{ marginTop: 0 }}>
              Verified citations, grounded paper Q&amp;A, aur reference checks. Ye paragraph reading font (Source
              Serif 4) ka preview hai; Read theme mein ise sepia background par dekho.
            </p>
            <p style={{ marginBottom: 0 }}>हिंदी पाठ का नमूना · ଓଡ଼ିଆ ପାଠ୍ୟର ନମୁନା</p>
          </section>
        </main>
      </div>
    </>
  );
}
