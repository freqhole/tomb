// resolves which blob id to actually play/sync for a video: the first
// available transcoded rendition, if the server has produced one, else
// the original blob.
//
// lives in its own module (not videoBlobAccess.ts, where this used to
// live) so both `videoBlobAccess.ts` and `sync/syncVideoToLocal.ts` can
// import it without creating a circular dependency between those two
// files (madge's `lint:circular` flagged the cycle this broke).

import { getClientForRemote } from "../../app/api/client";
import { getRemoteById } from "../../app/services/remotes/remoteManager";
import type { QueuedVideo } from "../../app/services/storage/mediaItem";
import { warn } from "../../utils/logger";

/** resolve the media_blob_id to actually play for a remote video: the
 * first available transcoded rendition, if the server has produced one,
 * else the original blob. failures fall back to the original silently
 * (rendition playback is a nice-to-have, never a hard requirement).
 * exported so `syncVideoToLocal` can sync whichever blob is actually
 * played, without re-deriving this selection logic. */
export async function resolvePlaybackBlobId(video: QueuedVideo, remoteId: string): Promise<string> {
  const mediaBlobId = video.media_blob_id!;
  try {
    const remote = await getRemoteById(remoteId);
    if (!remote) return mediaBlobId;
    const client = await getClientForRemote(remote);
    const result = await client.video.getVideoRenditions({ media_blob_id: mediaBlobId });
    if (result.success) {
      // "skipped" entries are synthesized placeholders (empty blob_id)
      // for rendition targets the transcode job decided not to produce
      // (source already compatible) - never actually playable blobs.
      const playable = result.data.find((r) => !r.skipped && r.blob_id);
      if (playable) {
        return playable.blob_id;
      }
    }
  } catch (err) {
    warn("videoBlobAccess", `failed to resolve renditions for ${mediaBlobId}:`, err);
  }
  return mediaBlobId;
}
