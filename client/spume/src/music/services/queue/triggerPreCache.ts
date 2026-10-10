// single canonical "fire the rolling pre-cache window" implementation —
// computes per-kind (song/video) start indices from a mixed queue and
// kicks off all three pre-cache paths (HTTP-cache songs, P2P/verified
// songs, videos) for whatever comes after `currentKey`.
//
// used from three call sites that all want the same thing but at
// different moments:
//   - queue.ts's playQueue/addToQueue — queue just (re)set or appended to.
//   - player.ts's playNext/playPrevious — playback just advanced to a new
//     track within an already-set, unchanged queue. this used to have no
//     immediate trigger at all — only preCacheScheduler.ts's 50%-progress
//     tick covered ongoing playback, which depends on `timeupdate` firing
//     reliably. that's fine in the foreground, but mobile background/
//     locked-screen playback can throttle `timeupdate` enough that the
//     threshold is crossed very late (or not at all) before the track
//     ends — so the next track's download never got the full track's
//     worth of lead time it needs. firing immediately on track-start
//     closes that gap without touching the progress-based trigger at all.
//   - preCacheScheduler.ts — the rolling 50%-through-the-current-track
//     trigger, kept as a second/backstop firing (e.g. if the queue grew
//     enough mid-track that the window needs extending).
//
// previously duplicated: queue.ts had its own `triggerImmediatePreCache`
// (P2P + video only, no HTTP-cache path) and preCacheScheduler.ts had an
// inline copy of the same index math (all three paths). one
// implementation now backs all three call sites.
import {
  songsOnly,
  videosOnly,
  songStartIndexAfter,
  videoStartIndexAfter,
  mediaItemKey,
  type MediaItem,
} from "../../../app/services/storage/mediaItem";
import { preCacheNextSongs } from "../cache/blobCache";
import { preCacheNextP2PSongs } from "../storage/blobResolver";
import { preCacheNextVideos } from "../../../video/services/videoPreCache";

export const PRE_CACHE_MINUTES_AHEAD = 30;

/**
 * @param mixedItems the full song+video queue, in queue order.
 * @param currentKey `mediaItemKey()` of the item that's (about to be)
 *   playing — may be a song or a video's key. no-ops if falsy.
 */
export function triggerPreCache(
  mixedItems: MediaItem[],
  currentKey: string | null | undefined
): void {
  if (!currentKey) return;
  const songs = songsOnly(mixedItems);
  const videos = videosOnly(mixedItems);
  const songStart = songStartIndexAfter(mixedItems, currentKey);
  const videoStart = videoStartIndexAfter(mixedItems, currentKey);
  const currentIsVideo = mixedItems.some(
    (i) => i.kind === "video" && mediaItemKey(i) === currentKey
  );
  // preCacheNextSongs/preCacheNextP2PSongs both use `currentSongId` to
  // find-and-include the current song itself (for immediate waveform
  // display) - that only makes sense when the current item really is a
  // song, so pass null (and rely on songStart) when it's a video instead.
  const currentSongKey = currentIsVideo ? null : currentKey;
  void preCacheNextSongs(currentSongKey, songs, PRE_CACHE_MINUTES_AHEAD, songStart);
  void preCacheNextP2PSongs(currentSongKey, songs, PRE_CACHE_MINUTES_AHEAD, songStart);
  void preCacheNextVideos(videos, PRE_CACHE_MINUTES_AHEAD, videoStart);
}
