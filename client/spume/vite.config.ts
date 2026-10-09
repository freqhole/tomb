/// <reference types="vitest/config" />
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import legacy from "@vitejs/plugin-legacy";
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

// babel (@vitejs/plugin-legacy's transform, unlike esbuild's build.target)
// does NOT downlevel BigInt literal syntax (`0n`) at all - there's no
// official babel transform for this (unlike private fields/etc, BigInt is
// a real new primitive type with no lossless polyfill as a plain double,
// so babel leaves the literal syntax untouched rather than silently
// producing wrong-precision code). confirmed real 2026-10-07: 5 `0n`/`1n`
// literals survived an actual plugin-legacy build (zod's bigint
// validation path, an mp4-atom-header-length parser). a dedicated 3rd-
// party babel plugin exists (babel-plugin-transform-bigint, JSBI-based)
// but plugin-legacy's Options don't expose a hook to inject extra babel
// plugins into its pipeline - simplest fix is a direct text substitution
// on the already-built legacy output, same as esbuild's own (safe here:
// all occurrences found so far are small literals like `0n`/`1n`, not
// large values needing real arbitrary-precision math).
function bigintLiteralFallbackPlugin(): Plugin {
  return {
    name: "bigint-literal-fallback",
    apply: "build",
    writeBundle(options) {
      const outDir = options.dir || "dist";
      const assetsDir = path.join(outDir, "assets");

      if (!fs.existsSync(assetsDir)) return;

      for (const file of fs.readdirSync(assetsDir)) {
        if (!file.endsWith(".js")) continue;

        const jsPath = path.join(assetsDir, file);
        const jsContent = fs.readFileSync(jsPath, "utf8");
        const replaced = jsContent.replace(/\b([0-9][0-9_]*)n\b/g, "BigInt($1)");

        if (replaced !== jsContent) {
          fs.writeFileSync(jsPath, replaced);
          console.log(`[bigint-fallback] rewrote BigInt literals in ${file}`);
        }
      }
    },
  };
}

// plugin to ensure sourceMappingURL comments are added to JS files
// (some plugins like vite-plugin-wasm can strip these)
function sourcemapUrlPlugin(): Plugin {
  return {
    name: "sourcemap-url-fixer",
    apply: "build",
    writeBundle(options) {
      const outDir = options.dir || "dist";
      const assetsDir = path.join(outDir, "assets");

      if (!fs.existsSync(assetsDir)) return;

      for (const file of fs.readdirSync(assetsDir)) {
        if (!file.endsWith(".js")) continue;

        const jsPath = path.join(assetsDir, file);
        const mapPath = jsPath + ".map";

        // skip if no sourcemap exists
        if (!fs.existsSync(mapPath)) continue;

        const jsContent = fs.readFileSync(jsPath, "utf8");
        const comment = `//# sourceMappingURL=${file}.map`;

        // skip if already has sourcemap comment
        if (jsContent.includes("sourceMappingURL=")) continue;

        fs.writeFileSync(jsPath, jsContent + "\n" + comment + "\n");
        console.log(`[sourcemap] added sourceMappingURL to ${file}`);
      }
    },
  };
}

// @vitejs/plugin-legacy's built-in module/nomodule feature detection
// tests "does this browser support ES modules" - not "does it support
// the newer syntax inside them". Catalina's WebKit supports modules
// (Safari 10.1+) years before private class fields/BigInt (Safari 14+),
// so left alone it would try to parse the modern <script type="module"
// crossorigin src="..."> entry (and crash on its syntax) since it
// doesn't honor `nomodule` the way genuinely old browsers do - `nomodule`
// scripts are SKIPPED specifically by module-capable browsers, which
// Catalina counts as. confirmed via an actual build 2026-10-07 (initial
// attempt only targeted the wrong two inline probe/loader scripts,
// which turned out to be a secondary/dynamic-reload mechanism, not the
// actual gate - the real gate is the literal `nomodule` attribute on
// the polyfill/entry <script> tags). this removes the modern entry's
// <script type="module" ... src="..."> tag outright and strips every
// `nomodule` attribute so the legacy polyfill+entry scripts always run,
// on every browser, regardless of module support. runs in
// transformIndexHtml (after plugin-legacy's own html transform, via
// `enforce: "post"`) rather than writeBundle, since vite only runs its
// own index.html emission/writing after plugin hooks resolve in that
// phase.
function forceLegacyOnlyHtmlPlugin(): Plugin {
  return {
    name: "force-legacy-only-html",
    apply: "build",
    enforce: "post",
    transformIndexHtml(html) {
      return html
        .replace(/<script type="module"[^>]*\ssrc="[^"]*"[^>]*><\/script>\s*/g, "")
        .replace(/<link[^>]*rel="modulepreload"[^>]*>\s*/g, "")
        .replace(/\snomodule(?=[\s>])/g, "");
    },
  };
}

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

// set only by client/charnel/scripts/build-spume-for-charnel.mjs when
// building for x86_64-apple-darwin (the only charnel target that still
// runs on Catalina's old bundled WKWebView) - standalone spume.freqhole.net
// and charnel's arm64 build both run on modern engines, so they keep
// "esnext" (smaller output, no private-field WeakMap emulation overhead).
const needsLegacySafariTarget = !!process.env.VITE_LEGACY_SAFARI_TARGET;

// resolves the bare "midden" specifier that reliquary's blob worker
// dynamically imports (see @freqhole/reliquary/worker's midden-blake3.ts).
// a plain `resolve.alias` entry does not reach this import: it's inside a
// worker's own module graph, which vite builds through a separate plugin
// pipeline from the main app - `resolve.alias` only applies to the graph
// it's declared against, so the alias has to be re-declared as an actual
// plugin and included in both the main `plugins` and `worker.plugins` lists
// below for it to apply to both.
function middenBareSpecifierPlugin(target: string): Plugin {
  return {
    name: "midden-bare-specifier",
    resolveId(source) {
      if (source === "midden") return this.resolve(target, undefined, { skipSelf: true });
      return null;
    },
  };
}

const middenTarget = isCharnelBuild
  ? path.join(dirname, "src/stubs/midden-stub.ts")
  : "@freqhole/midden";

// serve the standalone freqhole-playlistz.js bundle from the local package dist.
// this lets buildPlaylistZip fetch it when building zip downloads in dev mode.
function servePlaylistzBundle(): Plugin {
  const bundlePath = path.resolve(
    dirname,
    "node_modules/@freqhole/playlistz/dist/freqhole-playlistz.js"
  );
  return {
    name: "serve-playlistz-bundle",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0] === "/freqhole-playlistz.js" && fs.existsSync(bundlePath)) {
          res.setHeader("Content-Type", "application/javascript");
          fs.createReadStream(bundlePath).pipe(res);
          return;
        }
        next();
      });
    },
    // also copy it to the build output so production builds work
    writeBundle(options) {
      if (fs.existsSync(bundlePath)) {
        const outDir = options.dir || "dist";
        fs.mkdirSync(outDir, { recursive: true });
        fs.copyFileSync(bundlePath, path.join(outDir, "freqhole-playlistz.js"));
      }
    },
  };
}

export default defineConfig({
  server: {
    fs: {
      // @freqhole/haruspex/reliquary/midden/api-client are file: deps
      // pointing at in-tree lib/ (and client-codegen/) packages
      // (../../lib/<name> or ../../client-codegen/<name> from spume/), so
      // vite's default dev-server file allowlist (project root +
      // node_modules only) blocks serving their real, non-symlink-resolved
      // source/dist files - matching skein/loam's vite.config.ts, which
      // needed the same allowance for the same reason. api-client was
      // missing here (unlike the other three) - confirmed live via
      // "outside of Vite serving allow list" errors for its domains/*.ts
      // files, which meant edits to files importing from it couldn't
      // reliably HMR-reload.
      allow: [
        ".",
        "../../lib/haruspex",
        "../../lib/reliquary",
        "../../lib/midden",
        "../../client-codegen/freqhole-api-client",
      ],
    },
    // cross-origin isolation headers - matching skein/loam's vite.config.ts:
    // without these, the new worker-hosted midden node's WASM init can hang
    // indefinitely in some browsers. CORP is additionally required for iOS
    // Safari specifically - it refuses to load the module worker's WASM
    // through a tunneled (ngrok) origin under COEP without it, even though
    // the resource is same-origin and desktop Safari tolerates the same
    // setup without CORP.
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Resource-Policy": "cross-origin",
      // intermittent COEP-blocked-worker failures on mobile Safari, even
      // right after a fresh reload with no server-side change, look like a
      // stale cached response (from before CORP was added, or across a dev
      // server restart) winning the race on some loads - a dev server
      // should never be cached anyway.
      "Cache-Control": "no-store",
    },
  },
  plugins: [
    // only include WASM plugins for non-Tauri builds
    ...(isCharnelBuild ? [] : [wasm(), topLevelAwait()]),
    solidPlugin(),
    serviceWorkerPlugin(),
    sourcemapUrlPlugin(),
    servePlaylistzBundle(),
    middenBareSpecifierPlugin(middenTarget),
    // browserslist-driven babel transform + core-js polyfills, replacing
    // hand-picked esbuild "target" string guessing (which only catches
    // SYNTAX, never runtime stdlib gaps like Promise.allSettled) - only
    // emits the legacy (babel + core-js) bundle, never the modern one, so
    // this build still produces exactly one JS entry (matching
    // inlineDynamicImports: true below) instead of the plugin's usual
    // dual modern/legacy + feature-detection setup. NOT
    // renderModernChunks: false - confirmed real regression 2026-10-07:
    // disabling the modern pass also silently drops ALL css output
    // (extraction apparently piggybacks on that pass) and strips index.
    // html's stylesheet <link> entirely. forceLegacyOnlyHtmlPlugin
    // (below, transformIndexHtml hook) instead strips the modern
    // <script type="module"> entry + the legacy scripts' `nomodule`
    // attribute AFTER both passes (and css) have run normally - needed
    // anyway since plugin-legacy's standard module/nomodule feature
    // detection tests "does this browser support ES modules", not "does
    // it support the specific newer syntax inside them" - Catalina's
    // WebKit supports modules (added Safari 10.1) years before private
    // fields/BigInt (Safari 14+), so it would pick the MODERN bundle via
    // feature detection and crash on its syntax anyway if left on its
    // own.
    ...(needsLegacySafariTarget
      ? legacy({
          targets: "safari >= 13",
        })
      : []),
    ...(needsLegacySafariTarget
      ? [forceLegacyOnlyHtmlPlugin(), bigintLiteralFallbackPlugin()]
      : []),
  ],
  // worker bundles need wasm too - reliquary's blob worker pulls in
  // @freqhole/midden (wasm) for blake3.
  worker: {
    format: "es",
    plugins: () => (isCharnelBuild ? [] : [wasm()]).concat(middenBareSpecifierPlugin(middenTarget)),
  },
  // use relative paths so assets work in Tauri's tauri:// protocol
  base: isCharnelBuild ? "./" : "/",
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __IS_CHARNEL__: JSON.stringify(isCharnelBuild),
  },
  build: {
    // plain "esnext" everywhere now, even for the legacy-safari build -
    // @vitejs/plugin-legacy (added above) does its own complete syntax
    // downleveling pass via Babel AFTER esbuild/rollup produce this
    // output, driven by a browserslist target instead of us hand-picking
    // an ES-version string one newly-discovered feature at a time (see
    // needsLegacySafariTarget's own comment for the two real crashes -
    // private class fields, then BigInt literals - that drove that
    // approach before switching to plugin-legacy).
    target: "esnext",
    // tailwind v4's default palette emits oklch() colors - Catalina's
    // WebKit can't parse that function at all (unlike an unsupported JS
    // syntax error, an unparseable CSS value is just silently DROPPED,
    // leaving the property unset - confirmed real symptom 2026-10-07:
    // "lots of missing styles", not a crash). esbuild's CSS minifier
    // downlevels oklch()/color-mix()/etc. to rgb() fallbacks when given
    // an older cssTarget - unlike JS, CSS has no babel-style transform
    // available via plugin-legacy, so this still needs its own explicit
    // override (defaults to build.target, which is "esnext" above -
    // never what we want for CSS here).
    cssTarget: needsLegacySafariTarget ? "safari14" : undefined,
    // generate sourcemaps for debugging prod errors
    sourcemap: true,
    rollupOptions: {
      // do not mark "midden" external in Tauri builds.
      // we rely on resolve.alias to redirect it to a local stub module.
      // externalization leaves a bare import("midden") in output and fails
      // at runtime under tauri:// with "does not resolve to a valid URL".
      external: [],
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
          "@freqhole/midden": path.join(dirname, "src/stubs/midden-stub.ts"),
        }
      : {},
  },
  // exclude @freqhole/midden from esbuild pre-bundling - it contains a
  // .wasm file that esbuild can't handle; vite-plugin-wasm handles it
  // instead (matching skein/loam's vite.config.ts, which uses the same
  // reliquary worker and hit the same need for this).
  optimizeDeps: {
    exclude: ["@freqhole/midden"],
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
          environment: "node",
        },
      },
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
