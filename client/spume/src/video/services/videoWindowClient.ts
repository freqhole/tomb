// client for charnel's separate gstreamer video window (linux only).
//
// webkitgtk cannot play video in a `<video>` element, so on linux video plays
// in its own window driven by gstreamer. this module is the IPC surface: it
// sends commands and turns the window's events back into the shape
// `VideoWindowBackend` needs.
//
// safe to import anywhere - every entry point degrades to "unavailable" off
// linux/charnel rather than throwing.

import { isCharnelMode } from "../../app/services/charnel/mode";
import { debug, warn } from "../../utils/logger";

/** mirrors `VideoCommand` in charnel's `video_window/backend.rs`. */
export type VideoWindowCommand =
  | { kind: "load"; path: string; title?: string | null; start_seconds?: number | null }
  | { kind: "play" }
  | { kind: "pause" }
  | { kind: "toggle_play" }
  | { kind: "seek"; seconds: number }
  | { kind: "set_volume"; volume: number }
  | { kind: "set_fullscreen"; fullscreen: boolean }
  | { kind: "toggle_fullscreen" }
  | { kind: "close" };

/** mirrors `VideoEvent` in charnel's `video_window/backend.rs`. */
export type VideoWindowEvent =
  | { kind: "duration"; seconds: number }
  | { kind: "position"; seconds: number }
  | { kind: "playing" }
  | { kind: "paused" }
  | { kind: "ended" }
  | { kind: "fullscreen"; fullscreen: boolean }
  | { kind: "closed" }
  | { kind: "error"; error_type: string; message: string };

const EVENT_NAME = "video-window-event";

type Listener = (event: VideoWindowEvent) => void;

const listeners = new Set<Listener>();
let unlistenPromise: Promise<() => void> | null = null;
let availability: boolean | null = null;

async function tauriInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  // eslint-disable-next-line no-restricted-syntax -- tauri-only api, avoid bundling into web builds
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

/**
 * whether this build can play video in a separate window. cached: the answer
 * is a compile-time property of the binary, so it cannot change at runtime.
 */
export async function isVideoWindowAvailable(): Promise<boolean> {
  if (availability !== null) return availability;
  if (!isCharnelMode()) {
    availability = false;
    return availability;
  }
  try {
    availability = await tauriInvoke<boolean>("video_window_available");
  } catch (e) {
    debug("videoWindow", "availability check failed, assuming unavailable:", e);
    availability = false;
  }
  return availability;
}

export async function sendVideoWindowCommand(command: VideoWindowCommand): Promise<void> {
  await tauriInvoke("video_window_command", { command });
}

/** subscribe to playback events from the video window. */
export function onVideoWindowEvent(listener: Listener): () => void {
  listeners.add(listener);
  void ensureSubscribed();
  return () => listeners.delete(listener);
}

async function ensureSubscribed(): Promise<void> {
  if (unlistenPromise) return;
  if (!(await isVideoWindowAvailable())) return;
  unlistenPromise = (async () => {
    // eslint-disable-next-line no-restricted-syntax -- tauri-only api, avoid bundling into web builds
    const { listen } = await import("@tauri-apps/api/event");
    return listen<VideoWindowEvent>(EVENT_NAME, (e) => {
      for (const fn of listeners) {
        try {
          fn(e.payload);
        } catch (err) {
          warn("videoWindow", "event listener threw:", err);
        }
      }
    });
  })();
  try {
    await unlistenPromise;
  } catch (e) {
    warn("videoWindow", "failed to subscribe to video window events:", e);
    unlistenPromise = null;
  }
}

/** for tests - drops cached availability and listeners. */
export function resetVideoWindowClientForTests(): void {
  availability = null;
  listeners.clear();
  unlistenPromise = null;
}
