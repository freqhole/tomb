// PlaybackBackend<MiddenNodeLike> adapter that delegates cenotaph's
// `/player/` remote-control commands to spume's REAL player (rodio/gst-
// aware via `select.ts`/`selectVideo.ts`) - the only playback backend
// spume uses for this route, browser and charnel alike.
//
// resolving an incoming `MediaRef` to a real local `Song`/`QueuedVideo`
// reuses the exact same logic `localLibraryHooks.ts` uses elsewhere in
// spume (see `mediaRefResolve.ts`) - both need "is this already in my
// local library, and if not, pull it in from its source peer", just for
// different reasons (a queueable domain object here vs. raw bytes
// there).

import type { MediaRef, PlaybackBackend, PlayerStatus } from "../index";
import { createEffect, createRoot, createSignal, on } from "solid-js";
import {
  addToQueue,
  clearQueue,
  playQueue,
  removeFromQueue as queueRemoveFromQueue,
  reorderQueue as queueReorderQueue,
} from "../../music/services/queue/queue";
import {
  pause as pausePlayback,
  play as resumePlayback,
  playNext,
  seek as seekPlayback,
  setPlayerVolume,
} from "../../music/services/audio/player";
import { currentTime, isPlaying, volume } from "../../music/services/audio/playerState";
import {
  appState,
  setAutoDownloadEnabled as persistAutoDownloadEnabled,
} from "../../app/services/storage/db";
import { getAutoDownloadEnabled } from "../../app/services/storage/db";
import {
  mediaItemBlake3,
  mediaItemKey,
  songToMediaItem,
  videoToMediaItem,
  type MediaItem,
} from "../../app/services/storage/mediaItem";
import type { Song } from "../../music/services/storage/types";
import type { QueuedVideo } from "../../app/services/storage/mediaItem";
import { resolveMediaRefToSong, resolveMediaRefToVideo } from "./mediaRefResolve";
import { CENOTAPH_QUEUE_TRACE } from "../queueTrace";
import {
  leaveRadio,
  radioCurrentPeerAddr,
  radioCurrentStationId,
  radioNowPlaying,
  radioStatus,
  tuneIntoRadio,
} from "../../app/services/radio/radioService";
import { debug, error, warn } from "../../utils/logger";

/** one item from a queue push that hasn't resolved to a real queueable
 * `MediaItem` yet - shown by `CenotaphPlayerApp.tsx` immediately (title/
 * artist/duration are already on the wire `MediaRef`, no network needed)
 * so the queue view isn't blank/unresponsive-looking while resolution
 * (which can involve a real peer dial - see `ensureRemoteForPeer`'s
 * `createRemote` call for a never-before-seen peer_addr) is in flight.
 * mirrors rathole's own `MusicState::pending_previews` /
 * `AppAction::PairingQueuePending` (see tty/pairing/dispatch.rs). */
export interface PendingQueuePreview {
  key: string;
  title: string;
  artist?: string;
  durationSeconds?: number;
  kind: "song" | "video";
}

const [pendingQueuePreviews, setPendingQueuePreviews] = createSignal<PendingQueuePreview[]>([]);
export { pendingQueuePreviews };

function addPendingPreview(item: MediaRef): void {
  const preview: PendingQueuePreview = {
    key: item.blake3_hash,
    title: item.title ?? item.blake3_hash.slice(0, 12),
    artist: item.artist ?? undefined,
    durationSeconds: item.duration_ms ? item.duration_ms / 1000 : undefined,
    kind: item.kind === "video" ? "video" : "song",
  };
  // idempotent by key - replaceQueue/appendQueue below may both call this
  // for the same item (once immediately on command receipt, once again
  // inside resolveAndDeliverQueueItems's own pass) - a duplicate add would
  // otherwise render the same pending row twice.
  let added = false;
  setPendingQueuePreviews((prev) => {
    if (prev.some((p) => p.key === preview.key)) return prev;
    added = true;
    return [...prev, preview];
  });
  debug(
    "charnelPlaybackAdapter",
    `${CENOTAPH_QUEUE_TRACE} addPendingPreview: ${item.blake3_hash.slice(0, 8)}... ${added ? "added" : "already pending, no-op"}`
  );
}

function settlePendingPreview(blake3Hash: string): void {
  setPendingQueuePreviews((prev) => prev.filter((p) => p.key !== blake3Hash));
}

// queued items this player couldn't resolve (unreachable/unauthorized
// source, sync failure, etc.) - surfaced in currentStatus() below so the
// controller (which already polls/subscribes to status) can notice and
// proxy them as a last resort, instead of the controller proactively
// fetching/importing every item's bytes up front "just in case". cleared
// the moment a later resolve attempt for the same hash succeeds (e.g.
// after the controller actually helped and re-sent it, or the source
// simply came back online on its own).
const unresolvedItems = new Map<string, { blake3Hash: string; sourcePeerAddr: string }>();

function markUnresolved(item: MediaRef): void {
  unresolvedItems.set(item.blake3_hash, {
    blake3Hash: item.blake3_hash,
    sourcePeerAddr: item.source_peer_addr,
  });
}

function clearUnresolved(blake3Hash: string): void {
  unresolvedItems.delete(blake3Hash);
}

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

/** resolves `items` one at a time (not `Promise.all`) and hands each one
 * to `onResolved` as soon as IT finishes, rather than waiting for the
 * whole batch - a single slow/unreachable item (e.g. the one-time
 * `createRemote` peer dial for a never-before-seen source) would
 * otherwise hold up every other, already-fast-to-resolve item in the
 * same push. every item is shown as a pending preview immediately (see
 * `PendingQueuePreview`), settled (removed) the moment its own resolve
 * finishes, success or failure. */
async function resolveAndDeliverQueueItems(
  items: MediaRef[],
  // hashes to treat as already-queued, e.g. the current queue's own
  // content for `appendQueue` - mutated in place as items resolve, so a
  // batch with its own internal duplicates also collapses to one, same
  // as rathole's `dispatch.rs::resolve_queue_items`. `undefined` (the
  // `replaceQueue` case) starts from nothing - the old queue is being
  // thrown away, so there's nothing prior to compare against.
  seenHashes: Set<string>,
  onResolved: (item: MediaItem, isFirst: boolean) => Promise<void>
): Promise<number> {
  const batchStart = Date.now();
  debug(
    "charnelPlaybackAdapter",
    `${CENOTAPH_QUEUE_TRACE} resolveAndDeliverQueueItems: received ${items.length} item(s)`
  );
  const toResolve: MediaRef[] = [];
  for (const item of items) {
    if (seenHashes.has(item.blake3_hash)) {
      warn(
        "charnelPlaybackAdapter",
        `skipping already-queued duplicate item ${item.blake3_hash.slice(0, 8)}...`
      );
      continue;
    }
    seenHashes.add(item.blake3_hash);
    toResolve.push(item);
  }
  for (const item of toResolve) addPendingPreview(item);
  debug(
    "charnelPlaybackAdapter",
    `${CENOTAPH_QUEUE_TRACE} resolveAndDeliverQueueItems: ensured ${toResolve.length} pending preview row(s) exist (${items.length - toResolve.length} deduped) at +${Date.now() - batchStart}ms`
  );

  let resolvedCount = 0;
  for (const item of toResolve) {
    const label = `${item.kind} "${item.title ?? item.blake3_hash.slice(0, 8)}" (${item.blake3_hash.slice(0, 8)}...)`;
    const itemStart = Date.now();
    try {
      const mediaItem = await resolveMediaItem(item);
      const resolveMs = Date.now() - itemStart;
      if (!mediaItem) {
        // resolveMediaItem's own resolve/sync functions already log the
        // specific reason (unreachable peer, sync failure, etc.) - this
        // just marks which item in the batch it was, for a queue push of
        // more than one item.
        warn(
          "charnelPlaybackAdapter",
          `${CENOTAPH_QUEUE_TRACE} failed to resolve queued item ${label} after ${resolveMs}ms, skipping`
        );
        markUnresolved(item);
        continue;
      }
      clearUnresolved(item.blake3_hash);
      try {
        await onResolved(mediaItem, resolvedCount === 0);
        resolvedCount++;
        debug(
          "charnelPlaybackAdapter",
          `${CENOTAPH_QUEUE_TRACE} resolved+queued item ${label} in ${resolveMs}ms (${resolvedCount}/${toResolve.length} so far)`
        );
      } catch (err) {
        // a resolve can succeed but the actual queue-add (playQueue/
        // addToQueue) can still throw (e.g. a malformed item tripping
        // queue.ts's own validation) - previously uncaught here, this
        // silently aborted the ENTIRE batch (every item still queued
        // behind the failing one was dropped too) and propagated all the
        // way up through dispatchCommand with no indication of which
        // item or why. logging it here and continuing to the next item
        // is what actually answers "why wasn't this queued", and matches
        // this function's own stated "one broken item shouldn't hold up
        // the rest" design intent.
        error("charnelPlaybackAdapter", `queueing resolved item ${label} failed:`, err);
      }
    } finally {
      settlePendingPreview(item.blake3_hash);
    }
  }
  debug(
    "charnelPlaybackAdapter",
    `${CENOTAPH_QUEUE_TRACE} resolveAndDeliverQueueItems: done, resolved ${resolvedCount}/${toResolve.length} in ${Date.now() - batchStart}ms total`
  );
  return resolvedCount;
}

/** the current queue's own content hashes - seeds `resolveAndDeliverQueueItems`'
 * dedup set for `appendQueue`, so a flaky controller resending the same
 * `append_queue` command (reconnect, retry) doesn't stack duplicate
 * entries every time. */
function currentQueueHashes(): Set<string> {
  return new Set((appState()?.queue ?? []).map(mediaItemBlake3).filter((h): h is string => !!h));
}

/** builds the wire `MediaRef` for an already-local `MediaItem`, for
 * `currentStatus()`'s queue/now-playing fields - no artwork resolution
 * or cross-remote bridging (unlike `playerQueuePush.ts`'s `songToMediaRef`/
 * `videoToMediaRef`, built for pushing TO a different player): this item
 * is already playing right here, so only the display fields matter.
 *
 * `blake3_hash` always uses the canonical `mediaItemBlake3()` (never a
 * locally-reimplemented copy - two near-identical fallback chains used to
 * live in this file alone, one of which silently substituted a video's
 * row `id` for its content hash whenever `blake3` was missing, a real
 * "blake3 field secretly holds an id" hazard for anything downstream that
 * assumes `blake3_hash` is always a real content hash). falls back to
 * `mediaItemKey()` only as an explicit, clearly-labeled last resort - the
 * wire `MediaRef.blake3_hash` field is required and can't be omitted, but
 * this value is NOT a real content hash when it's reached; a local-only
 * video queued before it ever had a blake3 backfilled is the only way to
 * get here. */
function mediaItemToRef(item: MediaItem): MediaRef {
  const blake3Hash = mediaItemBlake3(item) ?? mediaItemKey(item);
  if (item.kind === "song") {
    const s = item.song;
    return {
      source_peer_addr: "",
      blake3_hash: blake3Hash,
      size_bytes: s.file_size ?? undefined,
      duration_ms: s.duration_seconds ? Math.round(s.duration_seconds * 1000) : undefined,
      mime_type: s.mime_type ?? "audio/mpeg",
      kind: "audio",
      title: s.title,
      artist: s.artist_name ?? undefined,
    };
  }
  const v = item.video;
  return {
    source_peer_addr: "",
    blake3_hash: blake3Hash,
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

/** the real content hash for a `MediaItem`, for `recentlyPlayed` entries -
 * just `mediaItemBlake3()` (the canonical, storage/mediaItem.ts version)
 * falling back to `mediaItemKey()` (`sha256`/`id`) ONLY when genuinely
 * unknown. previously reimplemented this fallback chain locally with a
 * bug: it substituted a video's row `id` for its blake3 whenever `blake3`
 * was missing, so a `recentlyPlayed` entry for such a video was a row id,
 * not a hash - harmless in isolation (nothing compared it against a real
 * hash), but exactly the kind of silent id/blake3 field confusion that's
 * bitten this codebase before elsewhere. reusing the one canonical helper
 * instead of a second, silently-diverging copy is the actual fix. */
function itemBlake3(item: MediaItem): string {
  return mediaItemBlake3(item) ?? mediaItemKey(item);
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

/** resolves once `isPlaying()` matches `expected`, or after `timeoutMs`
 * (never rejects - a backend that never settles must not hang the
 * command forever). needed because pausePlayback()/resumePlayback() only
 * KICK OFF the underlying backend's async pause/play - `isPlaying()`
 * itself only updates later, once the backend's own event stream reports
 * the real state change (see playerStateSync.ts's `applyEvent`). without
 * this, `currentStatus()` (built immediately after, for the command's
 * ack) always read the OLD value, so a paired controller's play/pause
 * button looked exactly one command behind the real state - a real bug
 * found live ("pause the remote, remote pauses, but the controller still
 * shows playing until I click again"). */
function waitForPlaybackState(expected: boolean, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      dispose();
      resolve();
    }, timeoutMs);
    const dispose = createRoot((disposeRoot) => {
      createEffect(() => {
        if (settled) return;
        if (isPlaying() === expected) {
          settled = true;
          clearTimeout(timer);
          disposeRoot();
          resolve();
        }
      });
      return disposeRoot;
    });
  });
}

function currentStatus(): PlayerStatus {
  const common = {
    queue: buildQueueRefs(),
    recently_played: [...recentlyPlayed],
    auto_download_enabled: getAutoDownloadEnabled(),
    volume: volume(),
    unresolved_items: Array.from(unresolvedItems.values()).map((u) => ({
      blake3_hash: u.blake3Hash,
      source_peer_addr: u.sourcePeerAddr,
    })),
  };

  // radio takes precedence over the regular queue - tuneIntoRadio()
  // (called by startRadio below) runs as its own session entirely
  // separate from the queue/player, so a radio tune-in must be reported
  // here or a paired controller has no way to tell radio is playing at
  // all (the queue-based branches below would otherwise report whatever
  // stale queue state happened to exist before the tune).
  const radioPeer = radioCurrentPeerAddr();
  const rStatus = radioStatus();
  if (radioPeer && (rStatus === "connecting" || rStatus === "playing" || rStatus === "paused")) {
    const np = radioNowPlaying();
    return {
      type: "status",
      state: "playing_radio",
      peer_addr: radioPeer,
      station_id: radioCurrentStationId() ?? undefined,
      title: np?.title,
      artist: np?.artist ?? undefined,
      kind: np?.kind === "video" ? "video" : np ? "audio" : undefined,
      ...common,
    };
  }

  const queue = common.queue;
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
 * accepted (per the interface) but never used - this adapter never
 * talks to iroh-blobs directly; `mediaRefResolve.ts` already goes
 * through spume's normal remote-client plumbing for that. */
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
    const commandReceivedAt = Date.now();
    debug(
      "charnelPlaybackAdapter",
      `${CENOTAPH_QUEUE_TRACE} replaceQueue: command received, resolving ${items.length} item(s)`
    );
    // render pending rows for the WHOLE incoming batch as the very FIRST
    // thing, before clearQueue()/resolve/sync - so the queue view shows
    // something the instant this command arrives, rather than waiting on
    // the old queue to actually finish clearing first. addPendingPreview
    // is idempotent, so resolveAndDeliverQueueItems's own preview-adding
    // pass below (needed for appendQueue, which has no pre-add step) is
    // safe to leave running afterward too.
    for (const item of items) addPendingPreview(item);
    debug(
      "charnelPlaybackAdapter",
      `${CENOTAPH_QUEUE_TRACE} replaceQueue: pending rows rendered first, at +${Date.now() - commandReceivedAt}ms`
    );
    // playQueue([item], {startIndex:0}) below has no `source` option, so
    // without an explicitly empty queue first it never hits queue.ts's
    // "replace" branch - it falls to playQueueInternal's insert-after-
    // current behavior instead, silently leaving whatever was already
    // queued in place. a `replace_queue` command must actually replace.
    const clearStart = Date.now();
    await clearQueue();
    debug(
      "charnelPlaybackAdapter",
      `${CENOTAPH_QUEUE_TRACE} replaceQueue: clearQueue() took ${Date.now() - clearStart}ms`
    );
    const resolvedCount = await resolveAndDeliverQueueItems(
      items,
      new Set(),
      async (item, isFirst) => {
        if (isFirst) {
          await playQueue([item], { startIndex: 0 });
        } else {
          await addToQueue([item]);
        }
      }
    );
    debug(
      "charnelPlaybackAdapter",
      `replaceQueue: resolved ${resolvedCount}/${items.length} item(s)`
    );
    if (resolvedCount === 0) {
      warn("charnelPlaybackAdapter", "replaceQueue: no items resolved, nothing to play");
    }
  },
  async appendQueue(_node, items) {
    debug(
      "charnelPlaybackAdapter",
      `${CENOTAPH_QUEUE_TRACE} appendQueue: command received, resolving ${items.length} item(s)`
    );
    // unlike replaceQueue, there's no async step (clearQueue) to hoist
    // pending-preview rendering ahead of - currentQueueHashes() is
    // synchronous, so resolveAndDeliverQueueItems's own preview-adding
    // pass below already runs as the first thing that happens here.
    const resolvedCount = await resolveAndDeliverQueueItems(
      items,
      currentQueueHashes(),
      async (item) => {
        await addToQueue([item]);
      }
    );
    debug(
      "charnelPlaybackAdapter",
      `appendQueue: resolved ${resolvedCount}/${items.length} item(s)`
    );
    if (resolvedCount === 0) {
      warn("charnelPlaybackAdapter", "appendQueue: no items resolved, nothing to append");
    }
  },
  async pause() {
    pausePlayback();
    await waitForPlaybackState(false);
  },
  async resume() {
    await resumePlayback();
    await waitForPlaybackState(true);
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
