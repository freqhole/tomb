// keeps a local artist's images fresh when playing a song/album that came
// from a remote - so the playerbar's artist-image fallback (already used
// for local-library plays) also works when streaming.
//
// deliberately narrow scope: only updates an artist that ALREADY exists
// locally (matched by name) - never creates a new local artist record just
// from streaming, so casual remote listening doesn't pollute the library.
// reuses `imagesAreStale` (same check `syncSongToLocal.ts` uses for full
// song syncs) so an artist whose images are already up to date costs zero
// network requests - safe to call on every remote play.

import type { Song } from "../storage/types";
import type { ImageMetadata } from "../storage/types";
import { findArtistByName, updateArtist } from "../storage/db/artists";
import { imagesAreStale } from "../../../utils/images";
import { downloadAndStoreImages } from "./syncSongToLocal";
import { getRemoteById } from "../../../app/services/remotes/remoteManager";
import { warn } from "../../../utils/logger";

/**
 * @returns the freshly-downloaded images when the artist's images were
 *   actually updated, otherwise `null` (nothing to do, or a failure) - lets
 *   callers (e.g. the playerbar's current-song snapshot) react once new
 *   images land instead of only benefiting the next play.
 */
export async function syncArtistImagesForRemotePlay(
  remoteId: string,
  song: Song
): Promise<ImageMetadata[] | null> {
  const artistName = song.artist_name?.trim();
  if (!artistName || !song.artist_images?.length) return null;

  try {
    const existing = await findArtistByName(artistName);
    if (!existing) return null;

    const remoteIds = song.artist_images.map((img) => img.remote_blob_id);
    if (!imagesAreStale(existing.images, remoteIds)) return null;

    const remote = await getRemoteById(remoteId);
    if (!remote) return null;

    const images = await downloadAndStoreImages(remote, song.artist_images);
    if (images.length > 0) {
      await updateArtist(existing.artist_id, { images });
      return images;
    }
    return null;
  } catch (err) {
    warn("syncArtistImagesOnPlay", `failed to sync artist images for "${artistName}":`, err);
    return null;
  }
}
