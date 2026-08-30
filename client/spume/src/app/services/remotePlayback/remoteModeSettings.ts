// opt-in toggle for spume acting as a P2P remote-playback target (a
// "/player/"-capable peer). off by default - most spume instances are pure
// controllers, not player devices; users who want their own devices e.g. a
// spare tablet or PC hooked to speakers to double as a controllable player
// flip this on explicitly.
//
// persisted to localStorage (not IndexedDB) - this is a tiny synchronous
// boolean read on every hello/pairing connection attempt (see
// acceptModeBootstrap.ts's `isEnabled` callback), not app data.

import { createSignal } from "solid-js";

const STORAGE_KEY = "spume.remotePlaybackEnabled";

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

const [remotePlaybackEnabled, setRemotePlaybackEnabledSignal] = createSignal(readStored());

export { remotePlaybackEnabled };

export function setRemotePlaybackEnabled(enabled: boolean): void {
  // TEMP DEBUG - remove once the first-pair-attempt-fails bug is found
  console.log("[debug/remoteModeSettings] setRemotePlaybackEnabled:", enabled);
  setRemotePlaybackEnabledSignal(enabled);
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    // localStorage unavailable (private browsing etc.) - in-memory signal
    // still reflects the current session's choice.
  }
}

/** synchronous read for non-reactive call sites (e.g. `isEnabled()`
 * callbacks that run once per inbound connection attempt). */
export function isRemotePlaybackEnabled(): boolean {
  const value = remotePlaybackEnabled();
  // TEMP DEBUG - remove once the first-pair-attempt-fails bug is found
  console.log("[debug/remoteModeSettings] isRemotePlaybackEnabled() ->", value);
  return value;
}
