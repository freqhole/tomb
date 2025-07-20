import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node", // Default environment for existing tests
    include: [
      "tests/**/*.test.ts",
      "tests/**/*.spec.ts",
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
    ],
    // Per-file environment configuration
    environmentMatchGlobs: [
      // Component tests need jsdom for DOM testing
      ["src/views/playlistz/**/*.component.test.{ts,tsx}", "jsdom"],
      ["src/views/playlistz/**/*.dom.test.{ts,tsx}", "jsdom"],
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.spec.ts", "src/test-*.ts"],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
  },
});
