import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource-variable/source-serif-4/opsz.css";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "@fontsource/noto-sans-devanagari/400.css";
import "@fontsource/noto-sans-oriya/400.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/app.css";
import "./styles/verify.css";
import "./styles/papers.css";
import "./styles/workspace.css";
import "./styles/idea.css";
import "./styles/admin.css";
import { initPrefs } from "./lib/prefs";
import { App } from "./App";

initPrefs();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
