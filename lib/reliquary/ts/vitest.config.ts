import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    environmentMatchGlobs: [["src/utils/image-utils.test.ts", "happy-dom"]],
    include: ["src/**/*.test.ts"],
  },
});
