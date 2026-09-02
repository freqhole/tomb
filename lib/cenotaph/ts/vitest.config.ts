import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // solid-js publishes separate server/browser builds behind package.json
    // export conditions; without this, vitest's default "node" condition
    // resolves to solid's ssr-stub build (real signals/resources need the
    // browser build even when the enclosing environment is plain node).
    // vite 6+ resolves ssr/test modules through its own `ssr.resolve`
    // conditions (defaulting to just "node"), separate from the top-level
    // `resolve.conditions` above - both must be set or solid-js still
    // resolves to its server build under vitest.
    conditions: ["browser"],
  },
  ssr: {
    resolve: {
      conditions: ["browser"],
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
