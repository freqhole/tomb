// mirrors local queue edits (remove/reorder/append) onto the active remote
// player, so every client subscribed to that player's pushed status
// (control/statusSubscribers.ts on player.freqhole.net) sees the change
// too - see queue.ts's removeFromQueue/reorderQueue/addToQueueInternal
// call sites. no-ops entirely when no remote target is active.
//
// the remote player's queue always starts at "now playing" (index 0) -
// it has no concept of history - so an edit to a local queue entry
// before the currently-playing index has no remote equivalent and is
// silently skipped.
import { createSignal } from "solid-js";
import type { Song } from "../../../music/services/storage/types";
import type { QueuedVideo } from "../storage/mediaItem";
import { activeTargetNodeId, isRemoteTargetActive } from "./activeTarget";
import {
  remoteQueue,
  remoteRemoveFromQueue,
  remoteReorderQueue,
  remoteTrackPending,
  type RemoteMediaRef,
} from "./remotePlaybackControl";
import {
  appendSongsToPlayer,
  appendVideosToPlayer,
  pushSongsToPlayer,
  pushVideosToPlayer,
} from "./playerQueuePush";

// optimistic overlay (this device's own pending queue edits, not yet
// confirmed by the player) - see optimisticRemoteQueue() below. built from
// local song/video data only (no network/blob-import work, unlike the real
// push), so it's available synchronously the instant the user acts,
// instead of only once the upload pipeline + command round-trip finishes.
interface PendingRemoteQueueOp {
  mode: "append" | "replace";
  items: RemoteMediaRef[];
}
const [pendingOps, setPendingOps] = createSignal<PendingRemoteQueueOp[]>([]);

/** registers a pending op and returns a function that removes exactly this
 * op once the real push/append it represents has settled (success or
 * failure) - by then `remoteQueue()` already reflects the confirmed result
 * (applyRemoteStatusFromAck runs earlier in the same awaited chain), so
 * there's no gap where both the placeholder and the real entry are visible
 * at once. */
function pushPendingOp(op: PendingRemoteQueueOp): () => void {
  setPendingOps((ops) => [...ops, op]);
  return () => setPendingOps((ops) => ops.filter((o) => o !== op));
}

function provisionalSongRef(song: Song): RemoteMediaRef {
  return {
    source_peer_addr: "",
    blake3_hash: song.blake3 ?? song.sha256,
    duration_ms: song.duration_seconds ? Math.round(song.duration_seconds * 1000) : undefined,
    mime_type: song.mime_type ?? "audio/mpeg",
    kind: "audio",
    title: song.title,
    artist: song.artist_name,
  };
}

function provisionalVideoRef(video: QueuedVideo): RemoteMediaRef {
  return {
    source_peer_addr: "",
    blake3_hash: `pending:${video.id}`,
    duration_ms: video.duration_seconds ? Math.round(video.duration_seconds * 1000) : undefined,
    kind: "video",
    title: video.title,
  };
}

/** `remoteQueue()` plus this device's own not-yet-confirmed edits layered
 * on top - the actual fix for "the local client's queue doesn't show what
 * I just added until the player acks", since the ack (however fast) still
 * can't beat this device's own upload pipeline (fetch bytes, blob-import,
 * artwork resize) finishing first. purely a display-layer overlay, same
 * spirit as remotePlaybackControl.ts's remoteOptimisticCurrentIndex - never
 * mutates remoteStatus() itself, so a real status update always wins. */
export function optimisticRemoteQueue(): RemoteMediaRef[] {
  let list = remoteQueue();
  for (const op of pendingOps()) {
    list = op.mode === "replace" ? op.items : [...list, ...op.items];
  }
  return list;
}

export function mirrorRemoveFromQueue(localIndex: number, currentIndex: number): void {
  if (!isRemoteTargetActive() || currentIndex < 0) return;
  const remoteIndex = localIndex - currentIndex;
  if (remoteIndex < 0) return;
  void remoteRemoveFromQueue(remoteIndex);
}

export function mirrorReorderQueue(fromIndex: number, toIndex: number, currentIndex: number): void {
  if (!isRemoteTargetActive() || currentIndex < 0) return;
  const remoteFrom = fromIndex - currentIndex;
  const remoteTo = toIndex - currentIndex;
  if (remoteFrom < 0 || remoteTo < 0) return;
  void remoteReorderQueue(remoteFrom, remoteTo);
}

export function mirrorAppendToQueue(songs: Song[]): void {
  if (!isRemoteTargetActive() || songs.length === 0) return;
  const nodeId = activeTargetNodeId();
  if (!nodeId) return;
  const clearPending = pushPendingOp({ mode: "append", items: songs.map(provisionalSongRef) });
  void remoteTrackPending(appendSongsToPlayer(nodeId, songs)).finally(clearPending);
}

/** video equivalent of mirrorAppendToQueue() above (phase 16). */
export function mirrorAppendVideosToQueue(videos: QueuedVideo[]): void {
  if (!isRemoteTargetActive() || videos.length === 0) return;
  const nodeId = activeTargetNodeId();
  if (!nodeId) return;
  const clearPending = pushPendingOp({
    mode: "append",
    items: videos.map(provisionalVideoRef),
  });
  void remoteTrackPending(appendVideosToPlayer(nodeId, videos)).finally(clearPending);
}

/** replaces the remote player's whole queue - only meant for a confirmed
 * "replace" choice (see ReplaceQueueConfirmModal.tsx) or a fresh play from
 * an empty local queue; a plain add/insert should always go through
 * mirrorAppendToQueue instead. */
export function mirrorReplaceQueue(songs: Song[]): void {
  if (!isRemoteTargetActive() || songs.length === 0) return;
  const nodeId = activeTargetNodeId();
  if (!nodeId) return;
  const clearPending = pushPendingOp({ mode: "replace", items: songs.map(provisionalSongRef) });
  void remoteTrackPending(pushSongsToPlayer(nodeId, songs)).finally(clearPending);
}

/** video equivalent of mirrorReplaceQueue() above. */
export function mirrorReplaceVideosToQueue(videos: QueuedVideo[]): void {
  if (!isRemoteTargetActive() || videos.length === 0) return;
  const nodeId = activeTargetNodeId();
  if (!nodeId) return;
  const clearPending = pushPendingOp({
    mode: "replace",
    items: videos.map(provisionalVideoRef),
  });
  void remoteTrackPending(pushVideosToPlayer(nodeId, videos)).finally(clearPending);
}
