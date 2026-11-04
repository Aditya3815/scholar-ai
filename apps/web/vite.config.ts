import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The two fonts the first screen is written in (Inter for the interface, Source Serif for titles), Latin letters only, are fetched at the start of the
 * page load instead of when the stylesheet has been read and the text needs them. Without this a phone first draws the text in another font and then
 * redraws it, which moves the lines (layout shift). The other scripts and weights load only when a page needs them, as before.
 */
function preloadFonts(): Plugin {
  const wanted = [/inter-latin-wght-normal-[\w-]+\.woff2$/, /source-serif-4-latin-opsz-normal-[\w-]+\.woff2$/];
  return {
    name: "scholar-preload-fonts",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(_html, ctx) {
        const names = Object.keys(ctx.bundle ?? {});
        return wanted.flatMap((re) => {
          const file = names.find((n) => re.test(n));
          return file ? [{ tag: "link", injectTo: "head" as const, attrs: { rel: "preload", as: "font", type: "font/woff2", href: `/${file}`, crossorigin: "" } }] : [];
        });
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), preloadFonts()],
  build: {
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
