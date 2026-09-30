// libmpv opt-in preference state - the "experimental player" toggle.
//
// split out of select.ts for the same reason blobResolver.ts needs it:
// blobResolver.ts can read isLibmpvEnabled() without statically importing
// select.ts's LibmpvBackend import chain.
//
// source of truth: charnel's `FreqholeAppConfig.use_libmpv_playback`.
// this module caches the value synchronously so callers can stay
// non-async; `initLibmpvPreference()` (called once at app boot) fetches
// the initial value, and `onConfigChanged` re-fetches it when the wizard
// flips the toggle. in non-charnel mode there's a tiny localStorage
// fallback so dev/test code can still exercise the path, but there is no
// ui to set it.

import { isCharnelMode } from "../../../app/services/charnel/mode";

/// localStorage fallback key — only consulted in non-charnel mode.
/// the source of truth in charnel mode is `FreqholeAppConfig`.
const LIBMPV_LOCAL_FALLBACK_KEY = "freqhole.audio.useLibmpv";

/// cached value, populated by `initLibmpvPreference()` on app boot and
/// refreshed when the wizard fires `config_changed`. defaults to false
/// so we never hand back a libmpv backend before the cache has been
/// hydrated (failing closed to the html path is safer).
let cachedLibmpvEnabled = false;

/// hydrate `cachedLibmpvEnabled` from the appropriate source. safe to
/// call multiple times — wired into `App.tsx`'s `onConfigChanged`
/// handler so the wizard toggle takes effect without a reload.
export async function initLibmpvPreference(): Promise<boolean> {
  if (isCharnelMode()) {
    try {
      // eslint-disable-next-line no-restricted-syntax -- tauri-only api, avoid bundling into web builds
      const { invoke } = await import("@tauri-apps/api/core");
      const enabled = await invoke<boolean>("get_libmpv_playback");
      cachedLibmpvEnabled = !!enabled;
      return cachedLibmpvEnabled;
    } catch {
      // tauri command missing or threw — fall back to the localStorage
      // hint so dev builds without the new commands still work.
    }
  }
  cachedLibmpvEnabled = readLocalFallback();
  return cachedLibmpvEnabled;
}

/// "is the user opted in to the libmpv playback path (audio + video)
/// right now?" - the "experimental player" toggle. off means html
/// `<audio>`/`<video>`, exactly like a plain web browser.
///
/// reads the cached value populated by `initLibmpvPreference()`. kept
/// exported so settings ui can compute a default for the toggle without
/// re-implementing the lookup.
export function isLibmpvEnabled(): boolean {
  return cachedLibmpvEnabled;
}

/// dev/test helper: persist + cache the opt-in via the localStorage
/// fallback. **not** the right thing to call from the wizard — that
/// path goes through tauri's `set_libmpv_playback` command. exposed
/// only so non-tauri tests can flip the bit.
export function setLibmpvEnabled(enabled: boolean): boolean {
  cachedLibmpvEnabled = enabled;
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(LIBMPV_LOCAL_FALLBACK_KEY, enabled ? "true" : "false");
    } catch {
      // ignore — see comment in `readLocalFallback`.
    }
  }
  return enabled;
}

function readLocalFallback(): boolean {
  if (typeof localStorage === "undefined") {
    return false;
  }
  try {
    return localStorage.getItem(LIBMPV_LOCAL_FALLBACK_KEY) === "true";
  } catch {
    // some sandboxed/test environments throw on localStorage access
    // even when `typeof localStorage !== "undefined"` - fail closed.
    return false;
  }
}
