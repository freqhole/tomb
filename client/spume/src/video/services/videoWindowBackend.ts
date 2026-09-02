// PlayerBackend that plays video in charnel's separate gstreamer window.
//
// linux only. the window owns decoding and display; this class is the adapter
// between spume's `PlayerBackend` surface (which the playerbar drives) and the
// window's command/event IPC. it deliberately owns no `<video>` element.

import {
  BackendPlaybackError,
  emptySnapshot,
  type BackendKind,
  type PlayerBackend,
  type PlayerEventListener,
  type LoadAndPlayOptions,
  type Unsubscribe,
} from "../../music/services/audio/backend";
import type { PlayerCommand, PlayerEvent, PlayerSnapshot } from "@freqhole/api-client";
import type { MediaItem } from "../../app/services/storage/mediaItem";
import { setCurrentSong } from "../../app/services/storage/db";
import { isMediaLoadCurrent } from "../../app/services/media/loadGuard";
import { debug, warn } from "../../utils/logger";
import { resolveLocalVideoPath } from "./localVideo";
import {
  onVideoWindowEvent,
  sendVideoWindowCommand,
  type VideoWindowEvent,
} from "./videoWindowClient";

// turns gstreamer's own error text (rarely more than "No such file or
// directory" / "Your GStreamer installation is missing a plug-in.") into a
// sentence naming the actual video and, where we have one, the path that
// was tried - `error_type` here is `classify_error()`'s output from
// `client/charnel/src-tauri/src/video_window/backend.rs`.
function friendlyErrorDetail(
  errorType: string,
  rawMessage: string,
  title: string | null,
  path: string | null
): string {
  const name = title ? `"${title}"` : "this video";
  switch (errorType) {
    case "file_not_found":
      return path
        ? `couldn't find the file for ${name} (looked for it at ${path})`
        : `couldn't find the file for ${name}`;
    case "permission_denied":
      return path
        ? `couldn't open ${name} — permission denied reading ${path}`
        : `couldn't open ${name} — permission denied`;
    case "missing_plugin":
      return `playing ${name} needs a GStreamer plugin that isn't installed (${rawMessage})`;
    default:
      return `couldn't play ${name}: ${rawMessage}`;
  }
}

export class VideoWindowBackend implements PlayerBackend {
  readonly kind: BackendKind = "video";

  private listeners = new Set<PlayerEventListener>();
  private unsubscribeWindow: (() => void) | null = null;
  private disposed = false;
  private snap: PlayerSnapshot = { ...emptySnapshot };
  private durationMs = 0;
  // title/path of whatever is currently loaded, kept only so an `error`
  // event (which carries just `error_type` + gstreamer's own raw message)
  // can be turned into a readable sentence - see `friendlyErrorDetail`.
  private currentTitle: string | null = null;
  private currentPath: string | null = null;

  constructor() {
    this.unsubscribeWindow = onVideoWindowEvent((e) => this.onWindowEvent(e));
  }

  async loadAndPlay(item: MediaItem, options?: LoadAndPlayOptions): Promise<void> {
    if (this.disposed) throw new Error("video window backend: used after dispose");
    if (item.kind !== "video") {
      throw new BackendPlaybackError(
        this.kind,
        "unsupported_media_kind",
        "the video window backend only plays video items"
      );
    }

    // gstreamer reads from the filesystem, so a browser blob/object url is no
    // use here - the item has to exist as a real file.
    const path = await resolveLocalVideoPath(item.video);
    if (!isMediaLoadCurrent(item.video.id, options?.loadGeneration)) {
      debug("videoWindowBackend", `skipping cancelled load for ${item.video.id}`);
      return;
    }
    if (!path) {
      // TEMP(video-window): distinguish a selector problem from an unavailable
      // local path in the next Linux playback log.
      console.info(`[video-window] load rejected: no local path for ${item.video.id}`);
      throw new BackendPlaybackError(
        this.kind,
        "no_local_path",
        `"${item.video.title}" has no local file for the video window to open`
      );
    }

    this.durationMs = 0;
    this.currentTitle = item.video.title;
    this.currentPath = path;
    // TEMP(video-window): proves the GStreamer branch received the video.
    console.info(`[video-window] loading ${item.video.id} from ${path}`);
    this.emit({ kind: "state", state: "loading" });

    // update app state - AppLayout/PlayerBar watch `current_sha256` to
    // decide whether the video-aware bar UI (title/images/waveform/"no song
    // playing") shows up; `videoBackend.ts` (the inline <video> path) already
    // does this, but this gstreamer-window path never did, so the playerbar
    // never knew a video was playing at all. see videoBackend.ts's identical
    // call for the full rationale.
    // TEMP(video-window): confirms current_sha256 actually gets set for the
    // gst path on the next linux build - remove once confirmed fixed.
    console.info(`[video-window] setCurrentSong(${item.video.id})`);
    await setCurrentSong(item.video.id);

    await sendVideoWindowCommand({
      kind: "load",
      path,
      title: item.video.title,
      start_seconds: options?.initialPosition ? options.initialPosition / 1000 : null,
    });
  }

  async send(command: PlayerCommand): Promise<void> {
    if (this.disposed) throw new Error("video window backend: send called after dispose");
    switch (command.kind) {
      case "play":
        return sendVideoWindowCommand({ kind: "play" });
      case "pause":
        return sendVideoWindowCommand({ kind: "pause" });
      case "stop":
        return sendVideoWindowCommand({ kind: "close" });
      case "seek":
        return sendVideoWindowCommand({ kind: "seek", seconds: command.ms / 1000 });
      case "set_volume": {
        const clamped = Math.max(0, Math.min(1, command.v));
        this.snap = { ...this.snap, volume: clamped };
        return sendVideoWindowCommand({ kind: "set_volume", volume: clamped });
      }
      case "status":
        this.emit({ kind: "state", state: this.snap.state ?? "stopped" });
        return;
      case "next":
      case "previous":
      case "load":
      case "enqueue":
        // queue traversal lives at the facade layer, same as the html backends
        this.emit({
          kind: "error",
          detail: {
            error_type: `${command.kind}_unsupported_in_video_window_backend`,
            title: "Unsupported",
            detail: "use loadAndPlay() or the queue facade instead.",
          },
        });
        return;
      default: {
        const _exhaustive: never = command;
        void _exhaustive;
      }
    }
  }

  subscribe(listener: PlayerEventListener): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  snapshot(): PlayerSnapshot {
    return this.snap;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
    this.unsubscribeWindow?.();
    this.unsubscribeWindow = null;
    try {
      await sendVideoWindowCommand({ kind: "close" });
    } catch (e) {
      debug("videoWindowBackend", "close on dispose failed (window may be gone):", e);
    }
  }

  private onWindowEvent(e: VideoWindowEvent): void {
    if (this.disposed) return;
    switch (e.kind) {
      case "duration":
        this.durationMs = e.seconds * 1000;
        this.emit({ kind: "progress", ms: 0, total_ms: this.durationMs });
        return;
      case "position":
        this.emit({ kind: "progress", ms: e.seconds * 1000, total_ms: this.durationMs });
        return;
      case "playing":
        this.snap = { ...this.snap, state: "playing" };
        this.emit({ kind: "state", state: "playing" });
        return;
      case "paused":
        this.snap = { ...this.snap, state: "paused" };
        this.emit({ kind: "state", state: "paused" });
        return;
      case "ended":
        this.snap = { ...this.snap, state: "stopped" };
        this.emit({ kind: "ended" });
        return;
      case "closed":
        // the user closed the window - treat it as stopping playback so the
        // playerbar doesn't keep showing a playing item
        this.snap = { ...this.snap, state: "stopped" };
        this.emit({ kind: "state", state: "stopped" });
        return;
      case "error":
        this.snap = { ...this.snap, state: "stopped" };
        this.emit({
          kind: "error",
          detail: {
            error_type: e.error_type,
            title: e.error_type === "missing_plugin" ? "missing codec" : "playback error",
            detail: friendlyErrorDetail(
              e.error_type,
              e.message,
              this.currentTitle,
              this.currentPath
            ),
          },
        });
        return;
      case "fullscreen":
        return;
      default: {
        const _exhaustive: never = e;
        void _exhaustive;
      }
    }
  }

  private emit(event: PlayerEvent): void {
    for (const fn of this.listeners) {
      try {
        fn(event);
      } catch (err) {
        warn("videoWindowBackend", "listener threw:", err);
      }
    }
  }
}
