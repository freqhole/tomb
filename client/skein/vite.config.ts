/// <reference types="vitest/config" />
import path from "path";
import { defineConfig } from "vite";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";

const isTauriBuild = !!process.env.VITE_TAURI;

export default defineConfig({
  plugins: [wasm(), topLevelAwait()],
  build: {
    lib: {
      entry: path.resolve(__dirname, "src/index.ts"),
      formats: ["es"],
      fileName: "skein",
    },
    rollupOptions: {
      external: isTauriBuild ? ["pixi.js", "@pixi/ui", "midden"] : ["pixi.js", "@pixi/ui"],
    },
    sourcemap: true,
  },
  // when building for Tauri, alias midden to a stub that throws on use
  ...(isTauriBuild
    ? {
        resolve: {
          alias: {
            midden: path.resolve(__dirname, "src/stubs/midden-stub.ts"),
          },
        },
      }
    : {}),
  // dev server serves test-harness.html for playwright tests
  server: {
    port: 5177,
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.integration.test.ts", "widgets/**/*.test.ts"],
    exclude: ["node_modules", "dist", "tests/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "html", "lcov", "json"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts", "widgets/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.integration.test.ts",
        "src/test-helpers/**",
        "widgets/**/*.test.ts",
        "**/*.d.ts",
        "**/index.ts",
        "src/widgets/widget-types.ts",
      ],
    },
  },
});
