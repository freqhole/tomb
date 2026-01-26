// playlist download and sync service
// handles downloading remote playlists to local storage with songs + metadata

import * as apiClient from "freqhole-api-client";
import { generateUUID } from "../../../utils/uuid";
import { writeAudioToOPFS, writeThumbnailToOPFS } from "../opfs/helpers";
import {
  getOrCreateAlbum,
  getOrCreateArtist,
  initMusicDB,
} from "../storage/db";
import {
  createSyncedPlaylist,
  getPlaylistByRemoteId,
  updatePlaylistSongs,
  updateSyncedPlaylistETag,
} from "../storage/playlists";
import type { Playlist, Song } from "../storage/types";

export interface DownloadProgress {
  stage: "fetching" | "downloading" | "complete" | "error";
  totalSongs: number;
  downloadedSongs: number;
  currentSong?: string;
  error?: string;
}

export interface SyncCheckResult {
  needsSync: boolean;
  localEtag: string | null;
  remoteEtag: string | null;
  localPlaylistId: string | null;
}

/**
 * download a remote playlist and save it locally
 * fetches playlist metadata, songs, and audio files
 */
export async function downloadPlaylist(
  remoteUrl: string,
  remotePlaylistId: string,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<void> {
  const db = await initMusicDB();

  try {
    // check if already downloaded - allow retry if playlist has no songs yet
    const existing = await getPlaylistByRemoteId(
      db,
      remotePlaylistId,
      remoteUrl,
    );
    if (existing) {
      console.log(
        "playlist already exists, deleting and re-downloading:",
        existing.playlist_id,
      );
      // delete existing playlist and all its songs to start fresh
      const existingSongs = await db
        .transaction("playlist_songs")
        .objectStore("playlist_songs")
        .index("by_playlist_id")
        .getAll(existing.playlist_id);

      // delete all playlist_songs entries using composite key
      for (const ps of existingSongs) {
        await db.delete("playlist_songs", [ps.playlist_id, ps.sha256]);
      }

      // delete the playlist
      await db.delete("playlists", existing.playlist_id);
    }

    // fetch etag first
    onProgress?.({
      stage: "fetching",
      totalSongs: 0,
      downloadedSongs: 0,
    });

    const etag = await apiClient.music.getPlaylistETag(
      remoteUrl,
      remotePlaylistId,
    );
    if (!etag) {
      throw new Error("failed to fetch playlist etag");
    }

    // fetch playlist metadata
    const playlistResult = await apiClient.music.getPlaylistById(remoteUrl, {
      id: remotePlaylistId,
    });
    if (!playlistResult.success) {
      throw new Error("failed to fetch playlist metadata");
    }
    const remotePlaylist = playlistResult.data;

    // fetch all songs in playlist
    let allSongs: any[] = [];
    let offset = 0;
    const limit = 100;

    while (true) {
      const songsResult = await apiClient.music.queryPlaylistSongs(remoteUrl, {
        playlist_id: remotePlaylistId,
        q: null,
        sort_by: null,
        sort_direction: null,
        limit,
        offset,
      });

      if (!songsResult.success) {
        console.error("fetch playlist songs error:", songsResult);
        throw new Error("failed to fetch playlist songs");
      }

      // songsResult.data has shape { items: [...] }
      const items = songsResult.data.items;
      allSongs = allSongs.concat(items);

      if (items.length < limit) {
        break;
      }
      offset += limit;
    }

    onProgress?.({
      stage: "downloading",
      totalSongs: allSongs.length,
      downloadedSongs: 0,
    });

    // download thumbnail if present
    let localThumbnailId: string | null = null;
    if (remotePlaylist.thumbnail_blob_id) {
      try {
        const thumbnailBlobUrl = `${remoteUrl}/api/blobs/${remotePlaylist.thumbnail_blob_id}`;
        const thumbnailResponse = await fetch(thumbnailBlobUrl, {
          credentials: "include",
        });

        if (thumbnailResponse.ok) {
          const thumbnailBlob = await thumbnailResponse.blob();
          localThumbnailId = generateUUID();
          await writeThumbnailToOPFS(thumbnailBlob, localThumbnailId);
        }
      } catch (error) {
        console.warn("failed to download playlist thumbnail:", error);
        // continue without thumbnail
      }
    }

    // create local playlist
    const localPlaylistId = generateUUID();
    await createSyncedPlaylist(db, {
      playlist_id: localPlaylistId,
      title: remotePlaylist.title,
      description: remotePlaylist.description,
      is_public: Boolean(remotePlaylist.is_public),
      thumbnail_blob_id: localThumbnailId,
      source_remote_id: remotePlaylistId,
      source_remote_url: remoteUrl,
      source_etag: etag,
    });

    // download songs and create local entries
    const localSongMappings: Array<{ song_id: string; position: number }> = [];

    for (let i = 0; i < allSongs.length; i++) {
      const remoteSong = allSongs[i];
      const { song, artist, album } = remoteSong.details;

      onProgress?.({
        stage: "downloading",
        totalSongs: allSongs.length,
        downloadedSongs: i,
        currentSong: song.title,
      });

      try {
        if (!song || !song.media_blob_id) {
          console.warn(`skipping song without media blob: ${song?.id}`);
          continue;
        }

        // fetch blob metadata to get SHA256
        const metadataResult = await apiClient.music.blobMetadata(remoteUrl, {
          id: song.media_blob_id,
        });

        if (!metadataResult.success) {
          console.error(
            `failed to fetch blob metadata for ${song.media_blob_id}`,
          );
          throw new Error(
            `failed to fetch blob metadata for ${song.media_blob_id}`,
          );
        }

        const blobMetadata = metadataResult.data;
        if (!blobMetadata) {
          console.error("blob metadata is null for:", song.media_blob_id);
          throw new Error(`blob metadata is null for ${song.media_blob_id}`);
        }

        const sha256 = blobMetadata.sha256;

        if (!sha256) {
          console.error("blob metadata missing sha256:", blobMetadata);
          throw new Error(
            `blob metadata missing sha256 for ${song.media_blob_id}`,
          );
        }

        // check if we already have this song downloaded
        const existingSong = await db.get("songs", sha256);
        if (existingSong) {
          console.log(
            `song already exists with sha256 ${sha256}, skipping download`,
          );
          // just add to playlist mapping
          localSongMappings.push({
            song_id: sha256,
            position: remoteSong.position || i,
          });
          continue;
        }

        // fetch audio blob from remote
        const blobUrl = `${remoteUrl}/api/blobs/${song.media_blob_id}`;
        const response = await fetch(blobUrl, {
          credentials: "include",
        });

        if (!response.ok) {
          throw new Error(`failed to fetch blob: ${response.statusText}`);
        }

        const blob = await response.blob();

        // determine file extension from mime type
        const mimeType = blobMetadata.mime || blob.type || "audio/mpeg";
        const extension = getExtensionFromMimeType(mimeType);

        // save to OPFS using SHA256 as filename
        const opfsPath = await writeAudioToOPFS(blob, sha256, extension);

        // create or get artist using the same helper as file upload
        const artistRecord = await getOrCreateArtist(
          artist?.name || "unknown artist",
        );
        const artistId = artistRecord.artist_id;

        // create or get album using the same helper as file upload
        const albumRecord = await getOrCreateAlbum(
          album?.title || "unknown album",
          artistId,
        );
        const albumId = albumRecord.album_id;

        // create local song entry
        const localSong: Song = {
          id: sha256, // for downloaded files, use sha256 as the id
          sha256,
          title: song.title || "untitled",
          artist_id: artistId,
          album_id: albumId,
          track_number: song.track_number || 0,
          disc_number: song.disc_number || 1,
          duration_seconds: song.duration
            ? Math.floor(song.duration / 1000)
            : 0,
          year: song.year || null,
          bpm: song.bpm || null,
          key_signature: song.key_signature || null,
          lyrics: song.lyrics || null,
          metadata: song.metadata || null,
          created_at: Date.now(),
          updated_at: Date.now(),
          artist_name: artist?.name || "unknown artist",
          album_title: album?.title || "unknown album",
          thumbnail_blob_id: song.thumbnail_blob_id || null,
          album_added_at: Date.now(),
          album_primary_genre_id: null,
          source_type: "downloaded" as const,
          opfs_path: opfsPath,
          file_name: `${song.title || "untitled"}.${extension}`,
          file_size: blob.size,
          last_modified: Date.now(),
          mime_type: mimeType,
          source_url: blobUrl,
          downloaded_at: Date.now(),
          remote_server_id: null,
          remote_sha256: song.id,
          added_at: Date.now(),
        };

        // save song to database
        await db.put("songs", localSong);

        // add to playlist mapping
        localSongMappings.push({
          song_id: sha256,
          position: remoteSong.position || i,
        });
      } catch (error) {
        console.error(
          `failed to download song ${remoteSong.song?.title}:`,
          error,
        );
        // continue with other songs
      }
    }

    // save playlist songs
    await updatePlaylistSongs(db, localPlaylistId, localSongMappings);

    onProgress?.({
      stage: "complete",
      totalSongs: allSongs.length,
      downloadedSongs: allSongs.length,
    });
  } catch (error) {
    onProgress?.({
      stage: "error",
      totalSongs: 0,
      downloadedSongs: 0,
      error: error instanceof Error ? error.message : "unknown error",
    });
    throw error;
  }
}

/**
 * helper to get file extension from mime type
 */
function getExtensionFromMimeType(mimeType: string): string {
  const mimeMap: Record<string, string> = {
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/flac": "flac",
    "audio/x-flac": "flac",
    "audio/ogg": "ogg",
    "audio/opus": "opus",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/aac": "aac",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
  };

  return mimeMap[mimeType] || "mp3";
}

/**
 * check if a remote playlist has updates
 * compares etag with local copy
 */
export async function checkPlaylistUpdates(
  remoteUrl: string,
  localPlaylist: Playlist,
): Promise<boolean> {
  if (!localPlaylist.source_remote_id) {
    throw new Error("not a synced playlist");
  }

  const remoteEtag = await apiClient.music.getPlaylistETag(
    remoteUrl,
    localPlaylist.source_remote_id,
  );

  if (!remoteEtag) {
    throw new Error("failed to fetch remote etag");
  }

  return remoteEtag !== localPlaylist.source_etag;
}

/**
 * sync a local playlist with remote updates
 * fetches updated metadata and songs
 */
export async function syncPlaylist(
  remoteUrl: string,
  localPlaylist: Playlist,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<void> {
  const db = await initMusicDB();

  if (!localPlaylist.source_remote_id) {
    throw new Error("not a synced playlist");
  }

  try {
    onProgress?.({
      stage: "fetching",
      totalSongs: 0,
      downloadedSongs: 0,
    });

    // fetch new etag
    const newEtag = await apiClient.music.getPlaylistETag(
      remoteUrl,
      localPlaylist.source_remote_id,
    );
    if (!newEtag) {
      throw new Error("failed to fetch playlist etag");
    }

    // fetch updated playlist metadata
    const playlistResult = await apiClient.music.getPlaylistById(remoteUrl, {
      id: localPlaylist.source_remote_id,
    });
    if (!playlistResult.success) {
      throw new Error("failed to fetch updated playlist metadata");
    }
    const remotePlaylist = playlistResult.data;

    // update local playlist metadata
    const updatedPlaylist: Playlist = {
      ...localPlaylist,
      title: remotePlaylist.title,
      description: remotePlaylist.description,
      is_public: Boolean(remotePlaylist.is_public),
      updated_at: Date.now(),
    };
    await db.put("playlists", updatedPlaylist);

    // fetch all songs in updated playlist
    let allRemoteSongs: any[] = [];
    let offset = 0;
    const limit = 100;

    while (true) {
      const songsResult = await apiClient.music.queryPlaylistSongs(remoteUrl, {
        playlist_id: localPlaylist.source_remote_id,
        q: null,
        sort_by: null,
        sort_direction: null,
        limit,
        offset,
      });

      if (!songsResult.success) {
        console.error("fetch playlist songs error:", songsResult);
        throw new Error("failed to fetch playlist songs");
      }

      // songsResult.data has shape { items: [...] }
      const items = songsResult.data.items;
      allRemoteSongs = allRemoteSongs.concat(items);

      if (items.length < limit) {
        break;
      }
      offset += limit;
    }

    onProgress?.({
      stage: "downloading",
      totalSongs: allRemoteSongs.length,
      downloadedSongs: 0,
    });

    // build song mappings and download missing songs
    const localSongMappings: Array<{ song_id: string; position: number }> = [];

    for (let i = 0; i < allRemoteSongs.length; i++) {
      const remoteSong = allRemoteSongs[i];
      const { song, artist, album } = remoteSong.details;

      onProgress?.({
        stage: "downloading",
        totalSongs: allRemoteSongs.length,
        downloadedSongs: i,
        currentSong: song.title,
      });

      try {
        // fetch blob metadata to get SHA256
        const metadataResult = await apiClient.music.blobMetadata(remoteUrl, {
          id: song.media_blob_id,
        });

        if (!metadataResult.success) {
          console.error("blob metadata fetch failed:", metadataResult);
          throw new Error(
            `failed to fetch blob metadata for ${song.media_blob_id}`,
          );
        }

        const blobMetadata = metadataResult.data;
        if (!blobMetadata) {
          console.error("blob metadata is null for:", song.media_blob_id);
          throw new Error(`blob metadata is null for ${song.media_blob_id}`);
        }

        const sha256 = (blobMetadata as any).sha256 as string;

        if (!sha256) {
          console.error("blob metadata missing sha256:", blobMetadata);
          throw new Error(
            `blob metadata missing sha256 for ${song.media_blob_id}`,
          );
        }

        // check if we already have this song
        const existingSong = await db.get("songs", sha256);
        if (existingSong) {
          // already have it, just add to mapping
          localSongMappings.push({
            song_id: sha256,
            position: remoteSong.position || i,
          });
          continue;
        }

        // download new song
        const blobUrl = `${remoteUrl}/api/blobs/${song.media_blob_id}`;
        const response = await fetch(blobUrl, {
          credentials: "include",
        });

        if (!response.ok) {
          throw new Error(`failed to fetch blob: ${response.statusText}`);
        }

        const blob = await response.blob();
        const mimeType = blobMetadata.mime || blob.type || "audio/mpeg";
        const extension = getExtensionFromMimeType(mimeType);

        // save to OPFS
        const opfsPath = await writeAudioToOPFS(blob, sha256, extension);

        // create local song entry
        const localSong: Song = {
          id: sha256, // for synced files, use sha256 as the id
          sha256,
          title: song.title || "untitled",
          artist_id: artist?.id || generateUUID(),
          album_id: album?.id || generateUUID(),
          track_number: song.track_number || 0,
          disc_number: song.disc_number || 1,
          duration_seconds: song.duration
            ? Math.floor(song.duration / 1000)
            : 0,
          year: song.year || null,
          bpm: song.bpm || null,
          key_signature: song.key_signature || null,
          lyrics: song.lyrics || null,
          metadata: song.metadata || null,
          created_at: Date.now(),
          updated_at: Date.now(),
          artist_name: artist?.name || "unknown artist",
          album_title: album?.title || "unknown album",
          thumbnail_blob_id: song.thumbnail_blob_id || null,
          album_added_at: Date.now(),
          album_primary_genre_id: null,
          source_type: "downloaded" as const,
          opfs_path: opfsPath,
          file_name: `${song.title || "untitled"}.${extension}`,
          file_size: blob.size,
          last_modified: Date.now(),
          mime_type: mimeType,
          source_url: blobUrl,
          downloaded_at: Date.now(),
          remote_server_id: null,
          remote_sha256: song.id,
          added_at: Date.now(),
        };

        await db.put("songs", localSong);

        localSongMappings.push({
          song_id: sha256,
          position: remoteSong.position || i,
        });
      } catch (error) {
        console.error(`failed to sync song ${song.title}:`, error);
        // continue with other songs
      }
    }

    // update playlist songs
    await updatePlaylistSongs(db, localPlaylist.playlist_id, localSongMappings);

    // update etag
    await updateSyncedPlaylistETag(db, localPlaylist.playlist_id, newEtag);

    onProgress?.({
      stage: "complete",
      totalSongs: allRemoteSongs.length,
      downloadedSongs: allRemoteSongs.length,
    });
  } catch (error) {
    onProgress?.({
      stage: "error",
      totalSongs: 0,
      downloadedSongs: 0,
      error: error instanceof Error ? error.message : "unknown error",
    });
    throw error;
  }
}

/**
 * check if a local playlist needs to sync with its remote source
 * compares local etag with remote etag
 */
export async function checkIfPlaylistNeedsSync(
  remoteUrl: string,
  remotePlaylistId: string,
): Promise<SyncCheckResult> {
  const db = await initMusicDB();

  // check if playlist exists locally
  const localPlaylist = await getPlaylistByRemoteId(
    db,
    remotePlaylistId,
    remoteUrl,
  );

  if (!localPlaylist) {
    return {
      needsSync: false,
      localEtag: null,
      remoteEtag: null,
      localPlaylistId: null,
    };
  }

  // fetch remote etag
  const remoteEtag = await apiClient.music.getPlaylistETag(
    remoteUrl,
    remotePlaylistId,
  );

  if (!remoteEtag) {
    return {
      needsSync: false,
      localEtag: localPlaylist.source_etag || null,
      remoteEtag: null,
      localPlaylistId: localPlaylist.playlist_id,
    };
  }

  // compare etags
  const needsSync = localPlaylist.source_etag !== remoteEtag;

  return {
    needsSync,
    localEtag: localPlaylist.source_etag || null,
    remoteEtag,
    localPlaylistId: localPlaylist.playlist_id,
  };
}
