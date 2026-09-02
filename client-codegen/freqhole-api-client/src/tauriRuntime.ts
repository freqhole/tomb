// the one place that knows how to detect a tauri runtime.
//
// tauri v2 only injects `window.__TAURI__` when `app.withGlobalTauri` is
// enabled in tauri.conf.json - freqhole does NOT enable it, so any
// `"__TAURI__" in window` check is silently false in the real desktop app.
// `__TAURI_INTERNALS__` is always injected, and probing its `invoke` (rather
// than mere property existence) avoids false positives from browser
// extensions that define the namespace without a working runtime.
//
// every tauri-detection site in the codebase must route through here rather
// than sniffing globals directly, so a future tauri change is a one-line fix.

declare global {
  interface Window {
    __TAURI_INTERNALS__?: { invoke?: unknown };
  }
}

/** true when running inside a tauri webview with a usable ipc bridge. */
export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && typeof window.__TAURI_INTERNALS__?.invoke === "function";
}
