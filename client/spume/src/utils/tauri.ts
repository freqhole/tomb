/**
 * tauri mode detection
 *
 * when running in tauri, we use a custom protocol (freqhole://) for media URLs
 * so that tauri can intercept and add authorization headers for api key auth.
 *
 * the VITE_TAURI_MODE env var is set by tauri's build commands.
 */

/**
 * check if running in tauri mode
 *
 * this is determined by:
 * 1. VITE_TAURI_MODE env var (set at build time)
 * 2. window.__TAURI__ global (set by tauri runtime)
 */
export function isTauriMode(): boolean {
  // check env var first (compile-time)
  if (import.meta.env.VITE_TAURI_MODE === "true") {
    return true;
  }

  // check tauri runtime global (runtime)
  if (typeof window !== "undefined" && "__TAURI__" in window) {
    return true;
  }

  return false;
}
