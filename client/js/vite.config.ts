import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  root: "src/views/freqhole",
  build: {
    outDir: "../../../dist/freqhole",
    emptyOutDir: true,
  },
  server: {
    port: 3003,
    host: true,
  },
});
