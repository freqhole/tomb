// runtime selection between the two video backends.
//
// - `VideoBackend` — html `<video>` element. correct everywhere except linux.
// - `VideoWindowBackend` — charnel's separate gstreamer window. linux only,
//   because webkitgtk cannot play video in a `<video>` element at all.
//
// gated behind the same experimental-player opt-in that drives rodio for audio,
// so a linux user can fall back to the (broken, but familiar) html path if the
// video window misbehaves.
//
// availability is resolved once, asynchronously, at boot — `selectVideoBackend`
// itself stays synchronous so the player facade's backend swap does not have to
// become async.

import { isCharnelMode } from "../../../app/services/charnel/mode";
import { isRodioEnabled } from "./rodioPreference";
import { debug } from "../../../utils/logger";
import { isVideoWindowAvailable } from "../../../video/services/videoWindowClient";
import type { PlayerBackend } from "./backend";

let windowBackendAvailable = false;

/** resolve whether the video window can be used. call once at boot. */
export async function initVideoWindowPreference(): Promise<void> {
  if (!isCharnelMode()) {
    windowBackendAvailable = false;
    return;
  }
  windowBackendAvailable = await isVideoWindowAvailable();
  debug("videoSelect", `video window available: ${windowBackendAvailable}`);
}

/** true when video should play in the separate window rather than a `<video>`. */
export function useVideoWindow(): boolean {
  return windowBackendAvailable && isRodioEnabled();
}

/**
 * pick the backend for video playback.
 *
 * both instances are owned by the caller (the player facade) so the html one
 * keeps its `<video>` element alive for `getVideoElement()` even while the
 * window backend is active.
 */
export function selectVideoBackend(
  htmlVideoBackend: PlayerBackend,
  windowBackend: PlayerBackend
): PlayerBackend {
  return useVideoWindow() ? windowBackend : htmlVideoBackend;
}
