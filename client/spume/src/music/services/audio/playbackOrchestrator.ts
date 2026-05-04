// playback orchestrator.
//
// **what**: subscribes to the playback progress signals
// (`currentTime`/`duration`) and the active song, and runs the
// per-tick app-level side effects that used to live inside
// `HtmlAudioBackend`'s `timeupdate` handler:
//
//   1. listen-history progress accumulation (`recordTimeProgress`)
//   2. per-queue-row progress fill (`updateQueueItemProgress`)
//   3. >=90% completion detection (`markSongCompleted` +
//      `queueAnalyticsEvent("play_complete")`)
//
// **why a separate module**: these are queue/analytics concerns,
// not playback concerns. extracting them lets both the html and
// rodio backends benefit from the same orchestration without
// duplicating logic in each backend's event handlers. when rodio
// is the active backend, it emits `progress` PlayerEvents which
// `playerStateSync` mirrors onto the same signals this orchestrator
// observes, so everything just works.
//
// **per-song debounce**: tracks `completionRecordedFor` so each song
// fires the >=90% events at most once. resets on song change.
//
// **delta filtering**: only records listen progress for forward
// time deltas in (0, 5)s — large jumps are seek operations, not
// listening time.

import { createEffect, createRoot } from "solid-js";
import { appState } from "../../../app/services/storage/db";
import {
  activeHistoryEntryId,
  markSongCompleted,
  recordTimeProgress,
} from "../queue/listenProgress";
import { updateQueueItemProgress } from "../queue/queueProgress";
import { queueAnalyticsEvent } from "../analytics/analyticsQueue";
import { currentTime, duration } from "./playerState";

// max delta (seconds) between consecutive ticks that we'll attribute
// to actual listening. anything above this is almost certainly a
// seek and shouldn't be added to the user's listen-time tally.
const MAX_DELTA_SECONDS = 5;

// fraction of the song that must elapse to count as "completed"
// for analytics + listen history purposes.
const COMPLETION_THRESHOLD = 0.9;

let installed = false;
let lastTimeForSha: string | null = null;
let lastTimeValue = 0;
let completionRecordedFor: string | null = null;

/**
 * install the playback orchestrator. idempotent — subsequent calls
 * are no-ops. invoked from the player facade at module init.
 */
export function installPlaybackOrchestrator(): void {
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

      // reset per-song bookkeeping when the active song changes.
      if (lastTimeForSha !== current_sha256) {
        lastTimeForSha = current_sha256;
        lastTimeValue = ct;
        completionRecordedFor = null;
        return;
      }

      const songIdx = queue.findIndex((s) => s.sha256 === current_sha256);
      const currentSong = songIdx >= 0 ? queue[songIdx] : null;

      // 1. listen-history progress accumulation. only counts forward
      //    motion within the small-delta window so seeks don't pad
      //    the listen tally.
      if (activeHistoryEntryId() && ct > lastTimeValue) {
        const delta = ct - lastTimeValue;
        if (delta > 0 && delta < MAX_DELTA_SECONDS) {
          recordTimeProgress(delta, songIdx >= 0 ? songIdx : 0, ct, currentSong);
        }
      }
      lastTimeValue = ct;

      // need a meaningful duration for the rest.
      if (!Number.isFinite(dur) || dur <= 0) return;

      const progress = ct / dur;

      // 2. per-queue-row visual fill.
      if (currentSong?.queue_entry_id) {
        updateQueueItemProgress(currentSong.queue_entry_id, progress);
      }

      // 3. completion marker — fires once per song at the threshold.
      if (
        activeHistoryEntryId() &&
        completionRecordedFor !== current_sha256 &&
        progress >= COMPLETION_THRESHOLD
      ) {
        completionRecordedFor = current_sha256;
        markSongCompleted(songIdx >= 0 ? songIdx : 0, currentSong);

        if (currentSong) {
          let targetBaseUrl: string | undefined;
          try {
            if (currentSong.source_url) {
              targetBaseUrl = new URL(currentSong.source_url).origin;
            }
          } catch {
            // non-parseable url, skip base_url routing.
          }
          void queueAnalyticsEvent("play_complete", {
            media_blob_id: currentSong.media_blob_id ?? currentSong.sha256,
            song_id: currentSong.id,
            target_remote_id: currentSong.remote_server_id ?? undefined,
            target_base_url: targetBaseUrl,
          });
        }
      }
    });
  });
}
