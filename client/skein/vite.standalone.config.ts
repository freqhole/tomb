import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vite";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [wasm(), topLevelAwait()],
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        skein: path.resolve(dirname, "skein.html"),
        gallery: path.resolve(dirname, "widget-gallery.html"),
      },
    },
    sourcemap: true,
  },
});
