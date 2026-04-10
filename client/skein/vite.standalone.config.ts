import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vite";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const isTauriBuild = !!process.env.VITE_TAURI;

// custom base path for deployment (e.g. VITE_SKEIN_BASE=/skein/ for cloudflare)
const deployBase = process.env.VITE_SKEIN_BASE;

export default defineConfig({
  // wasm + top-level-await plugins are always needed (automerge uses WASM internally).
  // only midden (iroh P2P transport) is stubbed in tauri builds.
  plugins: [wasm(), topLevelAwait()],
  base: isTauriBuild ? "./" : deployBase || "/",
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        skein: path.resolve(dirname, "skein.html"),
        ...(isTauriBuild ? {} : { gallery: path.resolve(dirname, "widget-gallery.html") }),
      },
    },
    sourcemap: true,
  },
  // in tauri builds, alias midden to a stub (P2P transport is handled by the rust backend)
  ...(isTauriBuild
    ? {
        resolve: {
          alias: {
            midden: path.resolve(dirname, "src/stubs/midden-stub.ts"),
          },
        },
      }
    : {}),
});
