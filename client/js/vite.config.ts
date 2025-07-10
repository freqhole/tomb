import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [solid(), tailwindcss()],
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
