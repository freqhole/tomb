// MediaItem — the discriminated union that lets the shared queue/player
// hold either a song or a video. see docs/video-domain-plan.md's phase 9
// section for the design rationale.
//
// scope note (phase 9 MVP slice): audio-only side mechanics that predate
// this union — queue history re-queue entries, server-side listen
// sessions, P2P pre-caching/eviction, local-sync tracking — still operate
// on `Song` directly. callers extract the song subset of a `MediaItem[]`
// queue via `songsOnly()` before handing off to those Song-typed helpers,
// so video items simply don't participate in those systems yet. this is
// additive scoping (per the plan doc), not a functional regression for
// existing music playback.

import type { Video } from "@freqhole/api-client";
import type { Song } from "../../../music/services/storage/types";

/** app-local extension of the generated `Video` type — mirrors how `Song`
 * already carries queue/sync bookkeeping fields that aren't part of the
 * server schema. */
export interface QueuedVideo extends Video {
  /** assigned when the video is added to the queue (progress tracking). */
  queue_entry_id?: string;
  /** which remote this video came from — required for remote/server-backed
   * videos (resolved via the remote transport blob path), absent for a
   * locally-imported (OPFS-backed) video. */
  remote_server_id?: string;
  /** `"local"` for a browser-imported video stored in OPFS (see
   * `video/services/opfs/helpers.ts`), `"remote"` for a server-backed
   * video. mirrors `Song.source_type`, simplified (no downloaded/synced
   * variants yet for video). */
  source_type: "local" | "remote";
  /** local/imported videos: OPFS path for the video file. */
  opfs_path?: string | null;
  /** local/imported videos: OPFS path for the generated poster thumbnail. */
  poster_opfs_path?: string | null;
}

export type MediaItem = { kind: "song"; song: Song } | { kind: "video"; video: QueuedVideo };

export function songToMediaItem(song: Song): MediaItem {
  return { kind: "song", song };
}

export function videoToMediaItem(video: QueuedVideo): MediaItem {
  return { kind: "video", video };
}

export function isSongItem(item: MediaItem): item is { kind: "song"; song: Song } {
  return item.kind === "song";
}

export function isVideoItem(item: MediaItem): item is { kind: "video"; video: QueuedVideo } {
  return item.kind === "video";
}

/** extract just the songs from a mixed-media list, in order. */
export function songsOnly(items: MediaItem[]): Song[] {
  return items.filter(isSongItem).map((i) => i.song);
}

/** extract just the videos from a mixed-media list, in order. */
export function videosOnly(items: MediaItem[]): QueuedVideo[] {
  return items.filter(isVideoItem).map((i) => i.video);
}

/** stable identity key across kinds — `Song.sha256` for songs,
 * `Video.id` for videos. used everywhere queue code used to compare
 * `.sha256` for dedup/lookup. */
export function mediaItemKey(item: MediaItem): string {
  return item.kind === "song" ? item.song.sha256 : item.video.id;
}

export function mediaItemTitle(item: MediaItem): string {
  return item.kind === "song" ? item.song.title : item.video.title;
}

export function mediaItemSubtitle(item: MediaItem): string | null {
  if (item.kind === "song") return item.song.artist_name ?? null;
  return null;
}

export function mediaItemDurationSeconds(item: MediaItem): number | null {
  return item.kind === "song" ? item.song.duration_seconds : (item.video.duration_seconds ?? null);
}

export function mediaItemQueueEntryId(item: MediaItem): string | undefined {
  return item.kind === "song" ? item.song.queue_entry_id : item.video.queue_entry_id;
}

/** returns a new MediaItem with `queue_entry_id` set (only if not already
 * set) — used by `setQueue` to assign a stable progress-tracking id. */
export function withQueueEntryId(item: MediaItem, id: string): MediaItem {
  if (item.kind === "song") {
    if (item.song.queue_entry_id) return item;
    return { kind: "song", song: { ...item.song, queue_entry_id: id } };
  }
  if (item.video.queue_entry_id) return item;
  return { kind: "video", video: { ...item.video, queue_entry_id: id } };
}

/** find an item's index in a queue by its cross-kind identity key. */
export function findMediaItemIndex(items: MediaItem[], key: string | null | undefined): number {
  if (!key) return -1;
  return items.findIndex((i) => mediaItemKey(i) === key);
}

function isMediaItem(value: Song | MediaItem): value is MediaItem {
  return typeof value === "object" && value !== null && "kind" in value;
}

/** normalize a queue-input array that may still be a legacy all-`Song[]`
 * call (most existing callers) or a mixed `MediaItem[]` call (playlist
 * rows, once a playlist has video items) into one `MediaItem[]` — lets
 * `playQueue`/`addToQueue` accept either shape without every caller having
 * to convert first. */
export function toMediaItems(items: Array<Song | MediaItem>): MediaItem[] {
  return items.map((item) => (isMediaItem(item) ? item : songToMediaItem(item)));
}
