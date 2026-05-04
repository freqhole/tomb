// playerStateSync — single owner of the playback signals
// (`isPlaying`, `currentTime`, `duration`, `isLoading`).
//
// **why**: backends used to write these signals directly from their
// dom event handlers, which made it impossible to add a second
// backend without either duplicating the logic or having two writers
// race each other. now backends only emit `PlayerEvent`s; this
// service translates them into signal writes.
//
// **swap behavior**: `bindActiveBackend(backend)` unsubscribes from
// the previous backend and subscribes to the new one. the facade
// calls this from `swapPlayerBackend()` so the active backend is
// always the (single) writer.
//
// **not in scope**: app-level state (`currentSong`, `pendingUpNext`,
// `playQueue`) — those are written by the queue / facade directly.
// volume — there's no `volume` PlayerEvent, so the facade writes the
// `volume` signal as part of `setPlayerVolume()` and forwards the
// command to the active backend.

import type { PlayerEvent } from "freqhole-api-client";
import type { PlayerBackend, Unsubscribe } from "./backend";
import {
  setCurrentTime,
  setDuration,
  setIsLoading,
  setIsPlaying,
} from "./playerState";

let currentUnsubscribe: Unsubscribe | null = null;

/**
 * subscribe to a backend's event stream and start mirroring its
 * events into the playback signals. unsubscribes from any
 * previously-bound backend first.
 *
 * idempotent: passing the same backend twice will rebind (cheap).
 */
export function bindActiveBackend(backend: PlayerBackend): void {
  if (currentUnsubscribe) {
    try {
      currentUnsubscribe();
    } catch {
      // disposal must not throw — swallow + continue.
    }
    currentUnsubscribe = null;
  }
  currentUnsubscribe = backend.subscribe(applyEvent);
}

/**
 * tear down the active subscription. used at app shutdown / tests.
 */
export function unbindActiveBackend(): void {
  if (!currentUnsubscribe) return;
  try {
    currentUnsubscribe();
  } catch {
    // ignore
  }
  currentUnsubscribe = null;
}

function applyEvent(event: PlayerEvent): void {
  switch (event.kind) {
    case "state": {
      // map the four wire states onto the two boolean signals
      // (isPlaying + isLoading). "stopped" and "paused" both clear
      // isPlaying; isLoading is its own bit so the UI can show a
      // spinner without lying about playback.
      switch (event.state) {
        case "playing":
          setIsLoading(false);
          setIsPlaying(true);
          return;
        case "paused":
          setIsLoading(false);
          setIsPlaying(false);
          return;
        case "stopped":
          setIsLoading(false);
          setIsPlaying(false);
          return;
        case "loading":
          setIsLoading(true);
          return;
        case null:
        case undefined:
          return;
      }
      return;
    }
    case "progress": {
      // wire is in milliseconds; signals are in seconds.
      setCurrentTime(event.ms / 1000);
      if (event.total_ms > 0) {
        setDuration(event.total_ms / 1000);
      }
      return;
    }
    case "ended": {
      // backends are responsible for emitting an explicit `state`
      // event before/after `ended` if they want to clear isPlaying;
      // we don't infer it here so that "ended → auto-advance to next
      // track" can keep isPlaying true through the transition.
      setCurrentTime(0);
      return;
    }
    case "track_changed":
    case "error":
    case "backend_down":
    case "backend_up":
      // these don't shift the playback signals directly; ui layers
      // observe them via their own subscriptions if needed.
      return;
  }
}
