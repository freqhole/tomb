import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dirname, "..");

// resolves the bare "midden" specifier that reliquary's blob worker
// dynamically imports (see @freqhole/reliquary/worker's midden-blake3.ts).
// a plain `resolve.alias` entry does not reach this import: it's inside a
// worker's own module graph, which vite builds through a separate plugin
// pipeline from the main app - matches spume/playlistz/skein's identical plugin.
function middenBareSpecifierPlugin(): Plugin {
  return {
    name: "midden-bare-specifier",
    resolveId(source) {
      if (source === "midden") {
        return this.resolve("@freqhole/midden", undefined, { skipSelf: true });
      }
      return null;
    },
  };
}

export default defineConfig({
  root,
  plugins: [wasm(), topLevelAwait(), solid(), tailwindcss(), middenBareSpecifierPlugin()],
  worker: {
    format: "es",
    plugins: () => [wasm(), middenBareSpecifierPlugin()],
  },
  server: {
    host: true,
    fs: {
      // @freqhole/haruspex, @freqhole/reliquary, @freqhole/midden are file:
      // deps pointing at sibling lib/ dirs - vite's default dev-server file
      // allowlist (project root + node_modules only) blocks serving their
      // real, non-symlink-resolved source/dist files without this.
      allow: [".", "../lib/haruspex", "../lib/reliquary", "../lib/midden"],
    },
  },
  // @freqhole/midden contains a .wasm file that esbuild can't pre-bundle;
  // vite-plugin-wasm handles it instead.
  optimizeDeps: {
    exclude: ["@freqhole/midden"],
  },
  build: {
    target: "esnext",
    outDir: "dist",
    sourcemap: true,
  },
});
