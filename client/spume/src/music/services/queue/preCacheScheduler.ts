// pre-cache scheduler.
//
// **what**: subscribes to the playback progress signals and triggers
// `preCacheNextSongs` + `preCacheNextP2PSongs` + `preCacheNextVideos`
// once per item when the listener crosses the 50% mark. extracted from
// `audio/player.ts` (was `HtmlAudioBackend.handlePreCacheNext`) so it's
// backend-agnostic — same threshold logic applies whether playback is
// going through the html `<audio>` element, rodio, or the video backend.
//
// **why a separate module**: pre-caching is a queue concern, not a
// playback concern. the backend just plays bytes. moving this out of
// the dom event handler also means we no longer recompute the
// threshold on every `timeupdate` tick (fires ~4hz); we recompute
// only when solid invalidates the effect, which is the same cadence
// since `currentTime` is what `timeupdate` writes.
//
// **per-item debounce**: tracks `lastPreCachedFor` so each item only
// triggers the pre-cache once. resets when `current_sha256` changes
// in `appState`.

import { createEffect, createRoot } from "solid-js";
import { appState } from "../../../app/services/storage/db";
import {
  songsOnly,
  videosOnly,
  songStartIndexAfter,
  videoStartIndexAfter,
} from "../../../app/services/storage/mediaItem";
import { preCacheNextSongs } from "../cache/blobCache";
import { preCacheNextP2PSongs } from "../storage/blobResolver";
import { preCacheNextVideos } from "../../../video/services/videoPreCache";
import { currentTime, duration } from "../audio/playerState";
import { debug } from "../../../utils/logger";

// rolling cache window in minutes. matches the historical value from
// `player.ts` — half an hour ahead of the listener seems to be the
// sweet spot for slow p2p without ballooning storage.
const PRE_CACHE_MINUTES_AHEAD = 30;

// fraction of the current song that must elapse before we kick off
// pre-caching. half-way through is late enough that a quickly-skipped
// song doesn't waste bandwidth, but early enough that the next track
// has time to download before it plays.
const PRE_CACHE_TRIGGER_FRACTION = 0.5;

let installed = false;
let lastPreCachedFor: string | null = null;

/**
 * install the pre-cache scheduler. idempotent — subsequent calls are
 * no-ops. invoked from the player facade at module init.
 */
export function installPreCacheScheduler(): void {
  if (installed) return;
  installed = true;

  // detached root: this effect lives for the life of the app, but we
  // own the dispose handle in case a future caller wants to tear it
  // down (e.g. in tests).
  createRoot(() => {
    createEffect(() => {
      const t = currentTime();
      const d = duration();
      const state = appState();
      if (!state) return;
      const { queue, current_sha256 } = state;
      if (!current_sha256 || !queue.length) return;

      // reset the per-song debounce when the active song changes.
      if (current_sha256 !== lastPreCachedFor) {
        // active song changed — clear the debounce so the new song
        // can trigger. don't pre-cache yet; wait for progress.
        if (lastPreCachedFor !== null) {
          lastPreCachedFor = null;
        }
      }

      // already pre-cached for this song.
      if (lastPreCachedFor === current_sha256) return;

      // need a meaningful duration to compute progress.
      if (!Number.isFinite(d) || d <= 0) return;

      const progress = t / d;
      if (progress < PRE_CACHE_TRIGGER_FRACTION) return;

      lastPreCachedFor = current_sha256;
      debug("player", `pre-caching next media (~${PRE_CACHE_MINUTES_AHEAD} min)`);
      // song and video pre-caching run as two independent rolling
      // windows over their own kind's subset of the queue, each keyed
      // off the current item's position in the FULL mixed queue (not
      // its position within the kind-filtered subset) — so upcoming
      // songs keep getting pre-cached while a video is playing, and
      // vice versa. see `songStartIndexAfter`/`videoStartIndexAfter`.
      const queueSongs = songsOnly(queue);
      const queueVideos = videosOnly(queue);
      const songStart = songStartIndexAfter(queue, current_sha256);
      const videoStart = videoStartIndexAfter(queue, current_sha256);
      void preCacheNextSongs(current_sha256, queueSongs, PRE_CACHE_MINUTES_AHEAD, songStart);
      void preCacheNextP2PSongs(current_sha256, queueSongs, PRE_CACHE_MINUTES_AHEAD, songStart);
      void preCacheNextVideos(queueVideos, PRE_CACHE_MINUTES_AHEAD, videoStart);
    });
  });
}
