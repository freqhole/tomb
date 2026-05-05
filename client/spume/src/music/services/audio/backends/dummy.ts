// dummy backend — accepts every command, emits no events.
//
// used by tests and by callers that need a `PlayerBackend` handle
// before the real one is wired up. mirrors grimoire's
// `NoopPlayerController` rust impl.

import type {
  PlayerCommand,
  PlayerEvent,
  PlayerSnapshot,
} from "freqhole-api-client";
import {
  emptySnapshot,
  type BackendKind,
  type LoadAndPlayOptions,
  type PlayerBackend,
  type PlayerEventListener,
  type Unsubscribe,
} from "../backend";
import type { Song } from "../../storage/types";

export class DummyBackend implements PlayerBackend {
  readonly kind: BackendKind = "dummy";

  private listeners = new Set<PlayerEventListener>();
  private snap: PlayerSnapshot = emptySnapshot;

  // exposed for tests so they can poke an event through without
  // actually playing audio.
  emit(event: PlayerEvent): void {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        // listeners must not throw; if one does, drop it on the floor
        // rather than letting it interfere with the other subscribers.
      }
    }
  }

  async send(_cmd: PlayerCommand): Promise<void> {
    /* no-op */
  }

  async loadAndPlay(_song: Song, _options?: LoadAndPlayOptions): Promise<void> {
    /* no-op */
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
    this.listeners.clear();
  }
}
