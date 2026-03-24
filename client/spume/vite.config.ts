/// <reference types="vitest/config" />
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { defineConfig, type Plugin } from "vite";
import solidPlugin from "vite-plugin-solid";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";

const dirname =
  typeof __dirname !== "undefined" ? __dirname : path.dirname(fileURLToPath(import.meta.url));

// get version from package.json
const packageJson = JSON.parse(fs.readFileSync(path.join(dirname, "package.json"), "utf8"));
const version = packageJson.version || "0.0.0";

// get git commit SHA - env var first (for Docker/Cloudflare builds), fallback to git command
function getGitSha(): string {
  // local/Docker builds
  if (process.env.FREQHOLE_GIT_SHA) {
    return process.env.FREQHOLE_GIT_SHA;
  }
  // Cloudflare Pages (full SHA, take first 7 chars)
  if (process.env.CF_PAGES_COMMIT_SHA) {
    return process.env.CF_PAGES_COMMIT_SHA.slice(0, 7);
  }
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "dev";
  }
}

const gitSha = getGitSha();
const appVersion = `${version}-${gitSha}`;

// plugin to inject version into service worker at build time
function serviceWorkerPlugin(): Plugin {
  return {
    name: "service-worker-version",
    apply: "build",
    writeBundle(options) {
      const outDir = options.dir || "dist";
      const swTemplatePath = path.join(dirname, "src/sw-template.js");
      const swOutputPath = path.join(outDir, "sw.js");

      if (fs.existsSync(swTemplatePath)) {
        let swContent = fs.readFileSync(swTemplatePath, "utf8");
        swContent = swContent.replace(/__APP_VERSION__/g, appVersion);
        fs.writeFileSync(swOutputPath, swContent);
        console.log(`[sw] wrote service worker with version: ${appVersion}`);
      }
    },
  };
}

// tauri builds should not include midden WASM - use app P2P via CharnelTransport
const isCharnelBuild = !!process.env.VITE_CHARNEL_MODE;

export default defineConfig({
  plugins: [
    // only include WASM plugins for non-Tauri builds
    ...(isCharnelBuild ? [] : [wasm(), topLevelAwait()]),
    solidPlugin(),
    serviceWorkerPlugin(),
  ],
  // use relative paths so assets work in Tauri's tauri:// protocol
  base: isCharnelBuild ? "./" : "/",
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __IS_CHARNEL__: JSON.stringify(isCharnelBuild),
  },
  build: {
    rollupOptions: {
      // exclude midden WASM from Tauri builds
      external: isCharnelBuild ? ["midden"] : [],
      output: {
        // bundle everything into a single JS file (no code splitting)
        inlineDynamicImports: true,
      },
    },
  },
  resolve: {
    alias: isCharnelBuild
      ? {
          // stub out midden in Tauri builds - CharnelTransport handles P2P in app
          midden: path.join(dirname, "src/stubs/midden-stub.ts"),
        }
      : {},
  },
  test: {
    projects: [
      {
        extends: true,
        plugins: [
          storybookTest({
            configDir: path.join(dirname, ".storybook"),
          }),
        ],
        test: {
          name: "storybook",
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [
              {
                browser: "chromium",
              },
            ],
          },
        },
      },
    ],
  },
});
