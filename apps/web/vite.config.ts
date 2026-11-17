import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The two fonts the first screen is written in (Inter for the interface, Source Serif for titles), Latin letters only, are fetched at the start of the
 * page load instead of when the stylesheet has been read and the text needs them. Without this a phone first draws the text in another font and then
 * redraws it, which moves the lines (layout shift). The other scripts and weights load only when a page needs them, as before.
 *
 * They are asked for right after the main script and BEFORE the module preloads, not at the end of the head. The browser asks for what the head lists in
 * order, and the first load is many small files (51 on 17 Nov 2026, once the reader of a paper became a chunk of its own, docs/design/paper-reader.md, 14;
 * 30 before). At the end of the head the fonts waited behind all of them: on the slow profile they came after the first paint, and their swap moved Home's
 * text (layout shift 0.062 on this machine and 0.108 in CI, 0.000 before). Ahead of the module preloads they come in time however many files there are,
 * and the first paint is no later (measured: 3.74 to 3.84 s against 3.77 to 3.86 s). scripts/budget.mjs fails a build where they are behind one again.
 */
function preloadFonts(): Plugin {
  const wanted = [/inter-latin-wght-normal-[\w-]+\.woff2$/, /source-serif-4-latin-opsz-normal-[\w-]+\.woff2$/];
  return {
    name: "scholar-preload-fonts",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        const names = Object.keys(ctx.bundle ?? {});
        const links = wanted.map((re) => {
          const file = names.find((n) => re.test(n));
          // a font package that renamed its files would otherwise leave the page with no preload and no sign of it (the budget's font line passed at 0 KB)
          if (!file) throw new Error(`preloadFonts: no built file matches ${re}; update the pattern to the font package's new file name`);
          return `<link rel="preload" as="font" type="font/woff2" href="/${file}" crossorigin="">`;
        });
        // Vite has written the main script, the module preloads and the style sheet into the head by now (this hook runs "post")
        const at = html.search(/<link[^>]+rel="modulepreload"/);
        const end = html.indexOf("</head>");
        if (end < 0) throw new Error("preloadFonts: index.html has no </head>");
        const where = at >= 0 && at < end ? at : end;
        return `${html.slice(0, where)}${links.join("\n    ")}\n    ${html.slice(where)}`;
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), preloadFonts()],
  build: {
    // dist/.vite/manifest.json: which file each module was built into, read by scripts/budget.mjs to find the chunks that load later. public/.assetsignore keeps it out of what is served.
    manifest: true,
    // packages/shared is plain functions, constants and types: none of its modules does anything when it is imported (no statement at the top level of any of them is a call or an assignment
    // to something outside it). Told so, the bundler leaves out a module of it that nobody uses, and the parts of one that nobody uses, instead of keeping them in case importing them did
    // something: about 4 KB (gzip) of the first load on 3 Nov 2026 (docs/design/chatview-and-trending.md, C3). A module of it that ever has to run when it is imported must not be put here.
    rolldownOptions: { treeshake: { moduleSideEffects: (id: string) => !/packages[\\/]shared[\\/]src[\\/]/.test(id) } },
    // A small file is normally written into the script as a data: address. The CSP forbids fetching those, and the Rive runtime fetches its files: so a .riv is always a file of its own.
    assetsInlineLimit: (file) => (file.endsWith(".riv") ? false : undefined),
  },
  server: {
    proxy: { "/api": "http://localhost:8787" },
  },
});
