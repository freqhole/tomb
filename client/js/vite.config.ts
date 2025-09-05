import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [
    solid(),
    tailwindcss({
      config: path.resolve("./tailwind.config.js"),
    }),
  ],
  root: "src/views/freqhole-music-admin",
  build: {
    outDir: "../../../dist/freqhole-music-admin", // no idea why this needs so many ../
    emptyOutDir: false,
  },
  server: {
    port: 3003,
    host: "0.0.0.0",
    allowedHosts: ["dj-who-cares.local"],
  },
});
