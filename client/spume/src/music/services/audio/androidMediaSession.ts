/**
 * android lock screen / media notification shim.
 *
 * the android system webview does not implement `navigator.mediaSession`
 * at all. this module detects that case (when running inside charnel on
 * android) and installs a polyfill that forwards every call to the
 * `tauri-plugin-android-media-session` plugin, which owns a real
 * `MediaSessionCompat` + foreground `MediaStyle` notification.
 *
 * on all other platforms (desktop tauri, mobile safari, regular browsers)
 * this is a no-op and the browser-native `navigator.mediaSession` keeps
 * working as before.
 *
 * import this module once at app init (or from `player.ts`). installation
 * is idempotent.
 */

import { invoke, addPluginListener, type PluginListener } from "@tauri-apps/api/core";
import { isCharnelMode } from "../../../app/services/charnel";
import { debug } from "../../../utils/logger";

const NS = "plugin:android-media-session";

let installed = false;
let listener: PluginListener | null = null;

// locally-stored action handlers set by the app via setActionHandler.
// keyed by the action name (lower-case normalized).
const handlers = new Map<string, MediaSessionActionHandler | null>();

type NativePlaybackState = "playing" | "paused" | "stopped";

interface NativeSetMetadata {
  title: string;
  artist?: string;
  album?: string;
  durationMs?: number;
  artworkBase64?: string;
}

async function nativeSetMetadata(p: NativeSetMetadata): Promise<void> {
  try {
    await invoke(`${NS}|set_metadata`, { payload: p });
  } catch (e) {
    debug("androidMediaSession", "set_metadata failed:", e);
  }
}

async function nativeSetPlaybackState(state: NativePlaybackState): Promise<void> {
  console.log("[android-debug] nativeSetPlaybackState", { state, timestamp: Date.now() });
  try {
    await invoke(`${NS}|set_playback_state`, { payload: { state } });
  } catch (e) {
    debug("androidMediaSession", "set_playback_state failed:", e);
  }
}

async function nativeSetPosition(payload: {
  positionMs: number;
  durationMs: number;
  playbackRate: number;
}): Promise<void> {
  try {
    await invoke(`${NS}|set_position`, { payload });
  } catch (e) {
    debug("androidMediaSession", "set_position failed:", e);
  }
}

// fetch an image URL (blob:, data:, http(s):) and return raw base64 bytes.
// strips any data-URL prefix so the kotlin side can just Base64.decode().
async function artworkToBase64(src: string): Promise<string | undefined> {
  try {
    if (src.startsWith("data:")) {
      const idx = src.indexOf(",");
      if (idx >= 0) return src.slice(idx + 1);
      return undefined;
    }
    const res = await fetch(src);
    if (!res.ok) return undefined;
    const buf = await res.arrayBuffer();
    return arrayBufferToBase64(buf);
  } catch (e) {
    debug("androidMediaSession", "artwork fetch failed:", e);
    return undefined;
  }
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + chunk) as unknown as number[],
    );
  }
  return btoa(binary);
}

// pick the "best" artwork entry. prefers the largest declared size.
function pickArtwork(artwork: readonly MediaImage[] | undefined): string | undefined {
  if (!artwork || artwork.length === 0) return undefined;
  const scored = [...artwork].map((img) => {
    let size = 0;
    if (img.sizes) {
      const m = /(\d+)x(\d+)/.exec(img.sizes);
      if (m) size = parseInt(m[1]!, 10);
    }
    return { img, size };
  });
  scored.sort((a, b) => b.size - a.size);
  return scored[0]?.img.src;
}

function isAndroid(): boolean {
  return typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);
}

// polyfill MediaMetadata when the WebView doesn't ship one.
class PolyfillMediaMetadata {
  title = "";
  artist = "";
  album = "";
  artwork: readonly MediaImage[] = [];
  constructor(init?: MediaMetadataInit) {
    if (init) {
      this.title = init.title ?? "";
      this.artist = init.artist ?? "";
      this.album = init.album ?? "";
      this.artwork = init.artwork ?? [];
    }
  }
}

/**
 * install the polyfill / shim. safe to call multiple times.
 * returns true if installed, false if not applicable (wrong platform).
 */
export function installAndroidMediaSessionShim(): boolean {
  if (installed) return true;
  const hasNav = typeof navigator !== "undefined";
  const charnel = isCharnelMode();
  const android = hasNav && isAndroid();
  if (!hasNav) return false;
  if (!charnel || !android) {
    // non-android: rely on browser-native mediaSession
    return false;
  }

  debug("androidMediaSession", "installing polyfill");

  // if the MediaMetadata constructor is missing, install a polyfill so
  // `new MediaMetadata({...})` in existing code still works.
  if (typeof (window as unknown as { MediaMetadata?: unknown }).MediaMetadata !== "function") {
    (window as unknown as { MediaMetadata: typeof PolyfillMediaMetadata }).MediaMetadata =
      PolyfillMediaMetadata;
  }

  // build a polyfill mediaSession object that forwards to the native plugin.
  let currentMetadata: MediaMetadata | null = null;
  let currentPlaybackState: MediaSessionPlaybackState = "none";

  const polyfill = {
    get metadata(): MediaMetadata | null {
      return currentMetadata;
    },
    set metadata(value: MediaMetadata | null) {
      currentMetadata = value;
      if (!value) return;
      const artSrc = pickArtwork(value.artwork);
      void (async () => {
        const artworkBase64 = artSrc ? await artworkToBase64(artSrc) : undefined;
        await nativeSetMetadata({
          title: value.title || "",
          artist: value.artist || undefined,
          album: value.album || undefined,
          artworkBase64,
        });
      })();
    },
    get playbackState(): MediaSessionPlaybackState {
      return currentPlaybackState;
    },
    set playbackState(value: MediaSessionPlaybackState) {
      currentPlaybackState = value;
      const mapped: NativePlaybackState =
        value === "playing" ? "playing" : value === "paused" ? "paused" : "stopped";
      void nativeSetPlaybackState(mapped);
    },
    setPositionState(state?: MediaPositionState): void {
      if (!state) return;
      void nativeSetPosition({
        positionMs: Math.floor((state.position ?? 0) * 1000),
        durationMs: Math.floor((state.duration ?? 0) * 1000),
        playbackRate: state.playbackRate ?? 1,
      });
    },
    setActionHandler(
      action: MediaSessionAction,
      handler: MediaSessionActionHandler | null,
    ): void {
      handlers.set(String(action).toLowerCase(), handler);
    },
    setCameraActive(_active: boolean): void {
      // no-op on android notification
    },
    setMicrophoneActive(_active: boolean): void {
      // no-op on android notification
    },
  };

  try {
    Object.defineProperty(navigator, "mediaSession", {
      configurable: true,
      enumerable: true,
      writable: false,
      value: polyfill,
    });
  } catch (e) {
    debug("androidMediaSession", "failed to define navigator.mediaSession:", e);
    // fallback: direct assignment
    (navigator as unknown as { mediaSession: unknown }).mediaSession = polyfill;
  }

  // subscribe to native action events and route to stored handlers.
  void (async () => {
    try {
      listener = await addPluginListener(
        "android-media-session",
        "action",
        (ev: unknown) => {
          const e = ev as { action: string; positionMs?: number };
          console.log("[android-debug] native action received", {
            action: e.action,
            positionMs: e.positionMs,
            timestamp: Date.now(),
          });
          const key = String(e.action).toLowerCase();
          const handler = handlers.get(key);
          if (!handler) {
            debug("androidMediaSession", `no handler for native action "${e.action}"`);
            return;
          }
          const details: MediaSessionActionDetails = {
            action: key as MediaSessionAction,
          };
          if (e.positionMs != null) {
            (details as MediaSessionActionDetails & { seekTime?: number }).seekTime =
              e.positionMs / 1000;
          }
          try {
            handler(details);
          } catch (err) {
            debug("androidMediaSession", "handler threw:", err);
          }
        },
      );
    } catch (e) {
      debug("androidMediaSession", "failed to register plugin listener:", e);
    }
  })();

  installed = true;
  return true;
}

export function uninstallAndroidMediaSessionShim(): void {
  if (listener) {
    void listener.unregister();
    listener = null;
  }
  handlers.clear();
  installed = false;
}

// auto-install on module load (idempotent).
installAndroidMediaSessionShim();
