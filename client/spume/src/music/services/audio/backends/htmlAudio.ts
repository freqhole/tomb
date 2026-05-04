// html `<audio>` backend — thin wrapper around the long-standing
// imperative api in `../player.ts` so `selectBackend()` can return
// it instead of forcing the rest of the app to import player.ts
// directly.
//
// **status: bridge, not extraction.** the real implementation still
// lives in `../player.ts` (1k+ loc of queue / cache / mediasession
// glue we don't want to disturb). this class:
//
// - lets `selectBackend()` hand back a `PlayerBackend` for the
//   non-rodio path so callers can be uniform
// - maps the `PlayerCommand` enum onto the existing function exports
// - bridges the existing solid signals (`isPlaying`, `currentTime`,
//   `duration`, `volume`) to the `PlayerEvent` stream
//
// **awkward bit**: `PlayerCommand::Load { paths }` is rodio-shaped
// (a list of filesystem paths). the html path takes `Song` objects
// from the queue layer instead — there's no clean mapping yet. we
// surface a structured error event when `Load` is dispatched here
// so callers know to keep using `playSong()` directly until the
// command contract grows a song-id variant.

import type {
  PlayerCommand,
  PlayerEvent,
  PlayerSnapshot,
} from "freqhole-api-client";
import {
  emptySnapshot,
  type BackendKind,
  type PlayerBackend,
  type PlayerEventListener,
  type Unsubscribe,
} from "../backend";
import {
  pause as htmlPause,
  play as htmlPlay,
  playNext as htmlPlayNext,
  playPrevious as htmlPlayPrevious,
  seek as htmlSeek,
  setPlayerVolume as htmlSetVolume,
  stop as htmlStop,
} from "../player";
import {
  currentTime,
  duration,
  isPlaying,
  volume,
} from "../playerState";
import { createEffect, createRoot, on } from "solid-js";

export class HtmlAudioBackend implements PlayerBackend {
  readonly kind: BackendKind = "html_audio";

  private listeners = new Set<PlayerEventListener>();
  private snap: PlayerSnapshot = { ...emptySnapshot };
  private disposeRoot: (() => void) | null = null;
  private disposed = false;

  async send(command: PlayerCommand): Promise<void> {
    if (this.disposed) {
      throw new Error("html_audio backend: send called after dispose");
    }

    switch (command.kind) {
      case "play":
        await htmlPlay();
        return;
      case "pause":
        htmlPause();
        return;
      case "stop":
        htmlStop();
        return;
      case "next":
        await htmlPlayNext();
        return;
      case "previous":
        await htmlPlayPrevious();
        return;
      case "seek":
        // rodio reports + accepts position in milliseconds; the html
        // path uses seconds. round-trip via division.
        htmlSeek(command.ms / 1000);
        return;
      case "set_volume":
        htmlSetVolume(command.v);
        return;
      case "status":
        // `snapshot()` is the read path; `status` exists in the
        // command stream so remote ALPN clients can ask for a fresh
        // snapshot. emit the cached snapshot back through the event
        // stream so the caller observes a fresh state event.
        this.emit({ kind: "state", state: this.snap.state ?? "stopped" });
        return;
      case "load":
        // see the file header — paths-vs-Song mismatch. emit a
        // structured error event rather than silently dropping.
        this.emit({
          kind: "error",
          detail: {
            error_type: "load_unsupported_in_html_backend",
            title: "Load Unsupported",
            detail:
              "the html audio backend doesn't accept raw file paths; " +
              "use the queue / playSong() flow instead, or switch to " +
              "the rodio backend in settings.",
          },
        });
        return;
      default: {
        // exhaustiveness check — if a new variant lands in
        // grimoire and we forget here, ts will surface it.
        const _exhaustive: never = command;
        void _exhaustive;
        return;
      }
    }
  }

  subscribe(listener: PlayerEventListener): Unsubscribe {
    this.listeners.add(listener);
    this.ensureBridge();
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
    if (this.disposeRoot) {
      this.disposeRoot();
      this.disposeRoot = null;
    }
  }

  private ensureBridge(): void {
    if (this.disposeRoot || this.disposed) return;

    // own the solid effects in a detached root so we can dispose
    // them when the backend is swapped. without this they'd leak
    // for the life of the app.
    createRoot((dispose) => {
      this.disposeRoot = dispose;

      // playing state ⇒ State + Progress events
      createEffect(
        on(isPlaying, (playing) => {
          const next = playing ? "playing" : (currentTime() > 0 ? "paused" : "stopped");
          this.snap = { ...this.snap, state: next };
          this.emit({ kind: "state", state: next });
        }),
      );

      // currentTime + duration ⇒ Progress events. throttling is
      // already handled upstream (player.ts updates the signal at
      // ~4hz via the `<audio>` `timeupdate` event).
      createEffect(
        on([currentTime, duration], ([t, d]) => {
          const ms = Math.round((t as number) * 1000);
          const total_ms = Math.round((d as number) * 1000);
          this.snap = {
            ...this.snap,
            position_ms: ms,
            total_ms,
          };
          this.emit({
            kind: "progress",
            ms,
            total_ms,
          });
        }),
      );

      // volume ⇒ State refresh (no dedicated volume event in the
      // wire format; snapshot tracks the new value).
      createEffect(
        on(volume, (v) => {
          this.snap = { ...this.snap, volume: v };
        }),
      );
    });
  }

  private emit(ev: PlayerEvent): void {
    for (const l of this.listeners) {
      try {
        l(ev);
      } catch {
        // listener errors must not break event distribution.
      }
    }
  }
}
