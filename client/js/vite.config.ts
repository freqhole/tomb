import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [solid(), tailwindcss()],
  root: "src/views/freqhole",
  build: {
    outDir: "../../../dist/freqhole", // no idea why this needs so many ../
    emptyOutDir: false,
  },
  server: {
    port: 3003,
    host: "0.0.0.0",
    allowedHosts: ["dj-who-cares.local"],
  },
});
