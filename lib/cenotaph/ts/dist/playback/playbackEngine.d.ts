import type { MediaRef, PlayerStatus } from "../control/schema";
import type { PlaybackBackend } from "../control/playbackBackend";
import type { MediaPlaybackNode } from "./types";
/**
 * host-supplied bridge to a real local media library (e.g. spume's own
 * IDB/OPFS song catalog) - optional. with no hooks registered, cenotaph
 * behaves exactly as it did before tier 2 existed: every item goes through
 * the persistent-then-network blob cache below, nothing gets promoted into
 * a real library.
 */
export interface LocalLibraryHooks {
    /** null if this blake3 hash isn't already cataloged in the local library. */
    getLocalBlob(blake3Hash: string): Promise<Blob | null>;
    /** whether newly-fetched items should be promoted into the real local
     * library instead of the ephemeral/persistent cache. */
    isSyncEnabled(): boolean;
    /** best-effort: pull the full item (audio + metadata) into the local
     * library. return null (or throw) to fall back to the ephemeral cache. */
    syncToLocal(item: MediaRef): Promise<Blob | null>;
}
export declare function setLocalLibraryHooks(hooks: LocalLibraryHooks | null): void;
export type EngineState = "idle" | "buffering" | "playing" | "paused" | "stopped" | "error" | "blocked";
export declare const engineState: import("solid-js").Accessor<EngineState>;
export declare const nowPlaying: import("solid-js").Accessor<{
    source_peer_addr: string;
    blake3_hash: string;
    size_bytes?: number | undefined;
    duration_ms?: number | undefined;
    mime_type?: string | undefined;
    kind?: "audio" | "video" | undefined;
    title?: string | undefined;
    artist?: string | undefined;
    artwork_thumb_url?: string | undefined;
    artwork_full_url?: string | undefined;
} | null>;
export declare const engineError: import("solid-js").Accessor<string | null>;
export declare const upcomingQueue: import("solid-js").Accessor<{
    source_peer_addr: string;
    blake3_hash: string;
    size_bytes?: number | undefined;
    duration_ms?: number | undefined;
    mime_type?: string | undefined;
    kind?: "audio" | "video" | undefined;
    title?: string | undefined;
    artist?: string | undefined;
    artwork_thumb_url?: string | undefined;
    artwork_full_url?: string | undefined;
}[]>;
export declare const mediaElement: HTMLVideoElement;
export declare const mediaKind: () => "audio" | "video";
/** fraction (0-1) of the current item's download, or null when not downloading. */
export declare const downloadProgress: import("solid-js").Accessor<number | null>;
/** current playback position, in seconds. */
export declare const playbackPosition: import("solid-js").Accessor<number>;
/** current item's duration, in seconds (0 until the browser knows it). */
export declare const playbackDuration: import("solid-js").Accessor<number>;
/** per-item (keyed by blake3 hash) background-fetch state for queue rows. */
export declare const queueItemStatus: import("solid-js").Accessor<Map<string, "loading" | "ready">>;
/** retry playback after a "blocked" state - call from a real user gesture (click/tap). */
export declare function retryPlayback(): Promise<void>;
export declare function play(node: MediaPlaybackNode, item: MediaRef): Promise<void>;
export declare function replaceQueue(node: MediaPlaybackNode, items: MediaRef[]): Promise<void>;
export declare function appendQueue(node: MediaPlaybackNode, items: MediaRef[]): Promise<void>;
export declare function pause(): void;
export declare function resume(): void;
export declare function seek(positionMs: number): void;
export declare function setVolume(volume: number): void;
export declare function stop(): void;
export declare function skip(node: MediaPlaybackNode): Promise<void>;
/** removes a queue entry by index. removing the currently-playing item
 * (index 0) plays through to the next one, same as skip(). */
export declare function removeFromQueue(node: MediaPlaybackNode, index: number): Promise<void>;
/** moves a not-yet-playing queue entry to a new position. the currently-
 * playing item (index 0) can neither be moved nor be a destination - it
 * stays pinned until it's skipped or removed. */
export declare function reorderQueue(fromIndex: number, toIndex: number): void;
export declare function setAutoDownloadEnabled(enabled: boolean): void;
export declare function currentStatus(): PlayerStatus;
/** cenotaph's default, complete `PlaybackBackend` - bundles every export
 * above into the shape `control/dispatcher.ts` expects. a host app with no
 * playback engine of its own (spume's `/player/` route, the now-abandoned
 * player.freqhole.net) passes this directly to
 * `createPlayerConnectionHandler({ backend: mediaPlaybackBackend, ... })`
 * with zero extra glue code. */
export declare const mediaPlaybackBackend: PlaybackBackend<MediaPlaybackNode>;
//# sourceMappingURL=playbackEngine.d.ts.map