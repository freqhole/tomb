import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // solid-js publishes separate server/browser builds behind package.json
    // export conditions; without this, vitest's default "node" condition
    // resolves to solid's ssr-stub build (real components/effects need the
    // browser build even when the enclosing environment is plain node).
    conditions: ["browser"],
  },
  test: {
    environment: "node",
    environmentMatchGlobs: [
      ["src/utils/image-utils.test.ts", "happy-dom"],
      ["src/worker/blob-worker-logic.test.ts", "happy-dom"],
      ["src/worker/blob-worker-client.test.ts", "happy-dom"],
      ["src/blobs/bytes-backend.test.ts", "happy-dom"],
      ["src/blobs/store.test.ts", "happy-dom"],
      ["src/solid/blob-url.test.ts", "happy-dom"],
    ],
    include: ["src/**/*.test.ts"],
  },
});
