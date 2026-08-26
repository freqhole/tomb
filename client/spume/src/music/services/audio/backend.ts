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

import type { PlayerCommand, PlayerEvent, PlayerSnapshot } from "@freqhole/api-client";
import type { MediaItem } from "../../../app/services/storage/mediaItem";

/// listener registered via `PlayerBackend.subscribe`.
/// receives every event the backend emits, in order.
export type PlayerEventListener = (event: PlayerEvent) => void;

/// returned by `subscribe()` — call to remove the listener.
export type Unsubscribe = () => void;

/// options accepted by `loadAndPlay`. all backends honor what they
/// can and silently ignore the rest — e.g. `initialPosition`/
/// `initialDuration` are useful for restoring a paused session on
/// page reload.
///
/// **gate semantics**: `userInitiated` and `autoPlay` are independent.
/// `userInitiated` reflects "the user intentionally caused this load"
/// (used by the facade to decide whether to clear the pause gate +
/// silence radio); `autoPlay` reflects "should the backend start
/// audio playback after loading" (the facade computes this from its
/// pause gate + the `userInitiated` flag and passes the result through).
/// backends with no concept of "load without playing" can ignore
/// `autoPlay` entirely — the facade will issue a follow-up `pause`
/// command if needed. defaults to `true` when omitted.
export interface LoadAndPlayOptions {
  userInitiated?: boolean;
  initialPosition?: number;
  initialDuration?: number;
  autoPlay?: boolean;
}

/// the surface every audio backend implements.
///
/// implementations should be **safe to construct** without doing
/// any audio-device work (so the runtime selector can swap them
/// without surprise). actual init happens on the first command.
export interface PlayerBackend {
  /// the wire-format identifier — useful for logging + telemetry.
  /// one of: "html_audio" | "rodio" | "sibyl" | "dummy".
  readonly kind: BackendKind;

  /// load a media item (song or video) and start playing it. spume's
  /// higher-level entry point — the html backend resolves a blob/http
  /// url and feeds the `<audio>` element for `kind: "song"` items; the
  /// video backend does the same for `kind: "video"` items via a
  /// `<video>` element. a backend that can't handle the given item's
  /// kind throws `BackendPlaybackError` with `error_type:
  /// "unsupported_media_kind"`.
  ///
  /// throws a `BackendPlaybackError` (with `error_type` set to e.g.
  /// `"no_local_path"`) when the backend can't play a given item;
  /// callers can introspect to choose a fallback or surface a toast.
  loadAndPlay(item: MediaItem, options?: LoadAndPlayOptions): Promise<void>;

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

/// thrown by `PlayerBackend.loadAndPlay` when the backend can't
/// play the song it was given. the `error_type` discriminant lets
/// callers branch on the reason (e.g. fall back to html when rodio
/// reports `no_local_path`).
export class BackendPlaybackError extends Error {
  readonly error_type: string;
  readonly backend: BackendKind;

  constructor(backend: BackendKind, error_type: string, message: string) {
    super(`[${backend}] ${error_type}: ${message}`);
    this.name = "BackendPlaybackError";
    this.backend = backend;
    this.error_type = error_type;
  }
}

export type BackendKind = "html_audio" | "rodio" | "sibyl" | "dummy" | "video";

/**
 * classify a native `<audio>`/`<video>` element error (`HTMLMediaElement.
 * error`) into a structured `error_type` + curated title/detail. the media
 * error `code` (1=ABORTED, 2=NETWORK, 3=DECODE, 4=SRC_NOT_SUPPORTED) is
 * encoded directly into `error_type` (e.g. `audio_element_error_network`)
 * so downstream consumers (`bindAutoAdvance` in `audio/player.ts`) can
 * branch on the stable `error_type` string alone - never on the message
 * text - to distinguish a transient network blip (worth one retry) from a
 * permanent decode failure (not worth retrying). shared by both
 * `HtmlAudioBackend` and `VideoBackend` so the two stay in sync.
 */
export function classifyMediaElementError(
  kind: "audio" | "video",
  mediaError: { code: number; message: string } | null
): { error_type: string; title: string; detail: string } {
  const rawDetail = mediaError
    ? `media error code: ${mediaError.code}, message: ${mediaError.message}`
    : `unknown <${kind}> element error`;
  const label = kind === "audio" ? "Audio" : "Video";
  switch (mediaError?.code) {
    case 1: // MEDIA_ERR_ABORTED
      return {
        error_type: `${kind}_element_error_aborted`,
        title: `${label} Aborted`,
        detail: rawDetail,
      };
    case 2: // MEDIA_ERR_NETWORK
      return {
        error_type: `${kind}_element_error_network`,
        title: "Network Error",
        detail: rawDetail,
      };
    case 3: // MEDIA_ERR_DECODE
      return {
        error_type: `${kind}_element_error_decode`,
        title: "Decode Error",
        detail: `this file may be corrupted (${rawDetail})`,
      };
    case 4: // MEDIA_ERR_SRC_NOT_SUPPORTED
      return {
        error_type: `${kind}_element_error_src_not_supported`,
        title: "Unsupported Format",
        detail: rawDetail,
      };
    default:
      return {
        error_type: `${kind}_element_error`,
        title: `${label} Element Error`,
        detail: rawDetail,
      };
  }
}

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
