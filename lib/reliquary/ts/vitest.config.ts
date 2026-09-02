import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // solid-js publishes separate server/browser builds behind package.json
    // export conditions; without this, vitest's default "node" condition
    // resolves to solid's ssr-stub build (real components/effects need the
    // browser build even when the enclosing environment is plain node).
    conditions: ["browser"],
    alias: {
      // "midden" is a bare specifier that only an embedding app provides
      // (aliased in its own bundler config) - see midden-blake3.ts. this
      // package's own tests alias it to a stub so the dynamic import
      // resolves (satisfying vite's static import analysis) while still
      // exercising the "no midden module bundled" degraded-behavior path.
      midden: path.resolve(__dirname, "src/worker/midden-not-bundled.stub.ts"),
    },
  },
  ssr: {
    resolve: {
      // vite 6+ resolves ssr/test modules through its own `ssr.resolve`
      // conditions (defaulting to just "node"), separate from the
      // top-level `resolve.conditions` above - both must be set or
      // solid-js still resolves to its server build under vitest.
      conditions: ["browser"],
    },
  },
  test: {
    environment: "node",
    environmentMatchGlobs: [
      ["src/utils/image-utils.test.ts", "happy-dom"],
      ["src/worker/blob-worker-logic.test.ts", "happy-dom"],
      ["src/worker/blob-worker-client.test.ts", "happy-dom"],
      ["src/worker/midden-worker-client.test.ts", "happy-dom"],
      ["src/blobs/bytes-backend.test.ts", "happy-dom"],
      ["src/blobs/store.test.ts", "happy-dom"],
      ["src/solid/blob-url.test.ts", "happy-dom"],
    ],
    include: ["src/**/*.test.ts"],
  },
});
