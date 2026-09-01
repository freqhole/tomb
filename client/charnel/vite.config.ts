import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { execSync } from "node:child_process";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// git short sha of the checkout this ui bundle was built from - shown in the
// wizard sidebar next to the rust binary's own baked-in sha so a stale dist/
// is immediately visible instead of being mistaken for a missing feature.
function uiGitSha(): string {
  // @ts-expect-error process is a nodejs global
  const fromEnv = process.env.FREQHOLE_GIT_SHA;
  if (fromEnv) {
    return fromEnv;
  }
  try {
    const sha = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    const dirty = execSync("git status --porcelain --untracked-files=no", {
      encoding: "utf8",
    }).trim();
    return dirty ? `${sha}-dirty` : sha;
  } catch {
    return "unknown";
  }
}

// https://vite.dev/config/
// this serves the setup wizard and other tauri-specific UI on port 1421
// spume (main music player) runs on port 1420
export default defineConfig(async () => ({
  plugins: [solid()],

  define: {
    __UI_GIT_SHA__: JSON.stringify(uiGitSha()),
  },

  // use relative paths so assets work in Tauri's tauri:// protocol
  base: "./",

  // bundle everything into single files for simpler embedding
  build: {
    rollupOptions: {
      output: {
        // bundle everything into a single JS file (no code splitting)
        inlineDynamicImports: true,
      },
    },
  },

  // vite options tailored for tauri development
  clearScreen: false,
  server: {
    port: 1421,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1423,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
