// shared "pick a playback target" logic - used by QueuePlayerTargetRow's
// flyout menu, so the actual pause/handoff/push behavior lives in exactly
// one place.

import { appState } from "../storage/db";
import { mediaItemKey, type MediaItem } from "../storage/mediaItem";
import { currentTime, isPlaying, pause } from "../../../music/services/audio/player";
import { setActiveTargetToLocal, setActiveTargetToPlayer } from "./activeTarget";
import { appendMediaToPlayer, pushMediaToPlayer } from "./playerQueuePush";
import { registerPendingMediaOp } from "./remoteQueueMirror";
import {
  fetchRemoteStatus,
  remoteSeek,
  remoteTrackPending,
  remoteTuneRadio,
  resetRemoteStatus,
} from "./remotePlaybackControl";
import {
  leaveRadio,
  radioCurrentPeerAddr,
  radioCurrentStationId,
  radioStatus,
} from "../radio/radioService";
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

export async function selectLocalPlaybackTarget(): Promise<void> {
  setActiveTargetToLocal();
}

/** hands off the CURRENTLY-TUNED radio station to `player` instead of the
 * regular queue - radio is a wholly separate playback session (see
 * radioService.ts), so "what's playing right now" means the tune-in, not
 * whatever's sitting (paused) in the queue underneath it. mirrors
 * `selectPlayerPlaybackTarget`'s queue path: stop listening locally right
 * away (same "don't play in two places at once" reasoning as its `pause()`
 * call), fall back to local on failure so the picker never gets stuck
 * pointed at an unreachable target. */
async function selectPlayerPlaybackTargetForRadio(
  player: { node_id: string; username: string },
  peerAddr: string,
  stationId: string | null
): Promise<void> {
  setActiveTargetToPlayer(player);
  resetRemoteStatus();
  leaveRadio();
  try {
    await remoteTrackPending(remoteTuneRadio(peerAddr, stationId ?? undefined));
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "failed to send radio station to player", {
      title: "remote-player-connection-error",
    });
    setActiveTargetToLocal();
  }
}

export async function selectPlayerPlaybackTarget(player: {
  node_id: string;
  username: string;
}): Promise<void> {
  const radioPeerAddr = radioCurrentPeerAddr();
  if (radioPeerAddr && radioStatus() !== "idle") {
    return selectPlayerPlaybackTargetForRadio(player, radioPeerAddr, radioCurrentStationId());
  }

  const items = mediaToHandOff();
  // capture this device's own playback position *before* switching targets,
  // so a song already playing here can hand off mid-track instead of
  // restarting the player at 0 - only used below when we actually take over
  // "now playing" (the push branch, not append).
  const handoffPositionMs = isPlaying() ? Math.round(currentTime() * 1000) : undefined;

  // flips the playerbar into remote-driven mode (shows the connecting/
  // loading state until the first status arrives - see
  // remoteStatusKnown()/barIsLoading() in AppLayout.tsx). player.ts's
  // playSong/playVideo already guard against *new* local plays once a
  // remote target is active, so nothing else can start in the meantime.
  setActiveTargetToPlayer(player);
  // don't let a previous target's stale status (e.g. switching directly
  // from one player to another) show through while we're connecting to
  // this one - see resetRemoteStatus()'s doc comment.
  resetRemoteStatus();
  // stop this device's own audio RIGHT NOW rather than waiting for the
  // push/append/seek round-trip below to finish (previously done at the
  // very end of this function, after those awaits) - a slow handoff
  // (blob import + artwork resize over the wire, esp. for video) could
  // take several seconds, during which the remote might already be
  // audibly playing while this device's audio kept going too. a real
  // report of exactly that ("didn't stop playing its local audio once
  // the remote player started playing") - a brief instant of silence
  // during handoff is far less jarring than both playing at once.
  pause();

  if (items.length === 0) {
    // nothing local to hand off (nothing was playing locally either, so
    // there's no in-progress audio to worry about stopping) - still worth
    // syncing with whatever the player's already doing instead of erroring
    // out and leaving this device with a stale/empty queue view.
    try {
      await fetchRemoteStatus();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "failed to reach player", {
        title: "remote-player-connection-error",
      });
      // fetchRemoteStatus() throwing here means the player was
      // unreachable from the very first dial - remoteStatusKnown() will
      // then never become true, so the "connecting" comet ring (see
      // QueuePlayerTargetRow's isConnecting()) would otherwise spin
      // forever and the picker would stay stuck on a dead target. fall
      // back to local so the ui reflects reality instead.
      setActiveTargetToLocal();
    }
    return;
  }

  try {
    // show the whole intended hand-off in the queue view immediately -
    // resetRemoteStatus() above already cleared remoteQueue() to empty, so
    // without this the queue view would sit empty for the entire
    // fetchRemoteStatus + push/append + rathole download/import round
    // trip below (can be several seconds for more than a song or two).
    const clearPending = registerPendingMediaOp("replace", items);
    try {
      // don't clobber a session someone else already started on this
      // player - if it's already playing/paused/buffering (anything but
      // "stopped", i.e. nothing loaded), add our items to the end of its
      // queue instead of replacing it, and don't touch its current playback.
      const status = await fetchRemoteStatus();
      if (status && status.state !== "stopped") {
        // this device may have been away for a while (played locally, then
        // picked this player again) - don't blindly re-append songs the
        // player already dealt with this session (played/skipped/removed)
        // or already has queued from another client in the meantime.
        // videos have no pre-upload hash to check against, so they're
        // always re-sent here - no cheap way to tell if this exact video
        // is already remotely queued.
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
    } finally {
      clearPending();
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "failed to send queue to player", {
      title: "remote-player-connection-error",
    });
    // same reasoning as the empty-handoff branch above - a failure here
    // (most commonly fetchRemoteStatus() itself throwing, i.e. the player
    // was never reachable) would otherwise leave activeTarget stuck on a
    // dead player forever, with the "connecting" ring never clearing since
    // remoteStatusKnown() never becomes true.
    setActiveTargetToLocal();
  }
}
