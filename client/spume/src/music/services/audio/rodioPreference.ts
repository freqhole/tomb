// rodio opt-in preference state - split out of select.ts so
// blobResolver.ts can read isRodioEnabled() without statically importing
// select.ts (which pulls in RodioBackend -> mediaSessionBridge.ts ->
// mediaSessionArtwork.ts -> blobResolver.ts, closing an import cycle).
//
// source of truth: charnel's `FreqholeAppConfig.use_rodio_playback`.
// this module caches the value synchronously so callers can stay
// non-async; `initRodioPreference()` (called once at app boot) fetches
// the initial value, and `onConfigChanged` re-fetches it when the
// wizard flips the toggle. in non-charnel mode there's a tiny
// localStorage fallback so dev/test code can still exercise the path,
// but there is no ui to set it.

import { isCharnelMode } from "../../../app/services/charnel/mode";

/// localStorage fallback key — only consulted in non-charnel mode.
/// the source of truth in charnel mode is `FreqholeAppConfig`.
const RODIO_LOCAL_FALLBACK_KEY = "freqhole.audio.useRodio";

/// cached value, populated by `initRodioPreference()` on app boot
/// and refreshed when the wizard fires `config_changed`. defaults
/// to false so we never hand back a `RodioBackend` before the cache
/// has been hydrated (which would be a silent no-op in non-tauri
/// builds anyway, but failing closed is safer).
let cachedRodioEnabled = false;

/// hydrate `cachedRodioEnabled` from the appropriate source. safe to
/// call multiple times — wired into `App.tsx`'s `onConfigChanged`
/// handler so the wizard toggle takes effect without a reload.
///
/// returns the value that was cached (useful for ui that wants to
/// show the current state after a refresh).
export async function initRodioPreference(): Promise<boolean> {
  if (isCharnelMode()) {
    try {
      // eslint-disable-next-line no-restricted-syntax -- tauri-only api, avoid bundling into web builds
      const { invoke } = await import("@tauri-apps/api/core");
      const enabled = await invoke<boolean>("get_rodio_playback");
      cachedRodioEnabled = !!enabled;
      return cachedRodioEnabled;
    } catch {
      // tauri command missing or threw — fall back to the localStorage
      // hint so dev builds without the new commands still work.
    }
  }
  cachedRodioEnabled = readLocalFallback();
  return cachedRodioEnabled;
}

/// "is the user opted in to the rust rodio playback path right now?"
///
/// reads the cached value populated by `initRodioPreference()`.
/// kept exported so settings ui can compute a default for the
/// toggle without re-implementing the lookup.
export function isRodioEnabled(): boolean {
  return cachedRodioEnabled;
}

/// dev/test helper: persist + cache the opt-in via the localStorage
/// fallback. **not** the right thing to call from the wizard — that
/// path goes through tauri's `set_rodio_playback` command. exposed
/// only so non-tauri tests can flip the bit.
export function setRodioEnabled(enabled: boolean): boolean {
  cachedRodioEnabled = enabled;
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(RODIO_LOCAL_FALLBACK_KEY, enabled ? "true" : "false");
    } catch {
      // ignore — see comment in `readLocalFallback`.
    }
  }
  return enabled;
}

function readLocalFallback(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(RODIO_LOCAL_FALLBACK_KEY) === "true";
  } catch {
    // some embeds throw on localStorage access (private mode etc.).
    // failing closed (= html backend) is the safe default.
    return false;
  }
}
