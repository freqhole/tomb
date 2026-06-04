// scroll-coach demo — standalone build profile
//
// produces the artifacts consumed by freqhole.net's <ScrollCoach /> astro
// component:
//   npm run build:coach:wc    -> ../../freqhole.net/public/demo/freqhole-coach-demo.js
//                                (registers <freqhole-coach-demo>; written
//                                directly into the astro static dir so the
//                                site build picks it up with no copy step)
//   npm run build:coach:html  -> dist-coach-demo-html/index.html
//                                (single self-contained preview page, local only)

import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// where the wc bundle goes — directly into the astro site's public/demo dir
// so `astro build` copies it into dist/ as-is.
const WC_OUT_DIR = resolve(__dirname, "../../freqhole.net/public/demo");

export default defineConfig(({ mode }) => {
  const isHtml = mode === "html";
  return {
    plugins: [solid()],
    resolve: {
      alias: {
        // midden is a wasm/native module — replace with the browser-only stub
        // for any demo build.
        midden: resolve(__dirname, "src/stubs/midden-stub.ts"),
      },
    },
    define: {
      "import.meta.env.STORYBOOK": "false",
      "import.meta.env.COACH_DEMO": "true",
    },
    // wc bundle is served from /demo/ on freqhole.net, so vite-emitted
    // asset URLs (worker chunks, etc) need that prefix to resolve.
    base: isHtml ? "./" : "/demo/",
    build: {
      outDir: isHtml ? "dist-coach-demo-html" : WC_OUT_DIR,
      // don't blow away other files in public/demo/
      emptyOutDir: isHtml,
      cssCodeSplit: false,
      rollupOptions: isHtml
        ? {
            // html mode: vite uses the index.html as entry
            input: resolve(__dirname, "stories/coach/index.html"),
          }
        : {
            // wc mode: single-file ES bundle that registers the custom element
            input: resolve(__dirname, "stories/coach/standalone.tsx"),
            output: {
              inlineDynamicImports: true,
              entryFileNames: "freqhole-coach-demo.js",
              assetFileNames: "freqhole-coach-demo.[ext]",
              format: "es",
            },
          },
    },
  };
});
