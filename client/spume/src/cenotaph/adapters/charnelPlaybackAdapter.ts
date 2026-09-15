// PlaybackBackend<MiddenNodeLike> adapter that delegates cenotaph's
// `/player/` remote-control commands to spume's REAL player (rodio/gst-
// aware via `select.ts`/`selectVideo.ts`) instead of cenotaph's own
// self-contained DOM `<video>`/`<audio>` engine (`playbackEngine.ts`).
//
// see docs/cenotaph-linux-experimental-player-plan.md - this is phase 1
// ("command-routing adapter"). activated only for a charnel build with
// the rodio opt-in on (see acceptModeBootstrap.ts) - plain browser/wasm
// mode keeps using cenotaph's own `mediaPlaybackBackend` unchanged.
//
// resolving an incoming `MediaRef` to a real local `Song`/`QueuedVideo`
// reuses the exact same logic `localLibraryHooks.ts` uses for cenotaph's
// own engine (see `mediaRefResolve.ts`) - both need "is this already in
// my local library, and if not, pull it in from its source peer", just
// for different reasons (a queueable domain object here vs. raw bytes
// there).

import type { MediaRef, PlaybackBackend, PlayerStatus } from "@freqhole/cenotaph";
import { createEffect, createRoot, on } from "solid-js";
import {
  addToQueue,
  clearQueue,
  playQueue,
  removeFromQueue as queueRemoveFromQueue,
  reorderQueue as queueReorderQueue,
} from "../../../music/services/queue/queue";
import {
  pause as pausePlayback,
  play as resumePlayback,
  playNext,
  seek as seekPlayback,
  setPlayerVolume,
} from "../../../music/services/audio/player";
import { currentTime, isPlaying, volume } from "../../../music/services/audio/playerState";
import { appState, setAutoDownloadEnabled as persistAutoDownloadEnabled } from "../storage/db";
import { getAutoDownloadEnabled } from "../storage/db";
import {
  mediaItemKey,
  songToMediaItem,
  videoToMediaItem,
  type MediaItem,
} from "../storage/mediaItem";
import type { Song } from "../../../music/services/storage/types";
import type { QueuedVideo } from "../storage/mediaItem";
import { resolveMediaRefToSong, resolveMediaRefToVideo } from "./mediaRefResolve";
import { leaveRadio, tuneIntoRadio } from "../radio/radioService";
import { warn } from "../../../utils/logger";

/** resolves one wire `MediaRef` to a queueable `MediaItem`, promoting it
 * into the local library first if needed (see `mediaRefResolve.ts`).
 * `null` if resolution fails - callers skip it (best-effort, so one
 * broken/unreachable item doesn't drop an otherwise-good queue push). */
async function resolveMediaItem(item: MediaRef): Promise<MediaItem | null> {
  if (item.kind === "video") {
    const video: QueuedVideo | null = await resolveMediaRefToVideo(item);
    return video ? videoToMediaItem(video) : null;
  }
  const song: Song | null = await resolveMediaRefToSong(item);
  return song ? songToMediaItem(song) : null;
}

async function resolveMediaItems(items: MediaRef[]): Promise<MediaItem[]> {
  const resolved = await Promise.all(items.map(resolveMediaItem));
  return resolved.filter((item): item is MediaItem => item !== null);
}

/** builds the wire `MediaRef` for an already-local `MediaItem`, for
 * `currentStatus()`'s queue/now-playing fields - no artwork resolution
 * or cross-remote bridging (unlike `playerQueuePush.ts`'s `songToMediaRef`/
 * `videoToMediaRef`, built for pushing TO a different player): this item
 * is already playing right here, so only the display fields matter. */
function mediaItemToRef(item: MediaItem): MediaRef {
  if (item.kind === "song") {
    const s = item.song;
    return {
      source_peer_addr: "",
      blake3_hash: s.blake3 ?? s.sha256,
      size_bytes: s.file_size ?? undefined,
      duration_ms: s.duration_seconds ? Math.round(s.duration_seconds * 1000) : undefined,
      mime_type: s.mime_type ?? "audio/mpeg",
      kind: "audio",
      title: s.title,
      artist: s.artist_name ?? undefined,
    };
  }
  const v = item.video as QueuedVideo & { blake3?: string | null };
  return {
    source_peer_addr: "",
    blake3_hash: v.blake3 ?? v.id,
    duration_ms: v.duration_seconds ? Math.round(v.duration_seconds * 1000) : undefined,
    kind: "video",
    title: v.title,
  };
}

/** the queue as `MediaRef[]`, current item first (matches cenotaph's
 * own wire convention) - or `[]` if nothing's queued. */
function buildQueueRefs(): MediaRef[] {
  const state = appState();
  if (!state?.queue || state.queue.length === 0) return [];
  const currentIdx = state.current_sha256
    ? state.queue.findIndex((i) => mediaItemKey(i) === state.current_sha256)
    : -1;
  const ordered = currentIdx >= 0 ? state.queue.slice(currentIdx) : state.queue;
  return ordered.map(mediaItemToRef);
}

/** the real content hash for a `MediaItem` - what `mediaItemToRef`
 * reports as `blake3_hash` (preferring `blake3` over `sha256`/`id`).
 * used to build `recentlyPlayed` entries from items looked up by
 * `mediaItemKey` (which is `sha256`/`id`, NOT necessarily the same
 * value - see `mediaItemKey`'s own doc comment). */
function itemBlake3(item: MediaItem): string {
  return item.kind === "song"
    ? (item.song.blake3 ?? item.song.sha256)
    : ((item.video as QueuedVideo & { blake3?: string | null }).blake3 ?? item.video.id);
}

/** finds the current queue item's index within the FULL `appState().queue`
 * array (not the current-onward slice `buildQueueRefs()` reports) - the
 * `removeFromQueue`/`reorderQueue` wire commands carry an index relative
 * to current (0 = currently playing, matching `buildQueueRefs()`'s own
 * convention - see `remoteQueueMirror.ts`'s `mirrorRemoveFromQueue`,
 * which computes the mirror image of this same offset), but `queue.ts`'s
 * `removeFromQueue`/`reorderQueue` expect a full-array index. `-1` when
 * nothing's playing (queue.ts's functions no-op on an invalid index). */
function currentFullIndex(): number {
  const state = appState();
  if (!state?.queue || !state.current_sha256) return -1;
  return state.queue.findIndex((i) => mediaItemKey(i) === state.current_sha256);
}

/** blake3 hashes this player is done with this session (played through,
 * explicitly skipped, or explicitly removed) - most-recent-last, capped.
 * mirrors cenotaph's own engine's `recordRecentlyPlayed()`/`recentlyPlayed`
 * (playbackEngine.ts), which this adapter otherwise has no equivalent of:
 * a reconnecting controller diffs its own queue push against this (see
 * spume's own `selectPlaybackTarget.ts`-adjacent dedup logic) to avoid
 * re-queueing songs this player already dealt with. cleared once the
 * queue fully empties (see the effect below) - same "session boundary"
 * cenotaph's own engine uses. */
const RECENTLY_PLAYED_LIMIT = 50;
let recentlyPlayed: string[] = [];
function recordRecentlyPlayed(hash: string | null | undefined): void {
  if (!hash) return;
  recentlyPlayed = recentlyPlayed.filter((h) => h !== hash);
  recentlyPlayed.push(hash);
  if (recentlyPlayed.length > RECENTLY_PLAYED_LIMIT) recentlyPlayed.shift();
}

// watches appState()'s current_sha256 for transitions so ANYTHING that
// moves playback off an item (natural end, skip, explicit next/prev,
// admin dispatch...) marks it "dealt with" via recordRecentlyPlayed()
// above - spume's own queue/player services have no such tracking on
// their own (unlike cenotaph's own engine, which calls this from a
// single `skip()` chokepoint). runs once at module load, for the
// lifetime of the app (this adapter is only ever active in charnel/
// rodio mode - see this module's header comment).
let previousCurrentKey: string | null = null;
createRoot(() => {
  createEffect(
    on(
      () => appState()?.current_sha256 ?? null,
      (newKey) => {
        const state = appState();
        if (previousCurrentKey && previousCurrentKey !== newKey) {
          const prevItem = state?.queue.find((i) => mediaItemKey(i) === previousCurrentKey);
          recordRecentlyPlayed(prevItem ? itemBlake3(prevItem) : previousCurrentKey);
        }
        if (!newKey && (!state?.queue || state.queue.length === 0)) {
          recentlyPlayed = [];
        }
        previousCurrentKey = newKey;
      }
    )
  );
});

function currentStatus(): PlayerStatus {
  const queue = buildQueueRefs();
  const common = {
    queue,
    recently_played: [...recentlyPlayed],
    auto_download_enabled: getAutoDownloadEnabled(),
    volume: volume(),
  };
  if (queue.length === 0) {
    return { type: "status", state: "stopped", ...common };
  }
  const item = queue[0];
  if (isPlaying()) {
    return {
      type: "status",
      state: "now_playing",
      item,
      position_ms: Math.round(currentTime() * 1000),
      server_time_ms: Date.now(),
      ...common,
    };
  }
  return {
    type: "status",
    state: "paused",
    position_ms: Math.round(currentTime() * 1000),
    ...common,
  };
}

/** `PlaybackBackend` implementation that delegates to spume's own real
 * player/queue services (see this module's header comment). `node` is
 * accepted (per the interface) but never used - unlike cenotaph's own
 * `mediaPlaybackBackend`, this adapter never talks to iroh-blobs
 * directly; `mediaRefResolve.ts` already goes through spume's normal
 * remote-client plumbing for that. */
export const charnelPlaybackAdapter: PlaybackBackend<unknown> = {
  async play(_node, item) {
    const mediaItem = await resolveMediaItem(item);
    if (!mediaItem) {
      warn("charnelPlaybackAdapter", `play: failed to resolve ${item.blake3_hash.slice(0, 8)}...`);
      return;
    }
    await playQueue([mediaItem], { startIndex: 0 });
  },
  async replaceQueue(_node, items) {
    const mediaItems = await resolveMediaItems(items);
    if (mediaItems.length === 0) {
      warn("charnelPlaybackAdapter", "replaceQueue: no items resolved, nothing to play");
      return;
    }
    await playQueue(mediaItems, { startIndex: 0 });
  },
  async appendQueue(_node, items) {
    const mediaItems = await resolveMediaItems(items);
    if (mediaItems.length === 0) {
      warn("charnelPlaybackAdapter", "appendQueue: no items resolved, nothing to append");
      return;
    }
    await addToQueue(mediaItems);
  },
  pause() {
    pausePlayback();
  },
  resume() {
    void resumePlayback();
  },
  seek(positionMs) {
    seekPlayback(positionMs / 1000);
  },
  async skip(_node) {
    await playNext();
  },
  async removeFromQueue(_node, index) {
    // wire index is relative to current (0 = currently playing) - see
    // `currentFullIndex()`'s doc comment for why this needs an offset.
    const currentIdx = currentFullIndex();
    const fullIndex = currentIdx >= 0 ? currentIdx + index : index;
    const removed = appState()?.queue[fullIndex];
    if (removed) recordRecentlyPlayed(itemBlake3(removed));
    await queueRemoveFromQueue(fullIndex);
  },
  reorderQueue(fromIndex, toIndex) {
    const currentIdx = currentFullIndex();
    const offset = currentIdx >= 0 ? currentIdx : 0;
    void queueReorderQueue(offset + fromIndex, offset + toIndex);
  },
  setVolume(vol) {
    setPlayerVolume(vol);
  },
  stop() {
    void clearQueue();
  },
  async startRadio(_node, peerAddr, stationId) {
    await tuneIntoRadio(peerAddr, { stationId });
  },
  stopRadio() {
    leaveRadio();
  },
  setAutoDownloadEnabled(enabled) {
    void persistAutoDownloadEnabled(enabled);
  },
  currentStatus,
};
