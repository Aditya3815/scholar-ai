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
  // 6 KB since the intro became the film of nine scenes (28 Oct 2026, docs/design/cinematic-story.md): 5.7 KB measured; the rise is about 4 ms on the slow profile.
  // 6.5 KB after the user's corrections the same day (the cinematic send and its pause, the margin note, the dust's dissolve, the frosted header): 6.0 KB measured, about 2 ms more
  // 7 KB when the film began to play in every window (1 Nov 2026: the room of a frame, the narrow and the short compositions): 6.6 KB measured, about 1 ms more on the slow profile
  "the intro page chunk, style (gzip)": 7 * KB,
  "the PDF reader chunk, script and style (gzip)": 66 * KB,
  // The Rive pieces (docs/design/setu-rive.md, rive-ideas.md), fetched only when a picture is wanted: 57.6, 331 and 8.4 KB measured on 1 Nov 2026, plus about 10%. None of them may be in the first load.
  "the Rive runtime chunk, script (gzip)": 64 * KB,
  "the Rive runtime, wasm (gzip)": 365 * KB,
  "the Rive files of the pictures (gzip)": 10 * KB,
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
    const key = f.replace(/.*[\\/]/, "").replace(/-[A-Za-z0-9_-]{8}\.(js|css|wasm|riv)$/, ".$1");
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
  "the Rive runtime chunk, script (gzip)": sum(newest(pick(/^rive-.*\.js$/)), gz),
  "the Rive runtime, wasm (gzip)": sum(newest(pick(/^rive-.*\.wasm$/)), gz),
  "the Rive files of the pictures (gzip)": sum(newest(pick(/\.riv$/)), gz),
};

let failed = false;
for (const file of [...scripts, ...styles, ...fonts]) {
  if (!existsSync(local(file))) { console.log(` FAIL  index.html names ${file}, which is not in dist`); failed = true; }
}
// The heavy chunks are for people who open a paper, download a marked copy or watch a scan; they must never be part of the first load.
for (const file of scripts) {
  if (/\/(pdf|es|annotated-pdf|PdfViewer|IntroPage|rive|RivePiece|Setu|Reading|DropBox|litscan|litscan-review|LitscanPage)-/.test(file)) { console.log(` FAIL  the first load has started to include ${file}`); failed = true; }
}
// Pieces that are fetched only when they are wanted (docs/design/chatview-and-trending.md, C3). Each must stay a chunk of its own: when somebody imports it with a plain `import` from the
// first screen, the bundler folds it back into the main script and the size limit above is spent again, with no other sign. The second list is of pages whose style sheet is imported by the page
// itself (idea.css and admin.css were in the first load's style sheet for everybody until 3 Nov 2026); put back into src/main.tsx, they would be again.
const OWN_CHUNK_SCRIPT = ["ChatView"];
const OWN_CHUNK_STYLE = ["IdeaPage", "AdminPage"];
for (const name of OWN_CHUNK_SCRIPT) {
  if (!pick(new RegExp(`^${name}-.*\\.js$`)).length) { console.log(` FAIL  ${name} is no longer a chunk of its own: it is part of the first load again`); failed = true; }
  if (scripts.some((file) => file.includes(`/${name}-`))) { console.log(` FAIL  the first load has started to include the ${name} chunk`); failed = true; }
}
for (const name of OWN_CHUNK_STYLE) {
  if (!pick(new RegExp(`^${name}-.*\\.css$`)).length) { console.log(` FAIL  ${name} has no style sheet of its own: its rules are in the first load's style sheet again`); failed = true; }
}
// The CSS minifier (Lightning CSS, Vite 8) drops a standard property that is written before its -webkit- twin: Chrome and Edge then get no blur at all (seen 28 Oct 2026). Every
// -webkit- property in the built style sheets must have its standard twin.
for (const file of newest(pick(/\.css$/))) {
  const css = readFileSync(file, "utf8");
  // rule by rule: a declaration block that has the -webkit- one must also have the standard one
  const blocks = css.split("}").map((b) => b.slice(b.lastIndexOf("{") + 1));
  for (const p of ["backdrop-filter", "box-decoration-break", "mask-image"]) {
    const lost = blocks.filter((b) => b.includes(`-webkit-${p}:`) && !new RegExp(`(?<![-\\w])${p}:`).test(b)).length;
    if (lost) { console.log(` FAIL  ${file.replace(/.*[\\/]/, "")}: ${lost} rule(s) with -webkit-${p} and no standard ${p} (write the -webkit- one first)`); failed = true; }
  }
}
for (const [what, limit] of Object.entries(LIMITS)) {
  const size = measured[what];
  const over = size > limit;
  if (over) failed = true;
  console.log(`${over ? " FAIL " : "  ok  "} ${what}: ${(size / KB).toFixed(1)} KB of ${(limit / KB).toFixed(0)} KB`);
}
console.log(failed ? "\nover budget" : "\nall size budgets met");
process.exit(failed ? 1 : 0);
