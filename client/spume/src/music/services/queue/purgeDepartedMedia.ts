// tier-2 purge for media that has left the queue.
//
// registered once against `setQueue`'s departure diff, replacing the five
// copy-pasted eviction blocks that used to live in queue.ts. those blocks
// covered only 5 of 13 queue-mutation sites, skipped video entirely, and
// evicted P2P blobs under the wrong key.
//
// only tier 2 (the api cache) is purged here. a library copy of a synced
// item is permanent and must survive leaving the queue.

import { registerQueueDeparture } from "../../../app/services/media/queueDeparture";
import type { MediaItem } from "../../../app/services/storage/mediaItem";
import { evictCachedBlob } from "../cache/blobCache";
import { cancelP2PDownload, evictP2PBlob } from "../storage/blobResolver";
import { debug } from "../../../utils/logger";

/** every key a departed item's bytes might be cached under.
 *
 * the cache key differs by transport: the HTTP path keys audio by content
 * hash, while the P2P path keys by the remote's `media_blob_id`. an item can
 * only have been fetched over one of them, but which one isn't known here, so
 * both are purged. DEPRECATED(sha256): the hash key disappears once the
 * library is keyed by blake3. */
function cacheKeysFor(item: MediaItem): { remoteId: string; keys: string[] } | null {
  if (item.kind === "song") {
    const song = item.song;
    if (song.source_type !== "remote" || !song.remote_server_id) return null;
    const keys = [song.media_blob_id, song.sha256].filter((k): k is string => !!k);
    return keys.length ? { remoteId: song.remote_server_id, keys } : null;
  }

  const video = item.video;
  if (video.source_type !== "remote" || !video.remote_server_id || !video.media_blob_id) {
    return null;
  }
  return { remoteId: video.remote_server_id, keys: [video.media_blob_id] };
}

/** every remote image blob an item references (art, waveform, thumbnail).
 * album art is routinely shared across a whole album's worth of queued songs,
 * so these are refcounted against the surviving queue before being purged. */
function imageRefsFor(item: MediaItem): Array<{ remoteId: string; blobId: string }> {
  const refs: Array<{ remoteId: string; blobId: string }> = [];

  if (item.kind === "song") {
    const song = item.song;
    const all = [
      ...(song.images ?? []),
      ...(song.album_images ?? []),
      ...(song.artist_images ?? []),
    ];
    for (const img of all) {
      if (img.remote_blob_id && img.remote_server_id) {
        refs.push({ remoteId: img.remote_server_id, blobId: img.remote_blob_id });
      }
    }
    return refs;
  }

  // video images carry no remote of their own - they belong to the video's
  const video = item.video;
  if (!video.remote_server_id) return refs;
  for (const img of video.images ?? []) {
    if (img.blob_id) refs.push({ remoteId: video.remote_server_id, blobId: img.blob_id });
  }
  if (video.poster_blob_id) {
    refs.push({ remoteId: video.remote_server_id, blobId: video.poster_blob_id });
  }
  return refs;
}

export async function purgeDepartedMedia(
  items: MediaItem[],
  remaining: MediaItem[] = []
): Promise<void> {
  for (const item of items) {
    const target = cacheKeysFor(item);
    if (!target) continue;
    for (const key of target.keys) {
      cancelP2PDownload(key, target.remoteId);
      await evictCachedBlob(target.remoteId, key);
      await evictP2PBlob(key, target.remoteId);
    }
  }

  // images are shared, so only purge those nothing still queued refers to
  const stillReferenced = new Set<string>();
  for (const item of remaining) {
    for (const ref of imageRefsFor(item)) {
      stillReferenced.add(`${ref.remoteId}/${ref.blobId}`);
    }
  }
  const purgedImages = new Set<string>();
  for (const item of items) {
    for (const ref of imageRefsFor(item)) {
      const key = `${ref.remoteId}/${ref.blobId}`;
      if (stillReferenced.has(key) || purgedImages.has(key)) continue;
      purgedImages.add(key);
      await evictCachedBlob(ref.remoteId, ref.blobId);
      await evictP2PBlob(ref.blobId, ref.remoteId);
    }
  }

  debug("queueDeparture", `purged tier-2 bytes for ${items.length} departed item(s)`);
}

let registered = false;

export function initQueueDeparturePurge(): void {
  if (registered) return;
  registered = true;
  registerQueueDeparture((items, remaining) => purgeDepartedMedia(items, remaining));
}
