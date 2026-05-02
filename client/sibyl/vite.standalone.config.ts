// web-only build (no tauri). loaded by `npm run dev:web` /
// `npm run build:web`. ships the same `index.html` + bundle, but
// targets a pure-browser runtime where `transport-wasm` (midden) is
// the chunk transport.

import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
};

export default defineConfig({
  clearScreen: false,
  // wasm-pack bundler-target output uses the ESM-integration proposal
  // for wasm, which vite doesn't natively support. these two plugins
  // mirror what skein/loam uses for the same midden import path.
  plugins: [wasm(), topLevelAwait()],
  server: {
    port: 1422,
    strictPort: true,
    headers: isolationHeaders,
  },
  preview: {
    port: 1432,
    headers: isolationHeaders,
  },
  build: {
    outDir: "dist-web",
  },
});
