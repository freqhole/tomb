// playlist download and sync service
// handles downloading remote playlists to local storage with songs + metadata

import * as apiClient from "freqhole-api-client";
import { generateUUID } from "../../../utils/uuid";
import { writeAudioToOPFS } from "../opfs/helpers";
import { initMusicDB } from "../storage/db";
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
    // check if already downloaded
    const existing = await getPlaylistByRemoteId(
      db,
      remotePlaylistId,
      remoteUrl,
    );
    if (existing) {
      throw new Error("playlist already downloaded");
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
        limit,
        offset,
      });

      if (!songsResult.success) {
        throw new Error("failed to fetch playlist songs");
      }

      allSongs = allSongs.concat(songsResult.data.items);

      if (songsResult.data.items.length < limit) {
        break;
      }
      offset += limit;
    }

    onProgress?.({
      stage: "downloading",
      totalSongs: allSongs.length,
      downloadedSongs: 0,
    });

    // create local playlist
    const localPlaylistId = generateUUID();
    await createSyncedPlaylist(db, {
      playlist_id: localPlaylistId,
      title: remotePlaylist.title,
      description: remotePlaylist.description,
      is_public: Boolean(remotePlaylist.is_public),
      thumbnail_blob_id: null, // TODO: download thumbnail
      source_remote_id: remotePlaylistId,
      source_remote_url: remoteUrl,
      source_etag: etag,
    });

    // download songs and create local entries
    const localSongMappings: Array<{ sha256: string; position: number }> = [];

    for (let i = 0; i < allSongs.length; i++) {
      const remoteSong = allSongs[i];

      onProgress?.({
        stage: "downloading",
        totalSongs: allSongs.length,
        downloadedSongs: i,
        currentSong: remoteSong.song?.title || "untitled",
      });

      try {
        // get song metadata from API response
        const song = remoteSong.song;
        const artist = remoteSong.artist;
        const album = remoteSong.album;

        if (!song || !song.media_blob_id) {
          console.warn(`skipping song without media blob: ${song?.id}`);
          continue;
        }

        // fetch blob metadata to get SHA256
        const metadataResult = await apiClient.music.blobMetadata(remoteUrl, {
          id: song.media_blob_id,
        });

        if (!metadataResult.success) {
          throw new Error("failed to fetch blob metadata");
        }

        const blobMetadata = metadataResult.data as any;
        const sha256 = blobMetadata.sha256 as string;

        if (!sha256) {
          throw new Error("blob metadata missing sha256");
        }

        // check if we already have this song downloaded
        const existingSong = await db.get("songs", sha256);
        if (existingSong) {
          console.log(
            `song already exists with sha256 ${sha256}, skipping download`,
          );
          // just add to playlist mapping
          localSongMappings.push({
            sha256,
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
        const mimeType =
          (blobMetadata as any).mime_type || blob.type || "audio/mpeg";
        const extension = getExtensionFromMimeType(mimeType);

        // save to OPFS using SHA256 as filename
        const opfsPath = await writeAudioToOPFS(blob, sha256, extension);

        // get or create artist
        const artistId = artist?.id ? artist.id : generateUUID();

        // get or create album
        const albumId = album?.id ? album.id : generateUUID();

        // create local song entry
        const localSong: Song = {
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
          sha256,
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

    // TODO: fetch updated playlist metadata
    // TODO: fetch updated songs
    // TODO: reconcile changes (add new, remove deleted, update order)
    // TODO: download new audio files

    // update etag
    await updateSyncedPlaylistETag(db, localPlaylist.playlist_id, newEtag);

    onProgress?.({
      stage: "complete",
      totalSongs: 0,
      downloadedSongs: 0,
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
