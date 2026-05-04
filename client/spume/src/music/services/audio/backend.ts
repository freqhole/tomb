// player backend interface for spume.
//
// **what this is**: the typescript-side mirror of grimoire's
// `PlayerController` rust trait. every audio backend (the existing
// html-element one, the future tauri+rodio one, the eventual sibyl
// one) implements this interface. consumers (queue, ui, radio
// service) talk to a `PlayerBackend` and never to a specific
// implementation.
//
// **why now**: this is the keystone of the rodio integration plan
// (see `docs/rodio-into-freqhole-plan.md`). by getting the surface
// right at ~50 loc, the later work — runtime backend selection, the
// rodio adapter, mediasession routing — becomes mechanical.
//
// **wire types**: `PlayerCommand` and `PlayerEvent` come from the
// generated zod client (`@freqhole/api-client`). they're the same
// types the rust supervisor consumes/emits, so this interface is
// literally "send a command, observe the event stream."
//
// **important non-rule**: backends do NOT have to implement every
// command — e.g. the html backend can no-op `Status` since its
// state is observed via dom events. the supervisor is responsible
// for translating "command accepted" into observable events.

import type {
  PlayerCommand,
  PlayerEvent,
  PlayerSnapshot,
} from "freqhole-api-client";

/// listener registered via `PlayerBackend.subscribe`.
/// receives every event the backend emits, in order.
export type PlayerEventListener = (event: PlayerEvent) => void;

/// returned by `subscribe()` — call to remove the listener.
export type Unsubscribe = () => void;

/// the surface every audio backend implements.
///
/// implementations should be **safe to construct** without doing
/// any audio-device work (so the runtime selector can swap them
/// without surprise). actual init happens on the first command.
export interface PlayerBackend {
  /// the wire-format identifier — useful for logging + telemetry.
  /// one of: "html_audio" | "rodio" | "sibyl" | "dummy".
  readonly kind: BackendKind;

  /// dispatch a command. returns once the backend has accepted
  /// the command into its queue; observable effects arrive via
  /// the event stream.
  send(command: PlayerCommand): Promise<void>;

  /// subscribe to events. each subscriber gets every event.
  /// returns a function to remove the listener.
  subscribe(listener: PlayerEventListener): Unsubscribe;

  /// last-known state. cheap, synchronous, never throws. do not
  /// rely on this for hard correctness — observe events for that.
  /// for explicit refresh send `{ kind: "status" }`.
  snapshot(): PlayerSnapshot;

  /// release any owned resources (audio element, ipc channels,
  /// network sockets). idempotent.
  dispose(): Promise<void>;
}

export type BackendKind = "html_audio" | "rodio" | "sibyl" | "dummy";

/// initial snapshot for a freshly-constructed backend that hasn't
/// observed any events yet.
export const emptySnapshot: PlayerSnapshot = {
  state: null,
  position_ms: 0,
  total_ms: 0,
  volume: 1.0,
  queue_len: 0,
  current_index: null,
};
