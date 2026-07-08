import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    environmentMatchGlobs: [
      ["src/utils/image-utils.test.ts", "happy-dom"],
      ["src/worker/blob-worker-logic.test.ts", "happy-dom"],
      ["src/worker/blob-worker-client.test.ts", "happy-dom"],
    ],
    include: ["src/**/*.test.ts"],
  },
});
