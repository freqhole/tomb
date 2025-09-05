import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [solid(), tailwindcss()],
  build: {
    rollupOptions: {
      input: path.resolve(
        __dirname,
        "src/views/freqhole-music-admin/index.html"
      ),
    },
    outDir: "dist/freqhole-music-admin",
    emptyOutDir: false,
  },
  server: {
    port: 3003,
    host: "0.0.0.0",
    allowedHosts: ["dj-who-cares.local"],
  },
});
