import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node", // Default environment for existing tests
    include: [
      "tests/**/*.test.ts",
      "tests/**/*.test.tsx",
      "tests/**/*.spec.ts",
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
    ],
    // Per-file environment configuration
    environmentMatchGlobs: [
      // Component tests need jsdom for DOM testing
      ["tests/components/**/*.test.{ts,tsx}", "jsdom"],
      // Navigation tests need jsdom for DOM and browser API testing
      ["src/hooks/navigation/**/*.test.{ts,tsx}", "jsdom"],
    ],
    setupFiles: [
      // Setup file for tests with IndexedDB and browser API mocks
      "src/test-setup.ts",
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
