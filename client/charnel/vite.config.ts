import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
// this serves the setup wizard and other tauri-specific UI on port 1421
// spume (main music player) runs on port 1420
export default defineConfig(async () => ({
  plugins: [solid()],

  // use relative paths so assets work in Tauri's tauri:// protocol
  base: "./",

  // bundle everything into single files for simpler embedding
  build: {
    rollupOptions: {
      output: {
        // bundle everything into a single JS file (no code splitting)
        inlineDynamicImports: true,
      },
    },
  },

  // vite options tailored for tauri development
  clearScreen: false,
  server: {
    port: 1421,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1423,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
