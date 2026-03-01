/// <reference types="vitest/config" />
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { defineConfig, type Plugin } from "vite";
import solidPlugin from "vite-plugin-solid";

const dirname =
  typeof __dirname !== "undefined" ? __dirname : path.dirname(fileURLToPath(import.meta.url));

// get git commit SHA for cache versioning
function getGitCommitSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "dev";
  }
}

const gitSha = getGitCommitSha();

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
        swContent = swContent.replace(/__APP_VERSION__/g, gitSha);
        fs.writeFileSync(swOutputPath, swContent);
        console.log(`[sw] wrote service worker with version: ${gitSha}`);
      }
    },
  };
}

export default defineConfig({
  plugins: [solidPlugin(), serviceWorkerPlugin()],
  // use relative paths so assets work in Tauri's tauri:// protocol
  base: process.env.VITE_TAURI_MODE ? "./" : "/",
  define: {
    __APP_VERSION__: JSON.stringify(gitSha),
  },
  build: {
    rollupOptions: {
      output: {
        // bundle everything into a single JS file (no code splitting)
        inlineDynamicImports: true,
      },
    },
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
