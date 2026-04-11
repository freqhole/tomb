/**
 * media module — platform-aware media serving for skein.
 *
 * provides unified APIs for resolving playable media URLs across all
 * supported platforms (browser, macOS Tauri, Linux Tauri/WebKitGTK)
 * and a singleton audio manager for playback control.
 */

// media URL resolution
export {
    getMediaPlaybackUrl, isLinuxWebKitGTK, revokeAllMediaUrls, revokeMediaUrl, type MediaUrlOptions
} from "./media-urls";

// singleton audio manager
export {
    audioManager, type AudioError, type AudioEventMap,
    type AudioPlaybackState,
    type AudioTimeUpdate
} from "./audio-manager";

