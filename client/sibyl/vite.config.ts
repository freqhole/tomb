import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// COOP/COEP enable `crossOriginIsolated`, which unlocks SharedArrayBuffer
// on safari (the player falls back to MessageChannel without it, but SAB
// is preferred). these headers must also be set on the tauri custom
// protocol (handled in src-tauri/src/lib.rs).
const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
};

// https://vite.dev/config/
export default defineConfig(async () => ({
  clearScreen: false,
  // wasm-pack bundler-target output uses the ESM-integration proposal
  // for wasm, which vite doesn't natively support. these two plugins
  // mirror what skein/loam uses for the same midden import path.
  plugins: [wasm(), topLevelAwait()],
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    headers: isolationHeaders,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  preview: {
    port: 1430,
    headers: isolationHeaders,
  },
}));
