// remote/server video playback-progress sync — deliberately infrequent.
//
// local granular position tracking already happens via
// `videoListenProgress.ts`'s 5s IDB flush (unchanged by this file). this
// module is the ONLY thing that talks to the server about video
// progress, and per explicit product direction it must stay much less
// chatty than the local tracker: a periodic ~60s tick while actively
// playing, plus one best-effort attempt on `beforeunload`. never call
// `client.video.upsertPlaybackProgress` from a timeupdate/5s-flush
// cadence — that would be excessive network traffic for no user-visible
// benefit.

import { appState } from "../../../app/services/storage/db";
import { videosOnly, type QueuedVideo } from "../../../app/services/storage/mediaItem";
import { currentTime, duration, isPlaying } from "../../../music/services/audio/playerState";
import { getClientForRemote } from "../../../app/api/client";
import { getRemoteById } from "../../../app/services/remotes/remoteManager";
import { activeVideoHistoryEntryId } from "./videoListenProgress";
import { warn } from "../../../utils/logger";

// intentionally far less frequent than the 5s local IDB flush.
const REMOTE_SYNC_INTERVAL_MS = 60_000;

let intervalId: ReturnType<typeof setInterval> | null = null;
let beforeUnloadHandler: (() => void) | null = null;

function resolveCurrentVideo(): QueuedVideo | null {
  const state = appState();
  if (!state || !state.current_sha256) return null;
  const queueVideos = videosOnly(state.queue);
  return queueVideos.find((v) => v.id === state.current_sha256) ?? null;
}

// pushes the currently-playing video's position to the server.
// entity_type/entity_id: series/season-level progress has no established
// precedent in this codebase yet, so this always reports at the
// individual-video granularity (entity_type "video", entity_id = video.id).
async function syncCurrentVideoProgress(): Promise<void> {
  const video = resolveCurrentVideo();
  if (!video) return;
  // locally-imported (OPFS) videos have no server to report progress to.
  if (video.source_type !== "remote" || !video.remote_server_id) return;

  const dur = duration();
  const ct = currentTime();
  if (!Number.isFinite(dur) || dur <= 0) return;

  const positionFraction = Math.max(0, Math.min(1, ct / dur));

  try {
    const remote = await getRemoteById(video.remote_server_id);
    if (!remote) return;
    const client = await getClientForRemote(remote);
    await client.video.upsertPlaybackProgress({
      entity_type: "video",
      entity_id: video.id,
      position_fraction: positionFraction,
      position_seconds: ct,
      duration_seconds: dur,
    });
  } catch (err) {
    warn("video/serverProgressSync", "failed to sync playback progress:", err);
  }
}

/**
 * start the ~60s periodic sync + `beforeunload` best-effort sync.
 * idempotent — calling this while already running just restarts the
 * interval (safe to call from both `playVideoQueue` and
 * `resumeVideoHistoryEntry`). self-tears-down once local tracking stops
 * (`activeVideoHistoryEntryId()` goes null), so an explicit
 * `stopVideoRemoteSync()` call at every teardown site isn't required,
 * though callers are free to call it directly too.
 */
export function startVideoRemoteSync(): void {
  stopVideoRemoteSync();

  intervalId = setInterval(() => {
    if (!activeVideoHistoryEntryId()) {
      stopVideoRemoteSync();
      return;
    }
    if (!isPlaying()) return;
    void syncCurrentVideoProgress();
  }, REMOTE_SYNC_INTERVAL_MS);

  beforeUnloadHandler = () => {
    // best-effort only: browsers restrict async work during beforeunload,
    // and `navigator.sendBeacon` can't carry this client's Bearer-auth
    // header or target the non-http transports (p2p/charnel/wasm) this
    // codebase supports, so a fire-and-forget promise is the practical
    // choice here rather than a beacon.
    void syncCurrentVideoProgress();
  };
  window.addEventListener("beforeunload", beforeUnloadHandler);
}

/** stop the periodic sync and remove the `beforeunload` listener. safe
 * to call even if sync was never started. */
export function stopVideoRemoteSync(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  if (beforeUnloadHandler) {
    window.removeEventListener("beforeunload", beforeUnloadHandler);
    beforeUnloadHandler = null;
  }
}
