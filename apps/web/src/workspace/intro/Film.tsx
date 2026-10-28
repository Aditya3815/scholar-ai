import { ArrowRight, FileText, Landmark, Lock, Share2, Trash2 } from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { clamp, inOut, out, seg, setVar, useFilm, type Updater } from "./engine";

/* ====================================================================================================================
 * The intro as a short film (docs/design/cinematic-story.md; approved as the mock docs/design/poc/scroll-v3.html, 28 Oct 2026). Nine scenes, each one claim. Every
 * example is labelled sample data; the two counts of chapter V are real (OpenAlex and DOAJ, 27-28 Oct 2026). The animated copy is decoration: each scene says what it shows in
 * plain text for screen readers, and the stacked layout (phones, reduced motion) is the same page at its finished state.
 * ==================================================================================================================== */

const SHODHGANGA_THESES = 117635;
const DOAJ_INDIA_ARTICLES = 309564;
const fmt = new Intl.NumberFormat("en-IN");

export const SCENE_TITLES = ["Cold open", "Title", "I · The question", "II · The answer", "III · The proof", "IV · The fake", "V · Close to home", "VI · Your own papers", "The end"] as const;

const OPEN: string[][] = [["An", "AI", "can", "write", "a", "perfect", "reference"], ["to", "a", "paper"], ["that", "was", "*never", "*written."]];

const PAPERS: [string, string, boolean][] = [
  ["2019", "Yoga as an adjunct treatment for hypertension: a meta-analysis", false],
  ["2021", "Breathing exercises and blood pressure in older adults", false],
  ["2018", "Effect of yoga on ambulatory blood pressure: a randomised trial", false],
  ["2017", "A retracted study of yoga and hypertension", true],
  ["2022", "Mind-body practice for stage 1 hypertension in primary care", false],
  ["2020", "Isometric and aerobic exercise compared for resting blood pressure", false],
  ["2016", "Pranayama and autonomic function: a controlled study", false],
  ["2023", "Yoga in community health programmes in India: a cluster trial", false],
  ["2015", "Lifestyle change for blood pressure: a systematic review", false],
  ["2021", "Tai chi and blood pressure: a meta-analysis", false],
  ["2019", "Adherence to home yoga practice in hypertensive patients", false],
  ["2024", "Meditation and arterial stiffness: a randomised trial", false],
];

const Chapter = ({ children }: { children: ReactNode }) => <p className="fm-chapter">{children}</p>;
const Sample = ({ children = "Sample data" }: { children?: ReactNode }) => <span className="fm-sample">{children}</span>;

function Scene({ id, i, bars = true, children, label }: { id: string; i: number; bars?: boolean; children: ReactNode; label: string }) {
  return (
    <section className={`fm-scene fm-s-${id}`} id={`film-${id}`} data-scene={id} data-i={i} data-bars={bars ? "1" : "0"} aria-labelledby={label}>
      <div className="fm-frame">{children}</div>
    </section>
  );
}

/* ---------------------------------------------------------------- the dust of the invented reference (scene IV) */
type Dot = { x: number; y: number; vx: number; vy: number; d: number };
function makeDust(ref: HTMLElement, canvas: HTMLCanvasElement) {
  let dots: Dot[] = [];
  let w = 0;
  let h = 0;
  let dpr = 1;
  let ink = "#fff";
  let ash = "#f88";
  let theme: string | null = "?";
  const STEP = 3;
  const R = STEP * 0.38;
  const ctx = canvas.getContext("2d");
  /** The dots take the theme's own colours, read again whenever the theme changes (they were read once, in the dark theme, and were white on the light page). */
  const colours = () => {
    const now = document.documentElement.getAttribute("data-theme");
    if (now === theme) return;
    theme = now;
    const cs = getComputedStyle(document.documentElement);
    ink = cs.getPropertyValue("--text").trim() || ink;
    ash = cs.getPropertyValue("--danger").trim() || ash;
  };
  return {
    /** The reference's own letters, drawn once into a hidden canvas and kept as dots on a regular grid: a dot wherever its cell is mostly ink, so no letter breaks up. */
    sample() {
      if (!ctx) return;
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = Math.round(r.width);
      h = Math.round(r.height);
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      theme = "?";
      colours();
      const off = document.createElement("canvas");
      off.width = w;
      off.height = h;
      const o = off.getContext("2d");
      if (!o || !w || !h) return;
      for (const ln of ref.querySelectorAll<HTMLElement>(".fm-ln")) {
        const walker = document.createTreeWalker(ln, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const range = document.createRange();
          range.selectNodeContents(node);
          const rr = range.getClientRects()[0];
          if (!rr) continue;
          const st = getComputedStyle(node.parentElement!);
          o.font = `${st.fontStyle} ${st.fontWeight} ${st.fontSize} ${st.fontFamily}`;
          o.fillText(node.textContent ?? "", rr.left - r.left, rr.top - r.top + rr.height * 0.78);
        }
      }
      const data = o.getImageData(0, 0, w, h).data;
      dots = [];
      for (let y = 0; y + STEP <= h; y += STEP)
        for (let x = 0; x + STEP <= w; x += STEP) {
          let ink = 0;
          for (let j = 0; j < STEP; j++) for (let i = 0; i < STEP; i++) ink += data[((y + j) * w + x + i) * 4 + 3]!;
          if (ink / (STEP * STEP * 255) > 0.3) {
            const a = Math.random() * Math.PI * 2;
            const s = 30 + Math.random() * 200;
            const cx = x + STEP / 2;
            dots.push({ x: cx, y: y + STEP / 2, vx: Math.cos(a) * s + 140, vy: Math.sin(a) * s * 0.7 - 70 - Math.random() * 90, d: (cx / w) * 0.45 + Math.random() * 0.12 });
          }
        }
    },
    /**
     * t 0..1, in two movements. First (t < 0.22) the letters turn into dots: a wave from left to right, each dot growing into place while the text fades under it. Then the dots
     * leave, left first, drifting right and up like ash. Dots of the same colour and strength are drawn as one path.
     */
    draw(t: number) {
      if (!ctx) return;
      colours();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (t <= 0 || t >= 1) return;
      const a = clamp(t / 0.22);
      const tt = clamp((t - 0.22) / 0.78);
      const paths = new Map<string, Path2D>();
      const dot = (colour: string, alpha: number, x: number, y: number, rad: number) => {
        if (alpha < 0.04) return;
        const key = `${colour}|${Math.min(8, Math.round(alpha * 8))}`;
        let path = paths.get(key);
        if (!path) paths.set(key, (path = new Path2D()));
        path.moveTo(x + rad, y);
        path.arc(x, y, rad, 0, Math.PI * 2);
      };
      for (const q of dots) {
        const appear = clamp(a * 1.6 - (q.x / w) * 0.6);
        const k = clamp((tt - q.d) / 0.55);
        if (k <= 0) dot(ink, appear, q.x, q.y, R * (0.45 + 0.55 * appear));
        else {
          const e = out(k);
          dot(k < 0.15 ? ink : ash, appear * (1 - k), q.x + q.vx * e, q.y + q.vy * e, R * (1 + 0.3 * k));
        }
      }
      for (const [key, path] of paths) {
        const [colour, strength] = key.split("|");
        ctx.globalAlpha = Number(strength) / 8;
        ctx.fillStyle = colour!;
        ctx.fill(path);
      }
      ctx.globalAlpha = 1;
    },
  };
}

/* ---------------------------------------------------------------- the film */

export function Film({ animated, cta, onTimecode }: { animated: boolean; cta: ReactNode; onTimecode?: (scene: number, text: string, lb: number) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const words = useMemo(() => OPEN.flatMap((line) => line.length), []).reduce((a, b) => a + b, 0);

  // geometry measured on start, after fonts and on resize
  const geo = useRef({ cx: 0, cy: 0, r0: 10, r1: 2000, ox: 0, oy: 0 });
  const dust = useRef<ReturnType<typeof makeDust> | null>(null);

  const updaters = useMemo<Record<string, Updater>>(() => {
    const all = <T extends Element>(el: HTMLElement, q: string) => [...el.querySelectorAll<T & HTMLElement>(q)];
    return {
      open(el, p) {
        // one word for an equal stretch of scroll, as if read aloud; a word is lit or an outline, never half way (a half-lit word failed contrast in the read theme), and the
        // first two are lit when the page opens
        setVar(el, "--k", Math.floor(2 + seg(p, 0.04, 0.7) * (words - 1)));
        setVar(el, "--after", out(seg(p, 0.7, 0.86)));
      },
      title(el, p) {
        const t = out(seg(p, 0, 0.55));
        setVar(el, "--ts", 3.2 - 2.2 * t);
        setVar(el, "--tb", (1 - t) * 6);
        setVar(el, "--mk", out(seg(p, 0.3, 0.6)));
        setVar(el, "--tl", out(seg(p, 0.55, 0.72)));
        setVar(el, "--tc", out(seg(p, 0.66, 0.82)));
      },
      question(el, p) {
        // the shot, in five beats: the box arrives; the question is typed (a caret runs ahead of it); the send (the button pressed, a ring leaves it, a flash of light behind
        // the box, the camera leans in); a held pause while the sources are asked (the box glows, a beam runs along it, the status moves through its three steps); then the papers
        setVar(el, "--box", out(seg(p, 0, 0.08)));
        setVar(el, "--type", seg(p, 0.08, 0.21));
        setVar(el, "--caret", p < 0.24 ? 1 : 0);
        setVar(el, "--press", Math.sin(seg(p, 0.23, 0.27) * Math.PI));
        setVar(el, "--rip", seg(p, 0.24, 0.33));
        setVar(el, "--bloom", Math.sin(seg(p, 0.24, 0.34) * Math.PI));
        setVar(el, "--lean", inOut(seg(p, 0.24, 0.3)) * (1 - inOut(seg(p, 0.5, 0.56))));
        setVar(el, "--glow", seg(p, 0.25, 0.3) * (1 - seg(p, 0.52, 0.58)));
        const beam = seg(p, 0.27, 0.53);
        setVar(el, "--beam", (beam * 3) % 1);
        setVar(el, "--beamv", beam > 0 && beam < 1 ? 1 : 0);
        const status = el.querySelector<HTMLElement>(".fm-qstatus");
        if (status) {
          const text = p < 0.27 || p > 0.62 ? "" : p < 0.36 ? "Searching four sources…" : p < 0.45 ? "Reading 20 records…" : "Checking every DOI and retraction…";
          if (status.textContent !== text) status.textContent = text;
        }
        all<HTMLElement>(el, ".fm-paper").forEach((c, i) => setVar(c, "--pt", inOut(seg(p, 0.54 + i * 0.018, 0.68 + i * 0.018))));
        setVar(el, "--st", out(seg(p, 0.84, 0.9)));
        setVar(el, "--cnt", out(seg(p, 0.88, 0.95)));
      },
      answer(el, p) {
        const g = geo.current;
        setVar(el, "--at", out(seg(p, 0, 0.14)));
        setVar(el, "--ring", Math.sin(seg(p, 0.18, 0.3) * Math.PI));
        const open = seg(p, 0.3, 0.56);
        const r = open <= 0 ? 0 : g.r0 + (g.r1 - g.r0) * Math.pow(inOut(open), 1.6);
        for (const x of all<HTMLElement>(el, ".fm-iris, .fm-iris-ring")) {
          setVar(x, "--r", `${r.toFixed(1)}px`);
          setVar(x, "--cx", `${g.cx.toFixed(1)}px`);
          setVar(x, "--cy", `${g.cy.toFixed(1)}px`);
        }
        const layer = el.querySelector<HTMLElement>(".fm-a-layer");
        if (layer) {
          setVar(layer, "--ox", `${g.ox.toFixed(1)}px`);
          setVar(layer, "--oy", `${g.oy.toFixed(1)}px`);
        }
        setVar(el, "--ro", open > 0 && open < 1 ? Math.min(1, open * 6, (1 - open) * 3) : 0);
        setVar(el, "--push", inOut(open));
        setVar(el, "--ab", out(seg(p, 0.42, 0.62)));
        setVar(el, "--hl", out(seg(p, 0.62, 0.8)));
        setVar(el, "--cap", out(seg(p, 0.8, 0.9)));
      },
      proof(el, p) {
        setVar(el, "--rg", inOut(seg(p, 0.08, 0.5)));
        setVar(el, "--rg-done", out(seg(p, 0.48, 0.56)));
        all<HTMLElement>(el, ".fm-check").forEach((c, i) => setVar(c, "--c", out(seg(p, 0.2 + i * 0.16, 0.36 + i * 0.16))));
      },
      fake(el, p) {
        const scan = seg(p, 0.12, 0.36);
        setVar(el, "--sx", scan);
        setVar(el, "--sv", scan > 0 && scan < 1 ? 1 : 0);
        all<HTMLElement>(el, ".fm-lookup").forEach((l, i) => setVar(l, "--lk", out(seg(p, 0.2 + i * 0.07, 0.3 + i * 0.07))));
        const t = seg(p, 0.42, 0.8);
        // the text fades as its dots grow over it; once it is all dots the card becomes the empty, dashed frame
        setVar(el, "--lnop", 1 - clamp(t / 0.22));
        el.querySelector(".fm-ref")?.classList.toggle("is-gone", t >= 0.22);
        dust.current?.draw(t);
        setVar(el, "--vd", out(seg(p, 0.72, 0.86)));
      },
      india(el, p) {
        setVar(el, "--dv", out(seg(p, 0, 0.3)));
        setVar(el, "--nv", out(seg(p, 0.08, 0.2)));
        const c = out(seg(p, 0.1, 0.5));
        for (const n of all<HTMLElement>(el, "[data-count]")) n.textContent = fmt.format(Math.round(Number(n.dataset.count) * c));
        all<HTMLElement>(el, ".fm-bubble").forEach((b, i) => setVar(b, "--bv", out(seg(p, 0.5 + i * 0.16, 0.62 + i * 0.16))));
      },
      workspace(el, p) {
        setVar(el, "--fd", out(seg(p, 0, 0.1)));
        setVar(el, "--po", out(seg(p, 0.06, 0.18)));
        setVar(el, "--hw", out(seg(p, 0.18, 0.32)));
        setVar(el, "--ink", inOut(seg(p, 0.28, 0.42)));
        setVar(el, "--wq", out(seg(p, 0.42, 0.52)));
        setVar(el, "--wa", out(seg(p, 0.52, 0.62)));
        setVar(el, "--pp", Math.sin(seg(p, 0.6, 0.7) * Math.PI));
        setVar(el, "--fl", inOut(seg(p, 0.64, 0.78)));
        setVar(el, "--qw", out(seg(p, 0.78, 0.88)));
        all<HTMLElement>(el, ".fm-feats li").forEach((x, i) => setVar(x, "--wf", out(seg(p, 0.82 + i * 0.025, 0.9 + i * 0.025))));
      },
      end(el, p) {
        setVar(el, "--dw", out(seg(p, 0, 0.6)));
        setVar(el, "--ev", out(seg(p, 0.1, 0.35)));
        setVar(el, "--cr", seg(p, 0.3, 1));
      },
    };
  }, [words]);

  useFilm(root, animated, updaters, {
    measure() {
      const el = root.current;
      if (!el) return;
      const frame = el.querySelector<HTMLElement>(".fm-s-answer .fm-frame");
      const chip = el.querySelector<HTMLElement>(".fm-zchip");
      const layer = el.querySelector<HTMLElement>(".fm-a-layer");
      if (frame && chip && layer) {
        const f = frame.getBoundingClientRect();
        const c = chip.getBoundingClientRect();
        const l = layer.getBoundingClientRect();
        const push = 1 + Number(getComputedStyle(layer).getPropertyValue("--push") || 0) * 0.14;
        geo.current = {
          cx: c.left + c.width / 2 - f.left,
          cy: c.top + c.height / 2 - f.top,
          r0: Math.max(c.width, c.height) / 2,
          r1: Math.hypot(Math.max(c.left + c.width / 2 - f.left, f.right - c.left - c.width / 2), Math.max(c.top + c.height / 2 - f.top, f.bottom - c.top - c.height / 2)) + 4,
          ox: (c.left + c.width / 2 - l.left) / push,
          oy: (c.top + c.height / 2 - l.top) / push,
        };
      }
      const ref = el.querySelector<HTMLElement>(".fm-ref");
      const canvas = el.querySelector<HTMLCanvasElement>(".fm-dust");
      if (ref && canvas) {
        dust.current ??= makeDust(ref, canvas);
        dust.current.sample();
      }
    },
    onActive: (i) => setActive(Math.max(0, i)),
    onFrame(i, p, page) {
      const s = root.current?.querySelectorAll<HTMLElement>("[data-scene]")[i];
      const bars = s?.dataset.bars === "1" ? out(Math.min(seg(p, 0, 0.06), 1 - seg(p, 0.94, 1))) : 0;
      root.current?.style.setProperty("--lb", bars.toFixed(3));
      for (const b of root.current?.querySelectorAll<HTMLElement>(".fm-strip button") ?? []) setVar(b, "--sp", Number(b.dataset.i) === i ? p : Number(b.dataset.i) < i ? 1 : 0);
      const total = page * 214;
      const two = (n: number) => String(Math.floor(n)).padStart(2, "0");
      onTimecode?.(i, `SC ${i + 1}/9 · 00:${two(total / 60)}:${two(total % 60)}:${two((total % 1) * 24)}`, bars);
    },
  });

  const goTo = (i: number) => {
    const s = root.current?.querySelectorAll<HTMLElement>("[data-scene]")[i];
    if (!s) return;
    const top = s.getBoundingClientRect().top + window.scrollY;
    const span = Math.max(0, s.offsetHeight - window.innerHeight);
    window.scrollTo({ top: top + (animated ? span * 0.5 : 0), behavior: animated ? "smooth" : "auto" });
  };

  let wi = 0;
  return (
    <div ref={root} className="fm" data-mode={animated ? "anim" : "static"}>
      <div className="fm-bars" aria-hidden="true" />
      <div className="fm-vignette" aria-hidden="true" />
      <div className="fm-grain" aria-hidden="true" />

      {/* 1 */}
      <Scene id="open" i={0} bars={false} label="in-h1">
        <div className="fm-center fm-stack">
          <Chapter>A film about citations</Chapter>
          <h1 id="in-h1" className="sr-only">An AI can write a perfect reference to a paper that was never written.</h1>
          <p className="fm-open" aria-hidden="true">
            {OPEN.map((line, li) => (
              <span key={li}>
                {line.map((w) => {
                  const hot = w.startsWith("*");
                  const i = wi++;
                  return (
                    <span key={i}>
                      <span className={`fm-w${hot ? " is-hot" : ""}`} style={{ ["--i" as string]: i }}>{w.replace("*", "")}</span>{" "}
                    </span>
                  );
                })}
                {li < OPEN.length - 1 && <br />}
              </span>
            ))}
          </p>
          <p className="fm-sub fm-after">Scholar AI shows you only papers that exist, and the sentence every claim stands on.</p>
        </div>
      </Scene>

      {/* 2 */}
      <Scene id="title" i={1} label="fm-title-h">
        <div className="fm-halo" aria-hidden="true" />
        <div className="fm-title-wrap">
          <svg className="fm-title-mark" width="60" height="60" viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <path pathLength={1} d="M4 7.5c4-1.6 8-1.4 12 1.2v17c-4-2.6-8-2.8-12-1.2v-17Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
            <path pathLength={1} d="M28 7.5c-4-1.6-8-1.4-12 1.2v17c4-2.6 8-2.8 12-1.2v-17Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
          <h2 id="fm-title-h" className="fm-title-name">Scholar <b>AI</b></h2>
          <p className="fm-title-line">Research, with the receipts.</p>
          <div className="fm-title-cta">{cta}</div>
        </div>
      </Scene>

      {/* 3 */}
      <Scene id="question" i={2} label="fm-q-h">
        <div className="fm-q">
          <Chapter>Chapter I · The question</Chapter>
          <h2 id="fm-q-h" className="sr-only">A question goes in, real papers come back</h2>
          <div className="fm-qshot" aria-hidden="true">
            <span className="fm-bloom" />
            <div className="fm-qbox">
              <span className="fm-typed"><span className="fm-typed-in"><span className="fm-typed-t">Does yoga lower blood pressure?</span><i className="fm-caret" /></span></span>
              <span className="fm-send"><ArrowRight size={18} style={{ transform: "rotate(-90deg)" }} /></span>
              <span className="fm-beam" />
            </div>
          </div>
          <p className="fm-qstatus" aria-hidden="true" />
          <ol className="fm-papers" aria-hidden="true">
            {PAPERS.map(([year, title, bad], i) => {
              const ang = (i * 137.5 * Math.PI) / 180;
              return (
                <li key={i} className={`fm-paper${bad ? " is-bad" : ""}`} style={{ ["--dx" as string]: `${Math.round(Math.cos(ang) * 520)}px`, ["--dy" as string]: `${Math.round(Math.sin(ang) * 300 - 120)}px` }}>
                  <span className="fm-pm"><span>{year}</span><span className="fm-ok">DOI ✓</span></span>
                  <span className="fm-pt">{title}</span>
                  {bad && <span className="fm-stamp">RETRACTED</span>}
                </li>
              );
            })}
          </ol>
          <p className="fm-count" aria-hidden="true"><b>20</b> papers · <b>4</b> sources · every DOI checked · <b className="fm-red">1</b> retracted, marked and never used</p>
          <p className="sr-only">Sample data: the question "Does yoga lower blood pressure?" finds twenty papers from four sources. Each DOI is checked. One paper is retracted: it is marked and never used for the answer.</p>
          <Sample />
        </div>
      </Scene>

      {/* 4 */}
      <Scene id="answer" i={3} label="fm-a-h">
        <div className="fm-a-layer fm-stack">
          <Chapter>Chapter II · The answer</Chapter>
          <h2 id="fm-a-h" className="sr-only">Every claim points at a sentence you can read</h2>
          <p className="fm-a-text">In the trials found, yoga lowered systolic blood pressure by about 5&nbsp;mmHg <span className="fm-chip fm-zchip" aria-label="source 3">3</span></p>
          <p className="fm-a-note">Press the mark. It opens the sentence the claim stands on.</p>
        </div>
        <div className="fm-iris">
          <article className="fm-abs" aria-label="Paper 3, sample">
            <p className="fm-abs-meta"><span className="fm-chip">3</span> 2019 · Journal of Sample Studies · <Sample /></p>
            <h3>Yoga as an adjunct treatment for hypertension: a meta-analysis of randomised trials</h3>
            <p>Forty-nine trials with 3,517 participants were included. <mark>Yoga reduced systolic blood pressure by 5.0 mmHg compared with usual care.</mark> Effects were larger when breathing and meditation were part of the practice. The quality of the evidence was moderate.</p>
            <p className="fm-cap">✓ The sentence, word for word. Not a paraphrase.</p>
          </article>
        </div>
        <span className="fm-iris-ring" aria-hidden="true" />
      </Scene>

      {/* 5 */}
      <Scene id="proof" i={4} label="fm-p-h">
        <div className="fm-stack fm-w">
          <Chapter>Chapter III · The proof</Chapter>
          <h2 id="fm-p-h" className="fm-big fm-big-s">The paper is real. <em>We checked.</em></h2>
          <div className="fm-proof">
            <div className="fm-ring" aria-hidden="true">
              <svg viewBox="0 0 200 200"><circle className="fm-track" cx="100" cy="100" r="92" fill="none" strokeWidth="3" /><circle className="fm-arc" pathLength={1} cx="100" cy="100" r="92" fill="none" strokeWidth="5" /></svg>
              <div><span className="fm-doi">10.5555/sample .2019.003</span><span className="fm-tick">Resolves</span></div>
            </div>
            <ol className="fm-checks">
              {[["Crossref", "the DOI is registered, and its title matches the paper", "Found"], ["doi.org", "the address opens the publisher's page", "Resolves"], ["Retraction Watch", "through Crossref: no retraction notice", "Clear"]].map(([what, how, res], i) => (
                <li key={what} className="fm-check"><span className="fm-n">0{i + 1}</span><span className="fm-what">{what}<small>{how}</small></span><span className="fm-res">{res}</span></li>
              ))}
            </ol>
          </div>
        </div>
      </Scene>

      {/* 6 */}
      <Scene id="fake" i={5} label="fm-f-h">
        <div className="fm-fake">
          <Chapter>Chapter IV · The fake</Chapter>
          <h2 id="fm-f-h" className="sr-only">A reference that does not exist is said so</h2>
          <figure className="fm-ref">
            <span className="fm-ln">Sharma, R. &amp; Gupta, P. (2021). Yogic breathing and</span>
            <span className="fm-ln">hypertension in older adults. <i>Journal of Advanced</i></span>
            <span className="fm-ln"><i>Clinical Medicine</i>, 14(3), 211–219.</span>
            <span className="fm-scan" aria-hidden="true" />
            <span className="fm-void" aria-hidden="true"><span>Nothing to cite here.<small>A reference no index knows is never shown as real.</small></span></span>
            <canvas className="fm-dust" aria-hidden="true" />
            <figcaption className="sr-only">An invented reference, used as a sample.</figcaption>
          </figure>
          <ul className="fm-lookups">
            {["Crossref", "OpenAlex", "Semantic Scholar"].map((s) => <li key={s} className="fm-lookup">{s}: <b>no match</b></li>)}
          </ul>
          <div className="fm-verdict">
            <p className="fm-big fm-red">No such record.</p>
            <p className="fm-sub">An AI wrote it, perfectly formatted. Paste your whole bibliography into Check references: Scholar AI says which ones exist, plainly, and never invents one.</p>
          </div>
          <Sample>Sample: an invented reference</Sample>
        </div>
      </Scene>

      {/* 7 */}
      <Scene id="india" i={6} label="fm-i-h">
        <div className="fm-stack fm-w">
          <Chapter>Chapter V · Close to home</Chapter>
          <div className="fm-india">
            <span className="fm-deva" aria-hidden="true" data-w="शोध" />
            <div className="fm-stack">
              <h2 id="fm-i-h" className="fm-big fm-big-s">Indian research, <em>on purpose.</em></h2>
              <div className="fm-nums">
                <p className="fm-num"><strong data-count={SHODHGANGA_THESES}>{fmt.format(SHODHGANGA_THESES)}</strong><span>theses on Shodhganga, listed through OpenAlex</span></p>
                <p className="fm-num"><strong data-count={DOAJ_INDIA_ARTICLES}>{fmt.format(DOAJ_INDIA_ARTICLES)}</strong><span>articles in open access journals published in India (DOAJ)</span></p>
              </div>
              <span className="fm-switch" aria-hidden="true"><Landmark size={15} /> Indian sources</span>
            </div>
            <div className="fm-convo">
              <p className="fm-bubble is-me" lang="hi-Latn">MGNREGA ka rural employment par kya asar hua?</p>
              <p className="fm-bubble is-it" lang="hi-Latn">MGNREGA ne rural employment ko kaafi badhaya, lekin asar state ke hisaab se alag hai <span className="fm-chip">1</span><span className="fm-chip">3</span><small lang="en">I searched for: MGNREGA impact on rural employment · Sample answer</small></p>
            </div>
          </div>
        </div>
      </Scene>

      {/* 8 */}
      <Scene id="workspace" i={7} label="fm-w-h">
        <div className="fm-stack fm-w">
          <Chapter>Chapter VI · Your own papers</Chapter>
          <div className="fm-ws">
            <div className="fm-ws-left" aria-hidden="true">
              <span className="fm-file"><FileText size={16} /> pilot-study.pdf <b>· in My Workspace</b></span>
              <div className="fm-book">
                <div className="fm-leaf">
                  <div className="fm-face is-front">
                    <div className="fm-face-body"><h4>Sample size of a pilot study for a two-arm trial</h4>
                    <p>Pilot studies are often used to estimate the variance needed to plan a main trial.</p>
                    <p><span className="fm-hl">Small pilots give unstable estimates, and a main study planned from them is often under-powered.</span></p>
                    <p>We compare rules for the pilot's size by the chance that the main study ends up with less power than planned.</p>
                    {/* the pen's note sits in the margin of its own paragraph (space kept for it), so it never lands on the text, however the lines wrap */}
                    <p className="fm-annot">Numerical examples use a power of <span className="fm-circ">80%<svg className="fm-ink" viewBox="0 0 100 40" preserveAspectRatio="none"><path pathLength={1} d="M8 24 C 6 8, 70 2, 94 14 C 102 26, 64 38, 30 36 C 12 34, 4 28, 14 16" /></svg></span> and a standardised effect of 0.4.<span className="fm-note">why 80%?<svg viewBox="0 0 40 16"><path pathLength={1} d="M38 3 C 26 4, 14 8, 4 13 M4 13 l 7 -1 M4 13 l 3 -6" /></svg></span></p>
                    <p>The rules are compared over pilot sizes from 10 to 70 per group, and for effects between 0.2 and 0.8.</p>
                    </div><span className="fm-pg">p. 1 / 15</span>
                  </div>
                  <div className="fm-face is-back">
                    <div className="fm-face-body"><h4>4. Results</h4>
                    <p>Table 2 gives the pilot sizes that keep the risk of an under-powered main study at 30%, 20% and 10%.</p>
                    <p><span className="fm-q-hl">The main study requires NL = 158 subjects per group.</span></p>
                    <p>With a pilot of 12 per group, the chance of an under-powered main study is close to one in three.</p>
                    <p>Larger pilots lower that risk quickly at first and slowly after about 35 per group.</p>
                    </div><span className="fm-pg">p. 4 / 15</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="fm-ws-right">
              <h2 id="fm-w-h" className="fm-big fm-big-s">Your PDFs. Marked, <em>and asked.</em></h2>
              <p className="fm-ask">How many people does the main study need?</p>
              <div className="fm-ans">
                <p>158 in each group.</p>
                <blockquote>“The main study requires NL = 158 subjects per group.”</blockquote>
                <span className="fm-page">Page 4 · the exact quote</span>
              </div>
              <ul className="fm-feats" aria-label="What My Workspace does">
                <li>Pen and highlighter</li><li>Annotated PDF download</li><li>Scanned papers too</li><li>Offline reading</li><li>Private to your account, never used to train AI</li>
              </ul>
              <Sample>Sample paper</Sample>
            </div>
          </div>
        </div>
      </Scene>

      {/* between the scenes: what the film did not show, and privacy, as quiet sections */}
      <section className="fm-quiet" id="more" aria-labelledby="fm-more-h">
        <div className="fm-wrap">
          <h2 id="fm-more-h" className="fm-big fm-big-s">Two more tools, <em>same rules.</em></h2>
          <div className="fm-cards">
            <article className="fm-card"><h3>Idea Check</h3><p>Describe your idea. You approve the search first; the closest papers are compared with each part of it, every match with the sentence it rests on. It never says your idea is new or not new.</p></article>
            <article className="fm-card"><h3>Literature scan</h3><p>Give a topic, get a short review: findings by theme, an evidence table of the papers with their study designs, the gaps, and APA references to download.</p></article>
          </div>
        </div>
      </section>
      <section className="fm-quiet" id="privacy" aria-labelledby="fm-priv-h">
        <div className="fm-wrap">
          <h2 id="fm-priv-h" className="fm-big fm-big-s">Your work stays <em>yours.</em></h2>
          <div className="fm-cards">
            {[
              { Icon: Lock, t: "Private to your account", b: "Your papers, notes and questions are visible to nobody else, and the admin page shows numbers only." },
              { Icon: Share2, t: "Only an approved search leaves", b: "For an idea or a scan, you see and edit the search first. Only those words, never your text or file, go to the scholarly indexes." },
              { Icon: Trash2, t: "Delete all of it, any time", b: "Export everything as one file, or delete your account and your papers in a click." },
            ].map(({ Icon, t, b }) => (
              <article key={t} className="fm-card"><span className="fm-ico"><Icon size={18} aria-hidden="true" /></span><h3>{t}</h3><p>{b}</p></article>
            ))}
          </div>
        </div>
      </section>

      {/* 9 */}
      <Scene id="end" i={8} bars={false} label="fm-e-h">
        <div className="fm-dawn" aria-hidden="true" />
        <div className="fm-end">
          <Chapter>Your turn</Chapter>
          <h2 id="fm-e-h" className="fm-big">Ask your <em>first</em> question.</h2>
          <div className="fm-end-cta">{cta}</div>
          <div className="fm-credits">
            <ul aria-label="Where the papers come from">
              {[["OpenAlex", "papers and theses"], ["Semantic Scholar", "papers"], ["Crossref", "DOIs and retractions"], ["PubMed", "medicine"], ["arXiv", "preprints"], ["DOAJ", "journals published in India"], ["Europe PMC", "open full texts"], ["Retraction Watch", "through Crossref"]].map(([n, w]) => (
                <li key={n}><b>{n}</b> · {w}</li>
              ))}
            </ul>
          </div>
        </div>
      </Scene>

      {animated && (
        <nav className="fm-strip" aria-label="Scenes">
          {SCENE_TITLES.map((t, i) => (
            <button key={t} type="button" data-i={i} aria-label={`Scene ${i + 1}: ${t}`} aria-current={active === i ? "true" : undefined} onClick={() => goTo(i)}>
              <i />
              <span>{t}</span>
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
