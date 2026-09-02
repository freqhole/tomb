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
import { findArtistByName, updateArtist } from "../storage/db/artists";
import { imagesAreStale } from "../../../utils/images";
import { downloadAndStoreImages } from "./syncSongToLocal";
import { getRemoteById } from "../../../app/services/remotes/remoteManager";
import { warn } from "../../../utils/logger";

export async function syncArtistImagesForRemotePlay(remoteId: string, song: Song): Promise<void> {
  const artistName = song.artist_name?.trim();
  if (!artistName || !song.artist_images?.length) return;

  try {
    const existing = await findArtistByName(artistName);
    if (!existing) return;

    const remoteIds = song.artist_images.map((img) => img.remote_blob_id);
    if (!imagesAreStale(existing.images, remoteIds)) return;

    const remote = await getRemoteById(remoteId);
    if (!remote) return;

    const images = await downloadAndStoreImages(remote, song.artist_images);
    if (images.length > 0) {
      await updateArtist(existing.artist_id, { images });
    }
  } catch (err) {
    warn("syncArtistImagesOnPlay", `failed to sync artist images for "${artistName}":`, err);
  }
}
