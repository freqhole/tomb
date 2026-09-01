// where media bytes belong: the single storage-tier decision.
//
// the rule, in full:
//
//   sync_queue_to_local ON  -> tier 1 (library). never tier 2.
//   sync_queue_to_local OFF -> tier 2 (ephemeral), purged on queue exit.
//
// this applies uniformly to audio, video, images, waveforms and posters —
// there is deliberately no media-kind parameter.
//
// tier 2 has two physical stores because `RodioBackend` is a rust-side
// decoder that plays from a filesystem path and cannot read the Cache API
// (a webview api) or a `blob:` url. that is a *host* detail, not a policy
// one: both stores get the same lifecycle and the same eviction rules.

/** which playback host will consume the bytes. `rodio` is charnel's native
 * audio path (default on linux); everything else plays in the webview. */
export type PlaybackHost = "webview" | "rodio";

/** tier 1 survives queue exit and is user-visible; tier 2 is evictable. */
export type MediaTier = "library" | "ephemeral";

/** physical store backing tier 2. */
export type EphemeralStore = "cache_api" | "ephemeral_dir";

export interface StorageTarget {
  tier: MediaTier;
  /** only set when `tier === "ephemeral"`. */
  store?: EphemeralStore;
}

export interface StorageTargetInput {
  /** the user's `sync_queue_to_local` setting. */
  syncToLocal: boolean;
  host: PlaybackHost;
}

/** tier 2's physical store is chosen by which player can actually read it. */
export function ephemeralStoreFor(host: PlaybackHost): EphemeralStore {
  return host === "rodio" ? "ephemeral_dir" : "cache_api";
}

/** the one place the storage rule is expressed. */
export function resolveStorageTarget({ syncToLocal, host }: StorageTargetInput): StorageTarget {
  if (syncToLocal) return { tier: "library" };
  return { tier: "ephemeral", store: ephemeralStoreFor(host) };
}

/** true when bytes fetched under these conditions must NOT be written to the
 * api cache. this is what callers thread down to the transport as
 * `cache: "skip"`. */
export function shouldSkipApiCache(input: StorageTargetInput): boolean {
  return resolveStorageTarget(input).store !== "cache_api";
}
