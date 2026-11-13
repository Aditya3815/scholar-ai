// Size budget for what a first visit downloads (docs/design/w6.md). Reads the files the built index.html asks for at once (its script, module preloads,
// style sheet and preloaded fonts), compresses each the way the server does (gzip) and fails when a total goes over its limit. Chunks that load later
// (the intro page, the PDF reader) have a limit of their own so that they cannot creep into the first load unnoticed.
//   node scripts/budget.mjs          (after `npm run build -w apps/web`)
// A limit is the size measured on 27 Oct 2026 plus about 10%. Raising one is a decision to write down in docs/design/w6.md, not a quiet edit.
import { existsSync, readFileSync } from "node:fs";
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

// The chunks that load later are found by the module they are built from, in the build's own manifest (vite.config.ts `build.manifest`: dist/.vite/manifest.json, kept out of the
// deployed files by public/.assetsignore), not by the names the bundler gives their files. The manifest lists exactly this build's files, so an old file left in dist is never counted.
const MANIFEST = join(DIST, ".vite", "manifest.json");
const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};
const asset = (file) => join(DIST, file);
/** The manifest entry built from a module (a path from apps/web, as the manifest writes it), or undefined. */
const entry = (id) => manifest[id];
/** A lazily loaded module's own files: its script (unless `cssOnly`) and its style sheets. */
const filesOf = (id, { js = true, css = true } = {}) => {
  const e = entry(id);
  return e ? [...(js ? [e.file] : []), ...(css ? (e.css ?? []) : [])].map(asset) : [];
};

const INTRO = "src/workspace/intro/IntroPage.tsx";
const PDF_READER = "src/components/papers/PdfViewer.tsx";
const RIVE_RUNTIME = "../../node_modules/@rive-app/canvas-lite/rive.js";
const RIVE_WASM = "../../node_modules/@rive-app/canvas-lite/rive.wasm";
const rivFiles = Object.entries(manifest).filter(([id]) => id.endsWith(".riv")).map(([, e]) => asset(e.file));

const sum = (files, size) => files.reduce((n, f) => n + size(f), 0);
const measured = {
  "first load: scripts (gzip)": sum(scripts.map(local), gz),
  "first load: style sheet (gzip)": sum(styles.map(local), gz),
  "first load: preloaded fonts": sum(fonts.map(local), (f) => readFileSync(f).length),
  "the intro page chunk, script (gzip)": sum(filesOf(INTRO, { css: false }), gz),
  "the intro page chunk, style (gzip)": sum(filesOf(INTRO, { js: false }), gz),
  "the PDF reader chunk, script and style (gzip)": sum(filesOf(PDF_READER), gz),
  "the Rive runtime chunk, script (gzip)": sum(filesOf(RIVE_RUNTIME), gz),
  "the Rive runtime, wasm (gzip)": sum(filesOf(RIVE_WASM), gz),
  "the Rive files of the pictures (gzip)": sum(rivFiles, gz),
};

let failed = false;
const fail = (why) => { console.log(` FAIL  ${why}`); failed = true; };
if (!existsSync(MANIFEST)) fail(`no build manifest at ${MANIFEST} (vite.config.ts must keep build.manifest)`);
for (const id of [INTRO, PDF_READER, RIVE_RUNTIME, RIVE_WASM]) if (!entry(id)) fail(`the build manifest has no chunk built from ${id}: it was renamed, moved, or folded into another chunk`);
if (rivFiles.length === 0) fail("the build manifest lists no .riv file");
for (const file of [...scripts, ...styles, ...fonts]) {
  if (!existsSync(local(file))) fail(`index.html names ${file}, which is not in dist`);
}
// The two first-screen fonts are preloaded by vite.config.ts (preloadFonts); with none, the font line above would pass at 0 KB while every phone redraws its text.
if (fonts.length === 0) fail("index.html preloads no font (vite.config.ts preloadFonts found none of the fonts it wants)");
// The heavy pieces are for people who open a paper, download a marked copy or watch a scan; they must never be part of the first load. They are named by the module each is built from;
// the three that the bundler cuts out as shared pieces of those (the Rive picture frame and the two literature-scan helpers) have no module of their own in the manifest and are found by the
// name it gives them, which is the name of the module they were cut from.
const HEAVY = [
  "../../node_modules/pdfjs-dist/build/pdf.mjs",
  "../../node_modules/@cantoo/pdf-lib/es/index.js",
  "src/lib/annotated-pdf.ts",
  PDF_READER,
  INTRO,
  RIVE_RUNTIME,
  "src/components/litscan/Setu.tsx",
  "src/components/papers/Reading.tsx",
  "src/components/papers/DropBox.tsx",
  "src/components/litscan/LitscanPage.tsx",
];
const HEAVY_SHARED = ["RivePiece", "litscan", "litscan-review"];
const firstLoad = new Set(scripts.map((u) => u.replace(/^\//, "")));
for (const id of HEAVY) {
  if (!entry(id)) fail(`the build manifest has no chunk built from ${id}: it is no longer loaded on its own`);
  else if (firstLoad.has(entry(id).file)) fail(`the first load has started to include ${entry(id).file} (built from ${id})`);
}
for (const name of HEAVY_SHARED) {
  const chunks = Object.values(manifest).filter((e) => e.name === name && e.file.endsWith(".js"));
  if (!chunks.length) fail(`the build manifest has no shared chunk named ${name}`);
  for (const e of chunks) if (firstLoad.has(e.file)) fail(`the first load has started to include ${e.file}`);
}
// Pieces that are fetched only when they are wanted (docs/design/chatview-and-trending.md, C3). Each must stay a chunk of its own: when somebody imports it with a plain `import` from the
// first screen, the bundler folds it back into the main script and the size limit above is spent again, with no other sign. The second list is of pages whose style sheet is imported by the page
// itself (idea.css and admin.css were in the first load's style sheet for everybody until 3 Nov 2026); put back into src/main.tsx, they would be again.
const OWN_CHUNK_SCRIPT = ["src/workspace/ChatView.tsx"];
const OWN_CHUNK_STYLE = ["src/components/idea/IdeaPage.tsx", "src/components/admin/AdminPage.tsx"];
for (const id of OWN_CHUNK_SCRIPT) {
  if (!entry(id)?.isDynamicEntry) fail(`${id} is no longer a chunk of its own: it is part of the first load again`);
  else if (firstLoad.has(entry(id).file)) fail(`the first load has started to include the chunk of ${id}`);
}
for (const id of OWN_CHUNK_STYLE) {
  if (!entry(id)?.css?.length) fail(`${id} has no style sheet of its own: its rules are in the first load's style sheet again`);
}
// The CSS minifier (Lightning CSS, Vite 8) drops a standard property that is written before its -webkit- twin: Chrome and Edge then get no blur at all (seen 28 Oct 2026). Every
// -webkit- property in the built style sheets must have its standard twin.
const builtCss = [...new Set(Object.values(manifest).flatMap((e) => [...(e.css ?? []), ...(e.file.endsWith(".css") ? [e.file] : [])]))].map(asset);
for (const file of builtCss) {
  const css = readFileSync(file, "utf8");
  // rule by rule: a declaration block that has the -webkit- one must also have the standard one
  const blocks = css.split("}").map((b) => b.slice(b.lastIndexOf("{") + 1));
  for (const p of ["backdrop-filter", "box-decoration-break", "mask-image"]) {
    const lost = blocks.filter((b) => b.includes(`-webkit-${p}:`) && !new RegExp(`(?<![-\\w])${p}:`).test(b)).length;
    if (lost) fail(`${file.replace(/.*[\\/]/, "")}: ${lost} rule(s) with -webkit-${p} and no standard ${p} (write the -webkit- one first)`);
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
