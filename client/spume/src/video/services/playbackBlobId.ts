// resolves which blob to actually play/sync for a video: the first
// available transcoded rendition, if the server has produced one, else
// the original blob.
//
// `Video.renditions` (and each rendition's own `blake3`/`mime`) is
// embedded directly on every video the client already fetches (list,
// detail, queue push - see `video_query_view.sql`, mirroring how
// `Video.images` already worked) - so this is now a plain, synchronous,
// no-network-round-trip decision. previously this required an async
// `client.video.getVideoRenditions()` call per video per play (and, for
// a video whose "remote" is actually charnel's own local instance, a
// pointless network/P2P round trip for data that was always just a
// local db read away).
//
// lives in its own module (not videoBlobAccess.ts, where this used to
// live) so both `videoBlobAccess.ts` and `sync/syncVideoToLocal.ts` can
// import it without creating a circular dependency between those two
// files (madge's `lint:circular` flagged the cycle this broke).

import type { QueuedVideo } from "../../app/services/storage/mediaItem";

/** the blob actually being played/synced - either a rendition or (when
 * none exists) the video's own original. */
export interface PlaybackTarget {
  blobId: string;
  /** `null` when neither the target rendition nor the original carries
   * a known blake3 (rare - only an original imported before migration
   * 084 added `Video.blake3` would lack one). */
  blake3: string | null;
  /** `null` for the original (its mime isn't embedded on `Video` itself -
   * callers that need it already resolve it via `freqhole-media://`'s
   * own mime-sniffing, or a metadata round trip for remote streaming). */
  mime: string | null;
}

/** resolve which blob to actually play/sync for a video: the first
 * embedded rendition if one exists, else the original. synchronous - no
 * network/IPC call, since `video.renditions` already carries everything
 * needed (see this module's doc comment). */
export function resolvePlaybackTarget(video: QueuedVideo): PlaybackTarget {
  const rendition = video.renditions?.[0];
  if (rendition) {
    return {
      blobId: rendition.blob_id,
      blake3: rendition.blake3 ?? null,
      mime: rendition.mime ?? null,
    };
  }
  return { blobId: video.media_blob_id, blake3: video.blake3 ?? null, mime: null };
}
