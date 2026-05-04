// rodio backend — talks to the supervised rust audio thread
// inside the charnel tauri host.
//
// commands go out via `invoke("player_send", { cmd })`, events come
// in via `listen("freqhole:player_event", ...)`. the wire types are
// generated from grimoire by `client-codegen` and live in the
// `freqhole-api-client` package, so this file is largely glue.
//
// **only safe to construct in tauri mode** — the html or dummy
// backend should be selected when `isCharnelMode()` is false. see
// `audio/select.ts`.

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

// matches `PLAYER_EVENT` in client/charnel/src-tauri/src/player_commands.rs.
// keep these two strings in sync — there's no shared header to lean on.
const TAURI_EVENT = "freqhole:player_event";

type UnlistenFn = () => void;

/// rodio-via-tauri backend.
///
/// the constructor is cheap (no ipc); the tauri `listen` subscription
/// is set up lazily on the first `subscribe()` call so a backend that
/// was constructed but never used (e.g. by an aborted backend swap)
/// doesn't leak an event handler.
export class RodioBackend implements PlayerBackend {
  readonly kind: BackendKind = "rodio";

  private listeners = new Set<PlayerEventListener>();
  private snap: PlayerSnapshot = emptySnapshot;
  private unlistenPromise: Promise<UnlistenFn> | null = null;
  private disposed = false;

  async send(cmd: PlayerCommand): Promise<void> {
    if (this.disposed) {
      throw new Error("rodio backend: send called after dispose");
    }
    const { invoke } = await import("@tauri-apps/api/core");
    // tauri serializes the second arg as a json object; we need the
    // host-side `cmd: PlayerCommand` parameter name to match.
    await invoke("player_send", { cmd });
  }

  subscribe(listener: PlayerEventListener): Unsubscribe {
    this.listeners.add(listener);
    void this.ensureListening();
    return () => {
      this.listeners.delete(listener);
    };
  }

  snapshot(): PlayerSnapshot {
    return this.snap;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.listeners.clear();
    if (this.unlistenPromise) {
      try {
        const unlisten = await this.unlistenPromise;
        unlisten();
      } catch {
        // swallow — disposal is best-effort.
      }
      this.unlistenPromise = null;
    }
  }

  // set up the tauri event listener exactly once. concurrent callers
  // share the same in-flight `listen()` promise.
  private ensureListening(): void {
    if (this.unlistenPromise || this.disposed) {
      return;
    }
    this.unlistenPromise = (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      return listen<PlayerEvent>(TAURI_EVENT, (envelope) => {
        const event = envelope.payload;
        this.applyToSnapshot(event);
        for (const l of this.listeners) {
          try {
            l(event);
          } catch (e) {
            // listeners must not throw; isolate them so a single bad
            // subscriber doesn't break the rest of the chain.
            console.error("[rodio backend] listener threw:", e);
          }
        }
      });
    })();
  }

  // mirror of grimoire's `PlayerSnapshot::apply` so spume callers
  // that read `snapshot()` get fresh data without an extra round-trip.
  // keep this in sync with grimoire/src/player/control.rs.
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
      case "track_changed":
        this.snap = {
          ...this.snap,
          current_index: event.index,
        };
        break;
      case "ended":
        this.snap = {
          ...this.snap,
          position_ms: 0,
          current_index: null,
        };
        break;
      case "error":
      case "backend_down":
      case "backend_up":
        // these don't shift snapshot fields directly; ui consumers
        // observe them via the listener stream.
        break;
    }
  }
}
