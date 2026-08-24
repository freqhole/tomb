// VideoBackend — owns the `<video>` element for video playback. mirrors
// `music/services/audio/backends/htmlAudio.ts`'s structure (dom element +
// event -> PlayerEvent translation) but implements `PlayerBackend` for
// `kind: "video"` items only. the facade (`music/services/audio/player.ts`)
// swaps `activeBackend` to this instance whenever the current queue item
// is a video, then swaps back to the audio backend for songs — reusing
// `playerStateSync`/`bindAutoAdvance`/`PlayerBar` bindings unchanged since
// those all operate on the backend-agnostic `PlayerEvent` wire protocol.

import type { PlayerCommand, PlayerEvent, PlayerSnapshot } from "@freqhole/api-client";
import {
  BackendPlaybackError,
  emptySnapshot,
  type BackendKind,
  type LoadAndPlayOptions,
  type PlayerBackend,
  type PlayerEventListener,
  type Unsubscribe,
} from "../../music/services/audio/backend";
import type { MediaItem } from "../../app/services/storage/mediaItem";
import { getVideoURL } from "./videoBlobAccess";
import { error as errorLog } from "../../utils/logger";

export class VideoBackend implements PlayerBackend {
  readonly kind: BackendKind = "video";

  private videoElement: HTMLVideoElement | null = null;
  private currentVideoId: string | null = null;
  private listeners = new Set<PlayerEventListener>();
  private snap: PlayerSnapshot = { ...emptySnapshot };
  private disposed = false;

  /** the owned `<video>` element — PlayerBar mounts this into the DOM
   * when a video item is active. lazily created on first access. */
  element(): HTMLVideoElement {
    return this.initVideo();
  }

  /** currently loaded video's id, if any — lets the UI confirm the
   * mounted element matches the active queue item. */
  currentId(): string | null {
    return this.currentVideoId;
  }

  async send(command: PlayerCommand): Promise<void> {
    if (this.disposed) {
      throw new Error("video backend: send called after dispose");
    }
    const video = this.initVideo();
    switch (command.kind) {
      case "play":
        await video.play();
        return;
      case "pause":
        video.pause();
        return;
      case "stop":
        video.pause();
        video.currentTime = 0;
        this.emit({ kind: "state", state: "stopped" });
        this.emit({ kind: "progress", ms: 0, total_ms: 0 });
        return;
      case "seek":
        video.currentTime = Math.max(0, Math.min(command.ms / 1000, video.duration || 0));
        return;
      case "set_volume": {
        const clamped = Math.max(0, Math.min(1, command.v));
        video.volume = clamped;
        this.snap = { ...this.snap, volume: clamped };
        return;
      }
      case "status":
        this.emit({ kind: "state", state: this.snap.state ?? "stopped" });
        return;
      case "next":
      case "previous":
      case "load":
      case "enqueue":
        // queue traversal / raw-path loads live at the facade layer,
        // same convention as the html audio backend.
        this.emit({
          kind: "error",
          detail: {
            error_type: `${command.kind}_unsupported_in_video_backend`,
            title: "Unsupported",
            detail:
              "the video backend doesn't handle this command via the wire " +
              "interface; use loadAndPlay() or the queue facade instead.",
          },
        });
        return;
      default: {
        // exhaustiveness check — surfaces new PlayerCommand variants.
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
    if (this.videoElement) {
      try {
        this.videoElement.pause();
        this.videoElement.removeAttribute("src");
      } catch {
        // ignore
      }
      this.videoElement = null;
    }
  }

  async loadAndPlay(item: MediaItem, options?: LoadAndPlayOptions): Promise<void> {
    if (item.kind !== "video") {
      throw new BackendPlaybackError(
        this.kind,
        "unsupported_media_kind",
        "the video backend can only play video items"
      );
    }
    const video = item.video;
    const el = this.initVideo();

    this.emit({ kind: "state", state: "loading" });

    let url: string;
    try {
      url = await getVideoURL(video);
    } catch (err) {
      errorLog(
        "player.video",
        `getVideoURL failed for "${video.title}":`,
        err instanceof Error ? err.message : err
      );
      this.emit({ kind: "state", state: "stopped" });
      throw err;
    }

    this.currentVideoId = video.id;
    el.src = url;

    const initialPositionSec = options?.initialPosition ?? 0;
    if (initialPositionSec > 0) {
      const seekOnMetadata = () => {
        try {
          el.currentTime = initialPositionSec;
        } catch {
          // ignore — invalid duration / browser quirk
        }
      };
      el.addEventListener("loadedmetadata", seekOnMetadata, { once: true });
    }

    const shouldPlay = options?.autoPlay !== false;
    if (shouldPlay) {
      try {
        await el.play();
      } catch (playError) {
        errorLog(
          "player.video",
          `video.play() rejected for "${video.title}":`,
          playError instanceof Error ? playError.message : playError
        );
        this.emit({
          kind: "state",
          state: el.paused ? (el.currentTime > 0 ? "paused" : "stopped") : "playing",
        });
        throw playError;
      }
    } else {
      el.load();
      this.emit({ kind: "state", state: "paused" });
    }
  }

  private emit(event: PlayerEvent): void {
    this.applyToSnapshot(event);
    for (const l of this.listeners) {
      try {
        l(event);
      } catch (e) {
        errorLog("player.video", "event listener threw:", e);
      }
    }
  }

  private applyToSnapshot(event: PlayerEvent): void {
    switch (event.kind) {
      case "state":
        this.snap = { ...this.snap, state: event.state };
        break;
      case "progress":
        this.snap = {
          ...this.snap,
          position_ms: event.ms,
          total_ms: event.total_ms,
        };
        break;
      case "ended":
        this.snap = { ...this.snap, position_ms: 0, current_index: null };
        break;
      default:
        break;
    }
  }

  private initVideo(): HTMLVideoElement {
    if (this.videoElement) return this.videoElement;

    const video = document.createElement("video");
    this.videoElement = video;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");

    video.addEventListener("timeupdate", () => {
      const ct = video.currentTime;
      const dur = Number.isFinite(video.duration) ? video.duration : 0;
      this.emit({
        kind: "progress",
        ms: Math.round(ct * 1000),
        total_ms: Math.round(dur * 1000),
      });
    });

    video.addEventListener("loadedmetadata", () => {
      this.emit({
        kind: "progress",
        ms: Math.round(video.currentTime * 1000),
        total_ms: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : 0,
      });
    });

    video.addEventListener("play", () => {
      this.emit({ kind: "state", state: "playing" });
    });

    video.addEventListener("pause", () => {
      this.emit({
        kind: "state",
        state: video.currentTime > 0 ? "paused" : "stopped",
      });
    });

    video.addEventListener("ended", () => {
      this.emit({ kind: "ended" });
    });

    video.addEventListener("error", () => {
      const error = video.error;
      this.emit({
        kind: "error",
        detail: {
          error_type: "video_element_error",
          title: "Video Element Error",
          detail: error
            ? `media error code: ${error.code}, message: ${error.message}`
            : "unknown <video> element error",
        },
      });
    });

    video.addEventListener("waiting", () => {
      this.emit({ kind: "state", state: "loading" });
    });

    video.addEventListener("canplay", () => {
      this.emit({
        kind: "state",
        state: video.paused ? (video.currentTime > 0 ? "paused" : "stopped") : "playing",
      });
    });

    return video;
  }
}
