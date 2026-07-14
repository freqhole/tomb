import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // solid-js publishes separate server/browser builds behind package.json
    // export conditions; without this, vitest's default "node" condition
    // resolves to solid's ssr-stub build (real signals/resources need the
    // browser build even when the enclosing environment is plain node).
    conditions: ["browser"],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
