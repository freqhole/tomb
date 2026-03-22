// sync playlist to local storage when playing from remote
import { getSyncQueueToLocal } from "../../../app/services/storage/db";
import { isCharnelAvailable, getTransportForRemote } from "../../../app/api/client";
import { getRemoteById } from "../../../app/services/remotes/remoteManager";
import { initMusicDB } from "../storage/db";
import { upsertLocalPlaylistWithSongs } from "../storage/playlists";
import { downloadAndStoreImages, syncSongToLocal, canSyncSong } from "./syncSongToLocal";
import type { QueueSourceContext } from "../../../app/services/storage/types";
import type { Song, ImageMetadata } from "../storage/types";
import type { Remote } from "../../../app/services/storage/schemas/remote";
import { debug, error as errorLog } from "../../../utils/logger";

/**
 * convert Blob to base64 string for IPC transfer
 */
async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      // strip "data:...;base64," prefix
      const base64 = dataUrl.split(",")[1] || "";
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * image data for IPC transfer
 */
interface SyncImageData {
  data: string;
  mime_type: string;
  is_primary: boolean;
  blob_type?: string;
}

/**
 * download images and convert to base64 for IPC
 */
async function prepareImagesForOffal(
  remote: Remote,
  images: ImageMetadata[] | undefined,
): Promise<SyncImageData[]> {
  if (!images?.length) return [];

  const results: SyncImageData[] = [];
  const transport = await getTransportForRemote(remote);

  for (const img of images) {
    if (!img.remote_blob_id) continue;
    try {
      const blobUrl = await transport.getBlobUrl(img.remote_blob_id);
      const response = await fetch(blobUrl);
      if (response.ok) {
        const blob = await response.blob();
        results.push({
          data: await blobToBase64(blob),
          mime_type: blob.type || "image/jpeg",
          is_primary: img.is_primary === true,
          blob_type: img.blob_type,
        });
      }
    } catch (e) {
      debug("syncPlaylistViaOffal", `failed to download image: ${e}`);
    }
  }

  return results;
}

/**
 * sync playlist to grimoire via offal route (charnel mode only)
 */
async function syncPlaylistViaOffal(
  songs: Song[],
  source: QueueSourceContext,
  remote: Remote,
): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");

    // collect sha256s from songs
    const songSha256s = songs
      .filter((s) => s.sha256)
      .map((s) => s.sha256 as string);

    if (songSha256s.length === 0) {
      debug("syncPlaylistViaOffal", "no songs with sha256 to sync");
      return;
    }

    // sync songs first so they exist locally when we create the playlist
    // mark songs to skip feed events (playlist gets one feed event at the end)
    const songsToSync = songs.filter((s) => canSyncSong(s)).map((s) => ({
      ...s,
      skip_feed_events: true,
    }));

    if (songsToSync.length > 0) {
      debug("syncPlaylistViaOffal", `syncing ${songsToSync.length} songs before playlist`);
      // sync songs in parallel (batch of 5 to avoid overwhelming)
      const batchSize = 5;
      for (let i = 0; i < songsToSync.length; i += batchSize) {
        const batch = songsToSync.slice(i, i + batchSize);
        await Promise.all(batch.map((s) => syncSongToLocal(s)));
      }
    }

    // collect images from source or first song
    let sourceImages: ImageMetadata[] | undefined;
    if (source.image) {
      sourceImages = [source.image];
    } else {
      // find first song with album images
      for (const song of songs) {
        if (song.album_images?.length) {
          sourceImages = [song.album_images[0]];
          break;
        }
        if (song.images?.length) {
          const thumbnail = song.images.find((img) => img.blob_type === "thumbnail");
          if (thumbnail) {
            sourceImages = [thumbnail];
            break;
          }
        }
      }
    }

    // download and convert images
    const images = await prepareImagesForOffal(remote, sourceImages);

    // call the sync playlist offal route
    const response = await invoke("api_call", {
      path: "/api/sync/playlist",
      body: {
        remote_playlist_id: source.entity_id,
        title: source.label,
        description: null,
        song_sha256s: songSha256s,
        images,
        remote_name: remote.name,
      },
    }) as { success: boolean; message: string; data?: { playlist_id: string; songs_added: number; songs_missing: number } };

    if (!response.success) {
      errorLog("syncPlaylistViaOffal", "failed to sync playlist:", response.message);
      return;
    }

    const result = response.data;
    debug(
      "syncPlaylistViaOffal",
      `synced playlist "${source.label}" - ${result?.songs_added} songs added, ${result?.songs_missing} missing, ${images.length} images`,
    );
  } catch (err) {
    errorLog("syncPlaylistViaOffal", "error syncing playlist:", err);
  }
}

/**
 * sync a playlist to local storage when adding to queue.
 * called from playQueue/addToQueue when source.type === "playlist".
 * 
 * conditions:
 * - sync_queue_to_local setting is enabled
 * - source has entity_id (playlist_id)
 * - in charnel mode: syncs to grimoire via offal route
 * - in browser mode: syncs to IndexedDB
 */
export async function syncPlaylistToLocalFromQueue(
  songs: Song[],
  source: QueueSourceContext,
): Promise<void> {
  // skip if sync not enabled
  if (!getSyncQueueToLocal()) {
    return;
  }

  // skip if not a playlist source or missing id
  if (source.type !== "playlist" || !source.entity_id) {
    return;
  }

  // skip if no songs
  if (songs.length === 0) {
    return;
  }

  // skip if songs are local (not from remote)
  const hasRemoteSongs = songs.some((s) => s.source_type === "remote");
  if (!hasRemoteSongs) {
    return;
  }

  // get the remote from the first remote song
  const firstRemoteSong = songs.find((s) => s.source_type === "remote" && s.remote_server_id);
  if (!firstRemoteSong?.remote_server_id) {
    debug("syncPlaylistToLocal", "no remote song with remote_server_id found");
    return;
  }

  const remote = await getRemoteById(firstRemoteSong.remote_server_id);
  if (!remote) {
    debug("syncPlaylistToLocal", "remote not found:", firstRemoteSong.remote_server_id);
    return;
  }

  // in charnel mode, sync to grimoire via offal route
  if (isCharnelAvailable()) {
    await syncPlaylistViaOffal(songs, source, remote);
    return;
  }

  // browser mode: sync to IndexedDB
  try {
    const db = await initMusicDB();

    // collect images from source or first song's album images
    let sourceImages: ImageMetadata[] | undefined;
    if (source.image) {
      sourceImages = [source.image];
    } else {
      // find first song with album images
      for (const song of songs) {
        if (song.album_images && song.album_images.length > 0) {
          sourceImages = [song.album_images[0]];
          break;
        }
        if (song.images && song.images.length > 0) {
          sourceImages = [song.images[0]];
          break;
        }
      }
    }

    // download and store images locally
    const localImages = await downloadAndStoreImages(remote, sourceImages);

    await upsertLocalPlaylistWithSongs(
      db,
      {
        playlist_id: source.entity_id,
        title: source.label,
        images: localImages.length > 0 ? localImages : undefined,
      },
      songs,
    );

    debug("syncPlaylistToLocal", `synced playlist "${source.label}" with ${songs.length} songs`);
  } catch (err) {
    errorLog("syncPlaylistToLocal", "failed to sync playlist:", err);
  }
}
