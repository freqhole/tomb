// mirrors local queue edits (remove/reorder/append) onto the active remote
// player, so every client subscribed to that player's pushed status
// (control/statusSubscribers.ts on player.freqhole.net) sees the change
// too - see queue.ts's removeFromQueue/reorderQueue/addToQueueInternal
// call sites. no-ops entirely when no remote target is active.
//
// once a mirrored append/replace is ACK'd, `playerQueuePush.ts`'s
// `pruneLocalQueueAfterSuccessfulPush()` drops the corresponding entries
// from the LOCAL queue too - the remote becomes the source of truth for
// them from that point on, so this device doesn't keep a stale shadow
// copy that gets re-sent wholesale the next time a remote target is
// (re)selected. see docs/cenotaph-player-queue-unification-plan.md task 3b.
//
// the remote player's queue always starts at "now playing" (index 0) -
// it has no concept of history - so an edit to a local queue entry
// before the currently-playing index has no remote equivalent and is
// silently skipped.
import { createEffect, createRoot, createSignal, on } from "solid-js";
import type { Song } from "../../../music/services/storage/types";
import type { MediaItem, QueuedVideo } from "../storage/mediaItem";
import { activeTargetNodeId, isRemoteTargetActive } from "./activeTarget";
import {
  remoteQueue,
  remoteRemoveFromQueue,
  remoteReorderQueue,
  remoteStatus,
  remoteStop,
  remoteTrackPending,
  type RemoteMediaRef,
} from "./remotePlaybackControl";
import {
  appendSongsToPlayer,
  appendVideosToPlayer,
  pushSongsToPlayer,
  pushVideosToPlayer,
  registerPendingRetryHook,
} from "./playerQueuePush";
import { debug } from "../../../utils/logger";
import { CENOTAPH_QUEUE_TRACE } from "../../../cenotaph/queueTrace";

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

function provisionalMediaItemRef(item: MediaItem): RemoteMediaRef {
  return item.kind === "song" ? provisionalSongRef(item.song) : provisionalVideoRef(item.video);
}

// lets playerQueuePush.ts's handleUnresolvedItems (CONTROLLER_BLOB_PROXY
// retry) show a placeholder row for the exact hash the player reported as
// unresolved, so its transfer-status progress bar has a rendered row to
// attach to - injected here (rather than playerQueuePush.ts importing
// pushPendingOp directly) to avoid a circular import, since this file
// already imports FROM playerQueuePush.ts. the placeholder's hash is
// overridden to `hash` explicitly rather than trusting
// provisionalSongRef/provisionalVideoRef's own derivation, since a
// video's real (already-known) hash at retry time may differ from
// provisionalVideoRef's `pending:${id}` placeholder.
registerPendingRetryHook((hash, item) => {
  const ref: RemoteMediaRef = { ...provisionalMediaItemRef(item), blake3_hash: hash };
  return pushPendingOp({ mode: "append", items: [ref] });
});

/** same instant-overlay mechanism as mirrorAppendToQueue/mirrorReplaceQueue
 * below, exported directly for a caller (selectPlaybackTarget.ts's initial
 * hand-off to a freshly-picked player) that needs to register the
 * placeholder itself before it knows whether the real network call will
 * end up being an append or a replace - that's only decided once the
 * player's current status comes back, but the queue view must show
 * *something* well before then. */
export function registerPendingMediaOp(mode: "append" | "replace", items: MediaItem[]): () => void {
  if (items.length === 0) return () => {};
  return pushPendingOp({ mode, items: items.map(provisionalMediaItemRef) });
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

/** removes a single not-yet-confirmed item from the local optimistic
 * overlay - the underlying push/append network call (if already in
 * flight) isn't cancelled, but the item disappears from this device's
 * own queue view right away, matching what clicking "remove" on
 * something you just queued should do. a no-op once the pending op it
 * belonged to has already settled (the item's no longer in any
 * pendingOps entry by then, having been replaced by the real, confirmed
 * remoteQueue() entry). */
export function cancelPendingRemoteQueueItem(item: RemoteMediaRef): void {
  setPendingOps((ops) =>
    ops
      .map((op) => ({ ...op, items: op.items.filter((i) => i !== item) }))
      .filter((op) => op.items.length > 0)
  );
}

export function mirrorRemoveFromQueue(localIndex: number, currentIndex: number): void {
  if (!isRemoteTargetActive() || currentIndex < 0) return;
  const remoteIndex = localIndex - currentIndex;
  if (remoteIndex < 0) return;
  trackPendingEdit("remove", remoteIndex);
  void remoteRemoveFromQueue(remoteIndex);
}

export function mirrorReorderQueue(fromIndex: number, toIndex: number, currentIndex: number): void {
  if (!isRemoteTargetActive() || currentIndex < 0) return;
  const remoteFrom = fromIndex - currentIndex;
  const remoteTo = toIndex - currentIndex;
  if (remoteFrom < 0 || remoteTo < 0) return;
  trackPendingEdit("reorder", remoteFrom, remoteTo);
  void remoteReorderQueue(remoteFrom, remoteTo);
}

export function mirrorAppendToQueue(songs: Song[]): void {
  debug(
    "remoteQueueMirror",
    `${CENOTAPH_QUEUE_TRACE} mirrorAppendToQueue: called with ${songs.length} song(s), isRemoteTargetActive=${isRemoteTargetActive()}, nodeId=${activeTargetNodeId() ?? "(none)"}`
  );
  if (!isRemoteTargetActive() || songs.length === 0) return;
  const nodeId = activeTargetNodeId();
  if (!nodeId) return;
  const clearPending = pushPendingOp({ mode: "append", items: songs.map(provisionalSongRef) });
  void remoteTrackPending(appendSongsToPlayer(nodeId, songs)).finally(clearPending);
}

/** video equivalent of mirrorAppendToQueue() above (phase 16). */
export function mirrorAppendVideosToQueue(videos: QueuedVideo[]): void {
  debug(
    "remoteQueueMirror",
    `${CENOTAPH_QUEUE_TRACE} mirrorAppendVideosToQueue: called with ${videos.length} video(s), isRemoteTargetActive=${isRemoteTargetActive()}, nodeId=${activeTargetNodeId() ?? "(none)"}`
  );
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
  debug(
    "remoteQueueMirror",
    `${CENOTAPH_QUEUE_TRACE} mirrorReplaceQueue: called with ${songs.length} song(s), isRemoteTargetActive=${isRemoteTargetActive()}, nodeId=${activeTargetNodeId() ?? "(none)"}`
  );
  if (!isRemoteTargetActive() || songs.length === 0) return;
  const nodeId = activeTargetNodeId();
  if (!nodeId) return;
  const clearPending = pushPendingOp({ mode: "replace", items: songs.map(provisionalSongRef) });
  void remoteTrackPending(pushSongsToPlayer(nodeId, songs)).finally(clearPending);
}

/** video equivalent of mirrorReplaceQueue() above. */
export function mirrorReplaceVideosToQueue(videos: QueuedVideo[]): void {
  debug(
    "remoteQueueMirror",
    `${CENOTAPH_QUEUE_TRACE} mirrorReplaceVideosToQueue: called with ${videos.length} video(s), isRemoteTargetActive=${isRemoteTargetActive()}, nodeId=${activeTargetNodeId() ?? "(none)"}`
  );
  if (!isRemoteTargetActive() || videos.length === 0) return;
  const nodeId = activeTargetNodeId();
  if (!nodeId) return;
  const clearPending = pushPendingOp({
    mode: "replace",
    items: videos.map(provisionalVideoRef),
  });
  void remoteTrackPending(pushVideosToPlayer(nodeId, videos)).finally(clearPending);
}

/** wipes the remote player's queue ("stop" wire command) - queue.ts's
 * clearQueue() previously only ever touched this device's own local
 * queue/mirror, silently leaving the remote player's real (persisted)
 * queue untouched whenever a remote target was active. */
export function mirrorClearQueue(): void {
  if (!isRemoteTargetActive()) return;
  const clearPending = pushPendingOp({ mode: "replace", items: [] });
  void remoteTrackPending(remoteStop()).finally(clearPending);
}

// ---- durable remove/reorder reconciliation ---------------------------
//
// mirrorRemoveFromQueue/mirrorReorderQueue above are fire-and-forget -
// `remoteRemoveFromQueue`/`remoteReorderQueue` send one command and never
// retry. if the device falls asleep (or the connection drops) mid-command,
// the command can be lost entirely with no ack, no error, and no retry -
// the remote's queue never actually changes, but nothing here ever
// notices. found via a real report: remove some queue items, phone
// sleeps, reconnect - the "removed" items are back, because the remote
// never actually lost them and the client just re-displays its real
// (unchanged) queue. contrast with "played through" items, which the
// PLAYER itself removes/reports via `recently_played` on its own -
// there's nothing to lose there since it's the player's own authoritative
// progression, not a one-shot command from a controller that might not
// be listening anymore.
//
// fix: track each remove/reorder as "pending" (by the target item's
// blake3 hash, not index - indices drift as other edits land) and
// re-check it against every fresh `remoteStatus()` (poll tick, push,
// and critically the forced resync right after reconnecting - see
// `remotePlaybackControl.ts`'s `forceResyncRemoteStatus`); if the item's
// still there (remove) or still hasn't moved (reorder), resend the
// command using its CURRENT live index. gives up quietly after a few
// attempts rather than retrying forever against a genuinely broken link.
interface PendingRemoteEdit {
  kind: "remove" | "reorder";
  /** the target item's real content hash - looked up fresh at retry
   * time, since a plain index would drift as other edits land. */
  hash: string;
  /** "reorder" only: where the item should end up (0 = currently
   * playing) - resent as `to_index` once the item's live index is found. */
  toIndex?: number;
  attempts: number;
}
const MAX_PENDING_EDIT_ATTEMPTS = 5;
let pendingEdits: PendingRemoteEdit[] = [];

function trackPendingEdit(kind: "remove" | "reorder", fromIndex: number, toIndex?: number): void {
  const target = remoteQueue()[fromIndex];
  if (!target) return;
  pendingEdits.push({ kind, hash: target.blake3_hash, toIndex, attempts: 0 });
}

function reconcilePendingEdits(status: ReturnType<typeof remoteStatus>): void {
  if (pendingEdits.length === 0) return;
  if (status === null) {
    // target switched away (new player, or back to local) - these edits
    // targeted whatever the PREVIOUS target's queue was; stale either way.
    pendingEdits = [];
    return;
  }
  const liveIndexByHash = new Map(remoteQueue().map((ref, i) => [ref.blake3_hash, i]));
  const next: PendingRemoteEdit[] = [];
  for (const edit of pendingEdits) {
    const liveIndex = liveIndexByHash.get(edit.hash);
    if (liveIndex === undefined) continue; // gone - the remove landed, drop it.
    if (edit.kind === "reorder" && liveIndex === edit.toIndex) continue; // already in place.
    if (edit.attempts >= MAX_PENDING_EDIT_ATTEMPTS) continue; // give up quietly.
    if (edit.kind === "remove") {
      void remoteRemoveFromQueue(liveIndex);
    } else if (edit.toIndex !== undefined) {
      void remoteReorderQueue(liveIndex, edit.toIndex);
    }
    next.push({ ...edit, attempts: edit.attempts + 1 });
  }
  pendingEdits = next;
}

createRoot(() => {
  createEffect(on(remoteStatus, reconcilePendingEdits));
});
