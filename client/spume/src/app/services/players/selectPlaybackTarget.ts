// shared "pick a playback target" logic - used by QueuePlayerTargetRow's
// flyout menu, so the actual pause/handoff/push behavior lives in exactly
// one place.

import { appState, setQueue, updateAppState } from "../storage/db";
import {
  mediaItemKey,
  songToMediaItem,
  songsOnly,
  videoToMediaItem,
  videosOnly,
  type MediaItem,
} from "../storage/mediaItem";
import { currentTime, isPlaying, pause } from "../../../music/services/audio/player";
import {
  isRemoteTargetActive,
  setActiveTargetToLocal,
  setActiveTargetToPlayer,
} from "./activeTarget";
import { appendMediaToPlayer, pushMediaToPlayer } from "./playerQueuePush";
import {
  fetchRemoteStatus,
  remoteQueue,
  remoteSeek,
  remoteStatusKnown,
  remoteTrackPending,
  resetRemoteStatus,
} from "./remotePlaybackControl";
import { toast } from "../../../components/feedback/Toast";

/** songs and/or videos from the current queue, starting at whatever's
 * currently playing (falls back to the whole queue if nothing's marked
 * current) - order-preserving, so a mixed queue hands off interleaved,
 * not songs-then-videos. */
function mediaToHandOff(): MediaItem[] {
  const state = appState();
  if (!state) return [];
  const idx = state.queue.findIndex((i) => mediaItemKey(i) === state.current_sha256);
  return idx >= 0 ? state.queue.slice(idx) : state.queue;
}

/** on switching back to local playback, trims the local queue's SONGS down
 * to whatever the remote target still actually has queued (by blake3 hash,
 * remote order preserved) - so a later reconnect to the same/another
 * player doesn't re-hand-off songs it already played through while this
 * device was showing its own, now-stale, full queue. a no-op if no remote
 * target was active/known, or if nothing local matches the remote queue at
 * all (leaves the local queue untouched rather than blanking it - better
 * to keep something than silently wipe a queue over a fluke mismatch).
 * videos are left untouched (appended back after the resynced songs) -
 * the remote's blake3-keyed queue has no pre-upload hash to match a local
 * video against, so there's nothing to resync them from; the previous
 * version of this function dropped them entirely by reassigning the whole
 * queue to `kept` songs only. */
async function syncLocalQueueFromRemote(): Promise<void> {
  if (!isRemoteTargetActive() || !remoteStatusKnown()) return;
  const remoteOrder = new Map(remoteQueue().map((ref, i) => [ref.blake3_hash, i]));
  if (remoteOrder.size === 0) return;
  const state = appState();
  if (!state) return;
  const localSongs = songsOnly(state.queue);
  const keptSongs = localSongs
    .filter((s) => s.blake3 && remoteOrder.has(s.blake3))
    .sort((a, b) => remoteOrder.get(a.blake3 as string)! - remoteOrder.get(b.blake3 as string)!);
  if (keptSongs.length === 0) return;
  const videos = videosOnly(state.queue);
  await setQueue([...keptSongs.map(songToMediaItem), ...videos.map(videoToMediaItem)]);
  await updateAppState({ current_sha256: keptSongs[0].sha256 });
}

export async function selectLocalPlaybackTarget(): Promise<void> {
  await syncLocalQueueFromRemote();
  setActiveTargetToLocal();
}

export async function selectPlayerPlaybackTarget(player: {
  node_id: string;
  display_name: string;
}): Promise<void> {
  const items = mediaToHandOff();
  // capture this device's own playback position *before* switching targets,
  // so a song already playing here can hand off mid-track instead of
  // restarting the player at 0 - only used below when we actually take over
  // "now playing" (the push branch, not append).
  const handoffPositionMs = isPlaying() ? Math.round(currentTime() * 1000) : undefined;

  // flips the playerbar into remote-driven mode (shows the connecting/
  // loading state until the first status arrives - see
  // remoteStatusKnown()/barIsLoading() in AppLayout.tsx) but does NOT stop
  // this device's own audio yet - playback keeps going right up until the
  // player has actually taken over, handed off below. player.ts's
  // playSong/playVideo already guard against *new* local plays once a
  // remote target is active, so nothing else can start in the meantime.
  setActiveTargetToPlayer(player);
  // don't let a previous target's stale status (e.g. switching directly
  // from one player to another) show through while we're connecting to
  // this one - see resetRemoteStatus()'s doc comment.
  resetRemoteStatus();

  if (items.length === 0) {
    // nothing local to hand off (nothing was playing locally either, so
    // there's no in-progress audio to worry about stopping) - still worth
    // syncing with whatever the player's already doing instead of erroring
    // out and leaving this device with a stale/empty queue view.
    try {
      await fetchRemoteStatus();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "failed to reach player");
    }
    return;
  }

  try {
    // don't clobber a session someone else already started on this
    // player - if it's already playing/paused/buffering (anything but
    // "stopped", i.e. nothing loaded), add our items to the end of its
    // queue instead of replacing it, and don't touch its current playback.
    const status = await fetchRemoteStatus();
    if (status && status.state !== "stopped") {
      // this device may have been away for a while (played locally, then
      // picked this player again) - don't blindly re-append songs the
      // player already dealt with this session (played/skipped/removed,
      // see playbackEngine.ts's recentlyPlayed) or already has queued from
      // another client in the meantime. videos have no pre-upload hash to
      // check against, so they're always re-sent here - no cheap way to
      // tell if this exact video is already remotely queued.
      const alreadyKnown = new Set([
        ...status.queue.map((ref) => ref.blake3_hash),
        ...status.recently_played,
      ]);
      const newItems = items.filter(
        (i) => i.kind === "video" || !i.song.blake3 || !alreadyKnown.has(i.song.blake3)
      );
      if (newItems.length > 0) {
        await remoteTrackPending(appendMediaToPlayer(player.node_id, newItems));
      }
    } else {
      await remoteTrackPending(pushMediaToPlayer(player.node_id, items));
      if (handoffPositionMs !== undefined) await remoteSeek(handoffPositionMs);
    }
    // the player has now taken over (either as the new now-playing session,
    // handed off at the captured position, or as an addition to its
    // existing one) - safe to stop this device's own audio.
    pause();
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "failed to send queue to player");
  }
}
