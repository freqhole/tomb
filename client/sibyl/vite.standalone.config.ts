// web-only build (no tauri). loaded by `npm run dev:web` /
// `npm run build:web`. ships the same `index.html` + bundle, but
// targets a pure-browser runtime where `transport-wasm` (midden) is
// the chunk transport.

import { defineConfig } from "vite";

const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
};

export default defineConfig({
  clearScreen: false,
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
