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
import type { Song } from "../../../music/services/storage/types";
import { activeTargetNodeId, isRemoteTargetActive } from "./activeTarget";
import { remoteRemoveFromQueue, remoteReorderQueue } from "./remotePlaybackControl";
import { appendSongsToPlayer, pushSongsToPlayer } from "./playerQueuePush";

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
  void appendSongsToPlayer(nodeId, songs);
}

/** replaces the remote player's whole queue - only meant for a confirmed
 * "replace" choice (see ReplaceQueueConfirmModal.tsx); a plain add/insert
 * should always go through mirrorAppendToQueue instead. */
export function mirrorReplaceQueue(songs: Song[]): void {
  if (!isRemoteTargetActive() || songs.length === 0) return;
  const nodeId = activeTargetNodeId();
  if (!nodeId) return;
  void pushSongsToPlayer(nodeId, songs);
}
