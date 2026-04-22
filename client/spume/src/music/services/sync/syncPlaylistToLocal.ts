// sync playlist to local storage when playing from remote
import { getSyncQueueToLocal } from "../../../app/services/storage/db";
import { isCharnelAvailable } from "../../../app/api/client";
import { getRemoteById } from "../../../app/services/remotes/remoteManager";
import { initMusicDB } from "../storage/db";
import { upsertLocalPlaylistWithSongs } from "../storage/playlists";
import { downloadAndStoreImages, syncSongToLocal, canSyncSong } from "./syncSongToLocal";
import type { QueueSourceContext } from "../../../app/services/storage/types";
import type { Song, ImageMetadata } from "../storage/types";
import { debug, error as errorLog } from "../../../utils/logger";

/**
 * sync playlist to the local charnel-managed grimoire via the iroh-blobs
 * path. songs are synced first via the new /api/sync/song-by-blake3 route
 * (the local grimoire pulls each blake3 directly from the source remote).
 * the playlist is then created via /api/sync/playlist with the list of
 * synced song blake3s — no audio bytes cross the IPC boundary.
 *
 * image refs in the playlist request are sha256-only today (ImageMetadata
 * has no sha256); the dest will report missing image sha256s in the
 * response. step 11 of the send-to-remote plan plumbs sha256 through.
 */
async function syncPlaylistViaLocalGrimoire(
  songs: Song[],
  source: QueueSourceContext,
  remote: { remote_id: string; name: string },
): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");

    // sync each song first so the local grimoire can resolve blake3 → song.
    // mark songs to skip individual feed events (the playlist itself emits one).
    const songsToSync = songs
      .filter((s) => canSyncSong(s))
      .map((s) => ({ ...s, skip_feed_events: true }));

    if (songsToSync.length > 0) {
      debug(
        "syncPlaylistViaLocalGrimoire",
        `syncing ${songsToSync.length} songs before playlist`,
      );
      // batch of 5 to avoid overwhelming the iroh transport.
      const batchSize = 5;
      for (let i = 0; i < songsToSync.length; i += batchSize) {
        const batch = songsToSync.slice(i, i + batchSize);
        await Promise.all(batch.map((s) => syncSongToLocal(s)));
      }
    }

    // collect blake3s for the playlist body. songs without blake3 cannot be
    // referenced; the dest will report any missing ones in the response.
    const songBlake3s = songs
      .map((s) => s.blake3)
      .filter((b): b is string => !!b);

    if (songBlake3s.length === 0) {
      debug(
        "syncPlaylistViaLocalGrimoire",
        "no songs with blake3 to include in playlist",
      );
      return;
    }

    const response = (await invoke("api_call", {
      path: "/api/sync/playlist",
      body: {
        source_remote_id: remote.remote_id,
        remote_playlist_id: source.entity_id,
        title: source.label,
        description: null,
        song_blake3s: songBlake3s,
        images: [] as Array<{
          content_sha256: string;
          data_base64: string | null;
          mime_type: string;
          is_primary: boolean;
          blob_type: string | null;
        }>,
        remote_name: remote.name,
      },
    })) as {
      success: boolean;
      message: string;
      data?: {
        playlist_id: string;
        songs_added: number;
        missing_song_blake3s: string[];
        song_stubs_created: number;
        images_linked: number;
        missing_image_sha256s: string[];
      };
    };

    if (!response.success) {
      errorLog(
        "syncPlaylistViaLocalGrimoire",
        "failed to sync playlist:",
        response.message,
      );
      return;
    }

    const data = response.data;
    debug(
      "syncPlaylistViaLocalGrimoire",
      `synced playlist "${source.label}" — ${data?.songs_added ?? 0} added, ` +
        `${data?.song_stubs_created ?? 0} stubs created, ` +
        `${data?.missing_song_blake3s.length ?? 0} missing`,
    );
  } catch (err) {
    errorLog("syncPlaylistViaLocalGrimoire", "error syncing playlist:", err);
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

  // in charnel mode, sync via the local grimoire over the iroh-blobs path
  if (isCharnelAvailable()) {
    await syncPlaylistViaLocalGrimoire(songs, source, remote);
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

    // use prefixed ID to match grimoire sync pattern
    // this ensures we can find and update existing synced playlists
    const syncedPlaylistId = `synced-${source.entity_id}`;

    await upsertLocalPlaylistWithSongs(
      db,
      {
        playlist_id: syncedPlaylistId,
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
