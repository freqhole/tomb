// shared "pick a playback target" logic - used by QueuePlayerTargetRow's
// flyout menu, so the actual pause/handoff/push behavior lives in exactly
// one place.

import { appState } from "../storage/db";
import { songsOnly } from "../storage/mediaItem";
import { pause } from "../../../music/services/audio/player";
import { setActiveTargetToLocal, setActiveTargetToPlayer } from "./activeTarget";
import { pushSongsToPlayer, appendSongsToPlayer } from "./playerQueuePush";
import { fetchRemoteStatus } from "./remotePlaybackControl";
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
  // a remote target owns playback now - stop this device's own local
  // audio immediately rather than letting both play at once (player.ts's
  // playSong/playVideo also guard against future local plays while remote
  // is active, but anything already playing needs an explicit stop here).
  pause();
  setActiveTargetToPlayer(player);
  if (songs.length === 0) {
    toast.error("nothing in the queue to hand off yet");
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
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "failed to send queue to player");
  }
}
