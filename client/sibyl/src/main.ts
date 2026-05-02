// sibyl entry point. picks the right environment-specific bootstrap
// module via a top-level dynamic import so vite tree-shakes the
// unused half cleanly. all `@tauri-apps/*` imports live in
// bootstrap-tauri.ts; all webcodecs/midden imports live in
// bootstrap-web.ts. this file stays adapter-free.

const isTauri = "__TAURI_INTERNALS__" in window || "__TAURI__" in window;

window.addEventListener("DOMContentLoaded", async () => {
  const mod = isTauri
    ? await import("./bootstrap-tauri.js")
    : await import("./bootstrap-web.js");
  await mod.boot();
});
