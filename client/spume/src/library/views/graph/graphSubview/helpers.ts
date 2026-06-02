import type { ImageMetadata } from "../../../../music/services/storage/types";
import type { Remote } from "../../../../app/services/storage/schemas/remote";
import { resolveBlobUrl } from "../../../../music/services/storage/blobResolver";
import { usesBlobResolver } from "../../../../music/services/storage/transportCache";
import { resolveLocalBlobUrl } from "../../../../music/utils/images";

// pick the "best" artist image for avatar/glyph display. priority:
//   1. is_primary === true (user/server flagged as featured)
//   2. blob_type === "original" (full-res over thumbnail)
//   3. first available
// waveforms are filtered out — they're audio peak data, not visual
// art. returns null when the list is empty or contains only
// waveforms, so the caller can fall back to an album cover.
export function pickPrimaryImage(
  images: ImageMetadata[] | null | undefined
): ImageMetadata | null {
  if (!images || images.length === 0) return null;
  const visual = images.filter((i) => i.blob_type !== "waveform");
  if (visual.length === 0) return null;
  const primary = visual.find((i) => i.is_primary === true);
  if (primary) return primary;
  const original = visual.find((i) => i.blob_type === "original");
  if (original) return original;
  return visual[0] ?? null;
}

export async function buildImageUrls(
  image: ImageMetadata | null | undefined,
  imageUrl: string | null | undefined,
  fallbackRemoteId?: string | null
): Promise<string[]> {
  const urls: string[] = [];
  const add = (u: string | null | undefined) => {
    if (!u || urls.includes(u)) return;
    urls.push(u);
  };
  add(imageUrl);
  if (image) {
    add(image.remote_url);
    const blobId = image.remote_blob_id || image.local_blob_id;
    const serverId = image.remote_server_id || fallbackRemoteId;
    if (blobId && serverId) {
      try {
        if (await usesBlobResolver(serverId)) {
          add(await resolveBlobUrl(blobId, serverId, "image"));
        }
      } catch {
        // best-effort
      }
    }
    if (image.local_blob_id && !image.remote_server_id) {
      try {
        add(await resolveLocalBlobUrl(image.local_blob_id));
      } catch {
        /* ignore */
      }
    }
  }
  return urls;
}

export async function fetchAlbumSongs(remote: Remote, albumId: string) {
  const { RemoteMusicDataSource } = await import("../../../../music/data/remote/remoteSource");
  const ds = new RemoteMusicDataSource(remote);
  const resp = await ds.getAlbumSongs(albumId);
  return resp.items;
}
