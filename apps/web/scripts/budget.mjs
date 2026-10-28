// Size budget for what a first visit downloads (docs/design/w6.md). Reads the files the built index.html asks for at once (its script, module preloads,
// style sheet and preloaded fonts), compresses each the way the server does (gzip) and fails when a total goes over its limit. Chunks that load later
// (the intro page, the PDF reader) have a limit of their own so that they cannot creep into the first load unnoticed.
//   node scripts/budget.mjs          (after `npm run build -w apps/web`)
// A limit is the size measured on 27 Oct 2026 plus about 10%. Raising one is a decision to write down in docs/design/w6.md, not a quiet edit.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const DIST = fileURLToPath(new URL("../dist/", import.meta.url));
const KB = 1024;
/** Limits in bytes. `first.js` and `first.css` are gzip totals of what index.html loads at once; `fonts` is the raw size of the preloaded fonts (already compressed). */
export const LIMITS = {
  "first load: scripts (gzip)": 250 * KB,
  "first load: style sheet (gzip)": 26 * KB,
  "first load: preloaded fonts": 185 * KB,
  "the intro page chunk, script (gzip)": 15 * KB,
  // 6 KB since the intro became the film of nine scenes (28 Oct 2026, docs/design/cinematic-story.md): 5.7 KB measured; the rise is about 4 ms on the slow profile
  "the intro page chunk, style (gzip)": 6 * KB,
  "the PDF reader chunk, script and style (gzip)": 66 * KB,
};

const gz = (file) => gzipSync(readFileSync(file), { level: 9 }).length;
const html = readFileSync(join(DIST, "index.html"), "utf8");
const refs = (re) => [...html.matchAll(re)].map((m) => m[1]);
const local = (u) => join(DIST, u.replace(/^\//, ""));

const scripts = [...refs(/<script[^>]+type="module"[^>]+src="([^"]+)"/g), ...refs(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g)];
const styles = refs(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g);
const fonts = refs(/<link[^>]+rel="preload"[^>]+as="font"[^>]+href="([^"]+)"/g);

const assets = readdirSync(join(DIST, "assets"));
const pick = (re) => assets.filter((f) => re.test(f)).map((f) => join(DIST, "assets", f));
/** A dist folder that was not emptied can hold several builds of one chunk: only the newest file of each name counts. */
const newest = (files) => {
  const byName = new Map();
  for (const f of files) {
    const key = f.replace(/.*[\\/]/, "").replace(/-[A-Za-z0-9_-]{8}\.(js|css)$/, ".$1");
    const prev = byName.get(key);
    if (!prev || statSync(f).mtimeMs > statSync(prev).mtimeMs) byName.set(key, f);
  }
  return [...byName.values()];
};

const sum = (files, size) => files.reduce((n, f) => n + size(f), 0);
const measured = {
  "first load: scripts (gzip)": sum(scripts.map(local), gz),
  "first load: style sheet (gzip)": sum(styles.map(local), gz),
  "first load: preloaded fonts": sum(fonts.map(local), (f) => readFileSync(f).length),
  "the intro page chunk, script (gzip)": sum(newest(pick(/^IntroPage-.*\.js$/)), gz),
  "the intro page chunk, style (gzip)": sum(newest(pick(/^IntroPage-.*\.css$/)), gz),
  "the PDF reader chunk, script and style (gzip)": sum(newest(pick(/^PdfViewer-.*\.(js|css)$/)), gz),
};

let failed = false;
for (const file of [...scripts, ...styles, ...fonts]) {
  if (!existsSync(local(file))) { console.log(` FAIL  index.html names ${file}, which is not in dist`); failed = true; }
}
// The heavy chunks are for people who open a paper or download a marked copy; they must never be part of the first load.
for (const file of scripts) {
  if (/\/(pdf|es|annotated-pdf|PdfViewer|IntroPage)-/.test(file)) { console.log(` FAIL  the first load has started to include ${file}`); failed = true; }
}
for (const [what, limit] of Object.entries(LIMITS)) {
  const size = measured[what];
  const over = size > limit;
  if (over) failed = true;
  console.log(`${over ? " FAIL " : "  ok  "} ${what}: ${(size / KB).toFixed(1)} KB of ${(limit / KB).toFixed(0)} KB`);
}
console.log(failed ? "\nover budget" : "\nall size budgets met");
process.exit(failed ? 1 : 0);
