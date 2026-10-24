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
  server: {
    proxy: { "/api": "http://localhost:8787" },
  },
});
