/**
 * singleton audio manager for skein media playback.
 *
 * manages a single <audio> DOM element and provides a clean event-driven API
 * for playback control. designed for the upcoming playlist widget but usable
 * by any widget that needs audio playback.
 *
 * key design decisions:
 * - single audio element: only one track plays at a time. starting a new track
 *   stops the previous one. this matches how music players work and avoids
 *   resource contention.
 * - event-based: listeners subscribe to typed events (play, pause, timeupdate,
 *   ended, error, loading, loaded). widgets react to state changes rather than
 *   polling.
 * - blob URL lifecycle: integrates with media-urls.ts for platform-aware URL
 *   resolution. callers can pass a blobId and the manager resolves it.
 * - DOM element is created lazily on first play and reused for all subsequent
 *   playback. it's hidden (not appended to visible DOM) but still functional.
 */

import { getMediaPlaybackUrl, revokeMediaUrl, type MediaUrlOptions } from "./media-urls";

const TAG = "[audio-manager]";

// ---------------------------------------------------------------------------
// event types
// ---------------------------------------------------------------------------

export interface AudioTimeUpdate {
  currentTime: number;
  duration: number;
  /** 0–1 progress fraction (0 if duration is unknown) */
  progress: number;
}

export interface AudioError {
  message: string;
  code?: number;
}

export type AudioEventMap = {
  /** playback started or resumed */
  play: void;
  /** playback paused */
  pause: void;
  /** playback stopped (track unloaded) */
  stop: void;
  /** track finished playing */
  ended: void;
  /** periodic time update (~4 Hz) */
  timeupdate: AudioTimeUpdate;
  /** loading a new track (before audio data is ready) */
  loading: { blobId: string };
  /** track loaded and ready to play */
  loaded: { blobId: string; duration: number };
  /** playback error */
  error: AudioError;
  /** volume changed */
  volumechange: { volume: number; muted: boolean };
};

type AudioEventKey = keyof AudioEventMap;
type AudioEventHandler<K extends AudioEventKey> = (data: AudioEventMap[K]) => void;

// ---------------------------------------------------------------------------
// playback state
// ---------------------------------------------------------------------------

export interface AudioPlaybackState {
  /** currently loaded blob ID (empty string if nothing loaded) */
  blobId: string;
  /** whether audio is currently playing */
  isPlaying: boolean;
  /** whether a track is currently loading */
  isLoading: boolean;
  /** current playback position in seconds */
  currentTime: number;
  /** total duration in seconds (0 if unknown) */
  duration: number;
  /** volume 0–1 */
  volume: number;
  /** whether audio is muted */
  muted: boolean;
}

// ---------------------------------------------------------------------------
// audio manager
// ---------------------------------------------------------------------------

class AudioManagerImpl {
  private el: HTMLAudioElement | null = null;
  private currentBlobId = "";
  private currentSrc = "";
  private _isLoading = false;

  // event listeners
  private listeners = new Map<AudioEventKey, Set<AudioEventHandler<any>>>();

  // bound handlers for DOM events (stored so we can remove them)
  private boundHandlers: Record<string, (e: Event) => void> = {};

  // ---------------------------------------------------------------------------
  // lazy element creation
  // ---------------------------------------------------------------------------

  private ensureElement(): HTMLAudioElement {
    if (this.el) return this.el;

    const audio = document.createElement("audio");
    audio.preload = "auto";

    // wire up DOM events to our event system
    this.boundHandlers = {
      play: () => this.emit("play", undefined as void),
      pause: () => {
        // don't emit pause when we're about to load a new track
        if (!this._isLoading) {
          this.emit("pause", undefined as void);
        }
      },
      ended: () => {
        this.emit("ended", undefined as void);
      },
      timeupdate: () => {
        const ct = audio.currentTime;
        const dur = audio.duration || 0;
        this.emit("timeupdate", {
          currentTime: ct,
          duration: dur,
          progress: dur > 0 ? ct / dur : 0,
        });
      },
      error: () => {
        const err = audio.error;
        this.emit("error", {
          message: err?.message ?? "unknown audio error",
          code: err?.code,
        });
      },
      loadedmetadata: () => {
        this._isLoading = false;
        this.emit("loaded", {
          blobId: this.currentBlobId,
          duration: audio.duration || 0,
        });
      },
      volumechange: () => {
        this.emit("volumechange", {
          volume: audio.volume,
          muted: audio.muted,
        });
      },
    };

    for (const [event, handler] of Object.entries(this.boundHandlers)) {
      audio.addEventListener(event, handler);
    }

    this.el = audio;
    return audio;
  }

  // ---------------------------------------------------------------------------
  // public: playback control
  // ---------------------------------------------------------------------------

  /**
   * load and play a track by blob ID.
   *
   * resolves the blob to a playable URL using the platform-aware media-urls
   * module, then starts playback. if a different track is already playing,
   * it's stopped first.
   *
   * @param blobId - the blob ID to play
   * @param options - media URL resolution options (peers, mime hint)
   * @returns true if playback started, false if the blob couldn't be resolved
   */
  async playBlob(blobId: string, options: MediaUrlOptions = {}): Promise<boolean> {
    // if same blob is already loaded and paused, just resume
    if (blobId === this.currentBlobId && this.el && this.el.paused && this.currentSrc) {
      try {
        await this.el.play();
        return true;
      } catch (err) {
        console.warn(TAG, "resume failed:", err);
        // fall through to full reload
      }
    }

    this._isLoading = true;
    this.emit("loading", { blobId });

    const url = await getMediaPlaybackUrl(blobId, {
      ...options,
      category: "audio",
    });

    if (!url) {
      this._isLoading = false;
      this.emit("error", { message: `could not resolve blob: ${blobId.slice(0, 8)}...` });
      return false;
    }

    const audio = this.ensureElement();

    // stop current playback
    audio.pause();

    // set new source
    this.currentBlobId = blobId;
    this.currentSrc = url;
    audio.src = url;
    audio.load();

    try {
      await audio.play();
      return true;
    } catch (err) {
      console.warn(TAG, "play failed:", err);
      this._isLoading = false;
      this.emit("error", {
        message: err instanceof Error ? err.message : "playback failed",
      });
      return false;
    }
  }

  /**
   * play from a direct URL (data:, blob:, or https:).
   * use this when you already have a resolved URL and don't need blob lookup.
   */
  async playUrl(url: string, label?: string): Promise<boolean> {
    this._isLoading = true;
    this.emit("loading", { blobId: label ?? "" });

    const audio = this.ensureElement();
    audio.pause();

    this.currentBlobId = label ?? "";
    this.currentSrc = url;
    audio.src = url;
    audio.load();

    try {
      await audio.play();
      return true;
    } catch (err) {
      console.warn(TAG, "playUrl failed:", err);
      this._isLoading = false;
      this.emit("error", {
        message: err instanceof Error ? err.message : "playback failed",
      });
      return false;
    }
  }

  /** pause playback (keeps current position) */
  pause(): void {
    this.el?.pause();
  }

  /** resume playback from current position */
  async resume(): Promise<boolean> {
    if (!this.el || !this.currentSrc) return false;
    try {
      await this.el.play();
      return true;
    } catch (err) {
      console.warn(TAG, "resume failed:", err);
      return false;
    }
  }

  /** toggle play/pause */
  async togglePlayPause(): Promise<boolean> {
    if (!this.el || !this.currentSrc) return false;
    if (this.el.paused) {
      return this.resume();
    } else {
      this.pause();
      return true;
    }
  }

  /** stop playback and unload the current track */
  stop(): void {
    if (!this.el) return;

    this.el.pause();
    this.el.removeAttribute("src");
    this.el.load();

    this.currentBlobId = "";
    this.currentSrc = "";
    this._isLoading = false;

    // revoke any tracked audio blob URL (linux workaround)
    revokeMediaUrl("audio");

    this.emit("stop", undefined as void);
  }

  /**
   * seek to a specific time in seconds.
   * clamps to [0, duration].
   */
  seek(time: number): void {
    if (!this.el) return;
    const dur = this.el.duration || 0;
    this.el.currentTime = Math.max(0, Math.min(time, dur));
  }

  /**
   * seek to a progress fraction (0–1).
   * e.g. seekProgress(0.5) seeks to the midpoint.
   */
  seekProgress(fraction: number): void {
    if (!this.el) return;
    const dur = this.el.duration || 0;
    if (dur > 0) {
      this.el.currentTime = Math.max(0, Math.min(fraction, 1)) * dur;
    }
  }

  /** set volume (0–1) */
  setVolume(volume: number): void {
    const audio = this.ensureElement();
    audio.volume = Math.max(0, Math.min(1, volume));
  }

  /** toggle mute */
  toggleMute(): void {
    const audio = this.ensureElement();
    audio.muted = !audio.muted;
  }

  /** set muted state */
  setMuted(muted: boolean): void {
    const audio = this.ensureElement();
    audio.muted = muted;
  }

  // ---------------------------------------------------------------------------
  // public: state queries
  // ---------------------------------------------------------------------------

  /** get a snapshot of the current playback state */
  getState(): AudioPlaybackState {
    const audio = this.el;
    return {
      blobId: this.currentBlobId,
      isPlaying: audio ? !audio.paused && !audio.ended : false,
      isLoading: this._isLoading,
      currentTime: audio?.currentTime ?? 0,
      duration: audio?.duration ?? 0,
      volume: audio?.volume ?? 1,
      muted: audio?.muted ?? false,
    };
  }

  /** check if a specific blob is currently loaded */
  isCurrentBlob(blobId: string): boolean {
    return this.currentBlobId === blobId;
  }

  /** check if audio is currently playing */
  get isPlaying(): boolean {
    return this.el ? !this.el.paused && !this.el.ended : false;
  }

  /** get the currently loaded blob ID (empty string if none) */
  get currentBlob(): string {
    return this.currentBlobId;
  }

  // ---------------------------------------------------------------------------
  // public: event system
  // ---------------------------------------------------------------------------

  /**
   * subscribe to an audio event.
   * returns an unsubscribe function.
   */
  on<K extends AudioEventKey>(event: K, handler: AudioEventHandler<K>): () => void {
    let handlers = this.listeners.get(event);
    if (!handlers) {
      handlers = new Set();
      this.listeners.set(event, handlers);
    }
    handlers.add(handler);

    return () => {
      handlers!.delete(handler);
      if (handlers!.size === 0) {
        this.listeners.delete(event);
      }
    };
  }

  /**
   * subscribe to an audio event, automatically unsubscribing after one call.
   */
  once<K extends AudioEventKey>(event: K, handler: AudioEventHandler<K>): () => void {
    const unsub = this.on(event, ((data: AudioEventMap[K]) => {
      unsub();
      handler(data);
    }) as AudioEventHandler<K>);
    return unsub;
  }

  /** remove all listeners for a specific event, or all events if none specified */
  off(event?: AudioEventKey): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  // ---------------------------------------------------------------------------
  // public: cleanup
  // ---------------------------------------------------------------------------

  /**
   * fully tear down the audio manager.
   * stops playback, removes the DOM element, clears all listeners.
   * the manager can be reused after destroy — a new element will be created
   * on the next play call.
   */
  destroy(): void {
    this.stop();

    if (this.el) {
      // remove DOM event listeners
      for (const [event, handler] of Object.entries(this.boundHandlers)) {
        this.el.removeEventListener(event, handler);
      }
      this.el = null;
    }

    this.boundHandlers = {};
    this.listeners.clear();
  }

  // ---------------------------------------------------------------------------
  // internal: emit events
  // ---------------------------------------------------------------------------

  private emit<K extends AudioEventKey>(event: K, data: AudioEventMap[K]): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        handler(data);
      } catch (err) {
        console.error(TAG, `error in ${event} handler:`, err);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// singleton export
// ---------------------------------------------------------------------------

/**
 * the global audio manager instance.
 *
 * usage:
 *   import { audioManager } from "../media";
 *   await audioManager.playBlob(blobId);
 *   audioManager.on("timeupdate", ({ progress }) => updateSeekBar(progress));
 *   audioManager.on("ended", () => playNextTrack());
 */
export const audioManager = new AudioManagerImpl();
