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
  // The new Paper Reader (docs/design/paper-reader.md, 14), behind the READER switch: its layout, toolbar pieces, pop-up, panel tabs and toasts ("reader"), and the Agents drawer ("agents"),
  // each fetched only when the switch is on. The plan's budgets, set 13 Nov 2026 before the first build. While both readers exist, the Ask panel stays in the page's chunk (today's reader shows it at once).
  // The page of a paper (DocWorkspace, with today's reader) left the first load on 13 Nov 2026 (the first load fell from 243.4 to 233.1 KB): 19.5 KB measured, plus about 10%.
  "the paper page chunk (DocWorkspace), script and style (gzip)": 22 * KB,
  "the new reader chunk (Desk), script and style (gzip)": 28 * KB,
  "the Agents drawer chunk, script and style (gzip)": 20 * KB,
  // The Notebook (phase 2, 16 Nov 2026): the Notes tab, its store and merge, the Markdown parser and the editor, fetched when the panel is shown or Add to notes is pressed. The plan's 16 KB.
  // 17 KB since ink on the pages (docs/design/paper-reader.md, 25; the owner's yes of 20 Nov 2026, O-7): the Draw toggle, the space block, Show drawings and the lazy door to nb-ink; 16.3 KB measured.
  "the Notebook chunk, script and style (gzip)": 17 * KB,
  // Phase 2.5: a sketch in the notes (its pen, eraser and grip; the outlines are the ink-path chunk the paper shares), fetched when a page holds a sketch. 2.2 KB measured on 18 Nov 2026.
  "the Notebook sketch chunk, script (gzip)": 4 * KB,
  // the page tabs, a chunk of their own since the notes polish (19 Nov 2026), fetched as soon as the Notebook's arrives
  "the Notebook page tabs chunk (drag to reorder, All pages), script (gzip)": 4 * KB,
  // Ink on the pages of notes (docs/design/paper-reader.md, 25, 20 Nov 2026): the layer that draws and takes the pen, the anchoring engine, the ink row and its store, fetched when a page has
  // ink or Draw is pressed. The plan's 9 KB.
  "the Notebook ink chunk (nb-ink: drawing on the pages), script (gzip)": 9 * KB,
  // Phase 2.5: Export as PDF or Word (the pages laid out, the captures and sketches as pictures); pdf-lib and fflate are chunks of their own already. 3.0 KB measured on 18 Nov 2026.
  // 6 KB since ink on the pages (25.11 foresaw about 2 KB more): the ink as vectors in the PDF, the line-breaker that predicts Word's lines, one picture per paragraph; 5.3 KB measured on 20 Nov 2026.
  "the notes export chunk, script (gzip)": 6 * KB,
  // fontkit, which lets the notes PDF embed Noto Sans Devanagari as a subset: fetched only when the exported text has Devanagari. 151 KB measured on 18 Nov 2026.
  "the fontkit chunk, script (gzip)": 160 * KB,
  // Sharing a paper (docs/design/paper-share.md, 18 Nov 2026), behind the SHARE switch: the owner's Share dialog (5.5 KB measured), the comments and a Viewer's notes (4.6 KB), and the two
  // small pieces of My Workspace and the link (/s/<token>) (0.7 and 0.5 KB), each fetched only when wanted; plus about 10 to 25 %. The first load grew by 0.33 KB of script and 0.06 KB of style.
  "the Share dialog chunk, script and style (gzip)": 6.5 * KB,
  "the shared paper chunk (read-only notes), script and style (gzip)": 5.5 * KB,
  // The notes polish (19 Nov 2026): the comments (list, thread, the box to write in) moved out of the shared paper chunk into a chunk of their own, fetched when they are first opened,
  // and the page tabs (drag to reorder, All pages) out of the Notebook chunk; each has a line, and neither old line was raised.
  "the comments chunk, script and style (gzip)": 7.5 * KB,
  "Shared with me and the link opener, script (gzip)": 1.6 * KB,
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
const READER_PAGE = "src/components/papers/DocWorkspace.tsx";
const DESK = "src/components/papers/desk/Desk.tsx";
const AGENTS = "src/components/papers/desk/AgentsDrawer.tsx";
const NOTEBOOK = "src/components/papers/desk/notebook/Notebook.tsx";
const NB_SKETCH = "src/components/papers/desk/notebook/NbSketch.tsx";
const NB_TABS = "src/components/papers/desk/notebook/NbTabs.tsx";
const NB_INK = "src/components/papers/desk/notebook/NbInk.tsx";
const NOTES_EXPORT = "src/lib/notes-export.ts";
const FONTKIT = "../../node_modules/@cantoo/fontkit/dist/browser-module.mjs";
const SHARE_DIALOG = "src/components/papers/desk/share/ShareDialog.tsx";
const SHARED_PARTS = "src/components/papers/desk/share/SharedParts.tsx";
const COMMENTS = "src/components/papers/desk/share/Comments.tsx";
const SHARED_WITH_ME = "src/components/papers/SharedWithMe.tsx";
const SHARE_OPEN = "src/components/papers/ShareOpen.tsx";
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
  "the paper page chunk (DocWorkspace), script and style (gzip)": sum(filesOf(READER_PAGE), gz),
  "the new reader chunk (Desk), script and style (gzip)": sum(filesOf(DESK), gz),
  "the Agents drawer chunk, script and style (gzip)": sum(filesOf(AGENTS), gz),
  "the Notebook chunk, script and style (gzip)": sum(filesOf(NOTEBOOK), gz),
  "the Notebook sketch chunk, script (gzip)": sum(filesOf(NB_SKETCH), gz),
  "the Notebook page tabs chunk (drag to reorder, All pages), script (gzip)": sum(filesOf(NB_TABS), gz),
  "the Notebook ink chunk (nb-ink: drawing on the pages), script (gzip)": sum(filesOf(NB_INK), gz),
  "the notes export chunk, script (gzip)": sum(filesOf(NOTES_EXPORT), gz),
  "the fontkit chunk, script (gzip)": sum(filesOf(FONTKIT), gz),
  "the Share dialog chunk, script and style (gzip)": sum(filesOf(SHARE_DIALOG), gz),
  "the shared paper chunk (read-only notes), script and style (gzip)": sum(filesOf(SHARED_PARTS), gz),
  "the comments chunk, script and style (gzip)": sum(filesOf(COMMENTS), gz),
  "Shared with me and the link opener, script (gzip)": sum([...filesOf(SHARED_WITH_ME, { css: false }), ...filesOf(SHARE_OPEN, { css: false })], gz),
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
// ... and ahead of the module preloads: behind the 51 files of the first load they came after the first paint on the slow profile, and Home's text moved when they swapped in (17 Nov 2026)
const firstFont = html.search(/<link[^>]+rel="preload"[^>]+as="font"/);
const firstModule = html.search(/<link[^>]+rel="modulepreload"/);
if (fonts.length && firstModule >= 0 && firstFont > firstModule) fail("index.html asks for the fonts after the module preloads (vite.config.ts preloadFonts must put them ahead, or Home moves when they arrive)");
// The heavy pieces are for people who open a paper, download a marked copy or watch a scan; they must never be part of the first load. They are named by the module each is built from;
// the three that the bundler cuts out as shared pieces of those (the Rive picture frame and the two literature-scan helpers) have no module of their own in the manifest and are found by the
// name it gives them, which is the name of the module they were cut from.
const HEAVY = [
  "../../node_modules/pdfjs-dist/build/pdf.mjs",
  "../../node_modules/@cantoo/pdf-lib/es/index.js",
  "src/lib/annotated-pdf.ts",
  PDF_READER,
  READER_PAGE,
  DESK,
  AGENTS,
  NOTEBOOK,
  NB_SKETCH,
  NB_TABS,
  NB_INK,
  NOTES_EXPORT,
  FONTKIT,
  SHARE_DIALOG,
  SHARED_PARTS,
  COMMENTS,
  SHARED_WITH_ME,
  SHARE_OPEN,
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
