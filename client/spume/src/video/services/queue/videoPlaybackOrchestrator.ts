// video playback orchestrator — mirrors
// `music/services/audio/playbackOrchestrator.ts`'s pattern for videos.
//
// **what**: subscribes to the shared playback progress signals
// (`currentTime`/`duration`, from `music/services/audio/playerState.ts`
// — video and song playback share these signals via `playerStateSync`,
// see `videoBackend.ts`'s header comment) and the active queue/current
// item, and runs the per-tick side effects that feed the already-built
// local watch-progress tracker (`videoListenProgress.ts`):
//
//   1. watch-history progress accumulation (`recordVideoTimeProgress`)
//   2. >=90% completion detection (`markVideoCompleted`)
//   3. completion-on-advance/skip: unlike the song orchestrator (which
//      only marks a song completed at the 90% threshold), a video that
//      the queue advances away from before reaching 90% is still
//      treated as "done with this item" for history purposes.
//
// **why a separate module**: same rationale as the song orchestrator —
// this is queue/history bookkeeping, not playback mechanics, and stays
// independent of which concrete backend (currently only `VideoBackend`)
// is driving playback.
//
// remote/server progress sync (periodic + beforeunload) is a distinct,
// much-less-frequent concern — see `videoServerProgressSync.ts`.

import { createEffect, createRoot } from "solid-js";
import { appState } from "../../../app/services/storage/db";
import { videosOnly } from "../../../app/services/storage/mediaItem";
import { currentTime, duration } from "../../../music/services/audio/playerState";
import { markVideoCompleted, recordVideoTimeProgress } from "./videoListenProgress";

// max delta (seconds) between consecutive ticks attributed to actual
// watching — anything larger is a seek, not watch time. mirrors the
// song orchestrator's MAX_DELTA_SECONDS.
const MAX_DELTA_SECONDS = 5;

// fraction of the video that must elapse to count as "completed".
const COMPLETION_THRESHOLD = 0.9;

let installed = false;
let lastTimeForId: string | null = null;
let lastTimeValue = 0;
let lastVideoIndex = -1;
let completionRecordedFor: string | null = null;

/**
 * install the video playback orchestrator. idempotent — subsequent
 * calls are no-ops. invoked from `videoBackend.ts` at module init (the
 * video-side counterpart of `player.ts`'s `installPlaybackOrchestrator()`
 * call, kept out of `music/services/**` per this feature's file scope).
 */
export function installVideoPlaybackOrchestrator(): void {
  if (installed) return;
  installed = true;

  createRoot(() => {
    createEffect(() => {
      const ct = currentTime();
      const dur = duration();
      const state = appState();
      if (!state) return;
      const { queue, current_sha256 } = state;
      if (!current_sha256) return;

      const queueVideos = videosOnly(queue);
      const videoIdx = queueVideos.findIndex((v) => v.id === current_sha256);
      const currentVideo = videoIdx >= 0 ? queueVideos[videoIdx] : null;
      if (!currentVideo) return;

      // active item changed (initial load, or advanced/skipped to a
      // different video). if the outgoing video never hit the 90%
      // completion marker, treat leaving it as completion anyway.
      if (lastTimeForId !== current_sha256) {
        if (
          lastTimeForId !== null &&
          completionRecordedFor !== lastTimeForId &&
          lastVideoIndex >= 0
        ) {
          markVideoCompleted(lastVideoIndex);
        }
        lastTimeForId = current_sha256;
        lastTimeValue = ct;
        lastVideoIndex = videoIdx;
        completionRecordedFor = null;
        return;
      }
      lastVideoIndex = videoIdx;

      // 1. watch-history progress accumulation, forward motion only.
      if (ct > lastTimeValue) {
        const delta = ct - lastTimeValue;
        if (delta > 0 && delta < MAX_DELTA_SECONDS) {
          recordVideoTimeProgress(delta, videoIdx, ct, currentVideo);
        }
      }
      lastTimeValue = ct;

      if (!Number.isFinite(dur) || dur <= 0) return;

      // 2. completion marker — fires once per video at the threshold.
      const progress = ct / dur;
      if (completionRecordedFor !== current_sha256 && progress >= COMPLETION_THRESHOLD) {
        completionRecordedFor = current_sha256;
        markVideoCompleted(videoIdx, currentVideo);
      }
    });
  });
}
