/**
 * tauri mode detection
 *
 * when running in tauri, we use a custom protocol (freqhole://) for media URLs
 * so that tauri can intercept and add authorization headers for api key auth.
 *
 * the VITE_CHARNEL_MODE env var is set by tauri's build commands.
 */

/**
 * check if running in tauri mode
 *
 * this is determined by:
 * 1. VITE_CHARNEL_MODE env var (set at build time)
 * 2. window.__TAURI_INTERNALS__ global with invoke function (set by tauri runtime)
 *
 * note: we check for __TAURI_INTERNALS__.invoke specifically because some browsers
 * or extensions may set window.__TAURI__ to undefined/null without actual tauri runtime
 */
export function isCharnelMode(): boolean {
  // check env var first (compile-time)
  if (import.meta.env.VITE_CHARNEL_MODE === "true") {
    return true;
  }

  // check tauri runtime is actually available (not just property exists)
  // @ts-expect-error __TAURI_INTERNALS__ is injected by tauri
  if (typeof window !== "undefined" && typeof window.__TAURI_INTERNALS__?.invoke === "function") {
    return true;
  }

  return false;
}
