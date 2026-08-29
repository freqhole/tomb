// shared "pick a playback target" logic - used by QueuePlayerTargetRow's
// flyout menu, so the actual pause/handoff/push behavior lives in exactly
// one place.

import { appState } from "../storage/db";
import { songsOnly } from "../storage/mediaItem";
import { currentTime, isPlaying, pause } from "../../../music/services/audio/player";
import { setActiveTargetToLocal, setActiveTargetToPlayer } from "./activeTarget";
import { pushSongsToPlayer, appendSongsToPlayer } from "./playerQueuePush";
import { fetchRemoteStatus, remoteSeek, resetRemoteStatus } from "./remotePlaybackControl";
import { toast } from "../../../components/feedback/Toast";

/** songs from the current queue, starting at whatever's currently playing
 * (falls back to the whole queue if nothing's marked current). */
function songsToHandOff(): ReturnType<typeof songsOnly> {
  const state = appState();
  if (!state) return [];
  const songs = songsOnly(state.queue);
  const idx = songs.findIndex((s) => s.sha256 === state.current_sha256);
  return idx >= 0 ? songs.slice(idx) : songs;
}

export function selectLocalPlaybackTarget(): void {
  setActiveTargetToLocal();
}

export async function selectPlayerPlaybackTarget(player: {
  node_id: string;
  display_name: string;
}): Promise<void> {
  const songs = songsToHandOff();
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

  if (songs.length === 0) {
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
    // "stopped", i.e. nothing loaded), add our songs to the end of its
    // queue instead of replacing it, and don't touch its current playback.
    const status = await fetchRemoteStatus();
    if (status && status.state !== "stopped") {
      await appendSongsToPlayer(player.node_id, songs);
    } else {
      await pushSongsToPlayer(player.node_id, songs);
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
