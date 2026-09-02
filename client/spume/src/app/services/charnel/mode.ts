/**
 * tauri mode detection
 *
 * when running in tauri, we use a custom protocol (freqhole://) for media URLs
 * so that tauri can intercept and add authorization headers for api key auth.
 *
 * the VITE_CHARNEL_MODE env var is set by tauri's build commands.
 */

import { isTauriRuntime } from "@freqhole/api-client";

/**
 * check if running in tauri mode
 *
 * this is determined by:
 * 1. VITE_CHARNEL_MODE env var (set at build time)
 * 2. an actual tauri runtime (see `isTauriRuntime` - the single source of
 *    truth for global sniffing; never check `window.__TAURI*` directly)
 */
export function isCharnelMode(): boolean {
  // check env var first (compile-time)
  if (import.meta.env.VITE_CHARNEL_MODE === "true") {
    return true;
  }

  return isTauriRuntime();
}
