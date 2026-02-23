// playlist download and sync service
// handles downloading remote playlists to local storage with songs + metadata

import * as apiClient from "freqhole-api-client";
import { getRemoteMediaUrl } from "../../../utils/urls";
import { generateUUID } from "../../../utils/uuid";
import { writeAudioToOPFS } from "../opfs/helpers";
import {
  getOrCreateAlbum,
  getOrCreateArtist,
  initMusicDB,
} from "../storage/db";
import { updateAlbum} from "../storage/db/albums";
import { updateArtist } from "../storage/db/artists";
import { getOrCreateGenre } from "../storage/db/genres";
import {
  createSyncedPlaylist,
  getPlaylistByRemoteId,
  updatePlaylistSongs,
  updateSyncedPlaylistETag,
} from "../storage/playlists";
import { storeBlob } from "../storage/blobs";
import type { GenreRef, ImageMetadata, Playlist, Song } from "../storage/types";
import { debug } from "../../../utils/logger";

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
 * download remote images and store them locally in IndexedDB/OPFS
 * returns ImageMetadata array with local_blob_id set for offline access
 */
async function downloadAndStoreImages(
  remoteUrl: string,
  apiImages: Array<{ blob_id: string; is_primary: number; blob_type?: string }> | null | undefined,
  apiKey?: string,
): Promise<ImageMetadata[]> {
  if (!apiImages?.length) return [];

  const results: ImageMetadata[] = [];

  for (const img of apiImages) {
    try {
      const imageUrl = `${remoteUrl}/api/blobs/${img.blob_id}`;
      const headers: HeadersInit = {};
      if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }
      const response = await fetch(imageUrl, {
        credentials: apiKey ? "omit" : "include",
        headers,
      });

      if (!response.ok) {
        debug("downloadSync", `failed to fetch image ${img.blob_id}: ${response.status}`);
        // fall back to remote_url reference
        results.push({
          remote_url: imageUrl,
          is_primary: img.is_primary === 1,
          blob_type: (img.blob_type as ImageMetadata["blob_type"]) || "thumbnail",
        });
        continue;
      }

      const blob = await response.blob();
      const mimeType = blob.type || "image/jpeg";

      // store blob locally and get local_blob_id
      const localBlobId = await storeBlob(blob, mimeType);

      results.push({
        local_blob_id: localBlobId,
        remote_url: imageUrl, // keep remote_url as fallback
        is_primary: img.is_primary === 1,
        blob_type: (img.blob_type as ImageMetadata["blob_type"]) || "thumbnail",
      });

      debug("downloadSync", `stored image ${img.blob_id} as local blob ${localBlobId}`);
    } catch (err) {
      debug("downloadSync", `error downloading image ${img.blob_id}:`, err);
      // fall back to remote_url reference
      results.push({
        remote_url: getRemoteMediaUrl(remoteUrl, img.blob_id, apiKey),
        is_primary: img.is_primary === 1,
        blob_type: (img.blob_type as ImageMetadata["blob_type"]) || "thumbnail",
      });
    }
  }

  return results;
}

/**
 * sync album genres from remote data to local IDB
 * creates genre records and sets album.genre_id to the primary (first) genre
 * returns the primary genre id and GenreRef array for denormalization on songs
 */
async function syncAlbumGenres(
  albumId: string,
  remoteGenres: Array<{ id: string; name: string }> | null | undefined,
): Promise<{ primaryGenreId: string | null; primaryGenreName: string | null; genreRefs: GenreRef[] }> {
  if (!remoteGenres?.length) {
    return { primaryGenreId: null, primaryGenreName: null, genreRefs: [] };
  }

  const genreRefs: GenreRef[] = [];
  let primaryGenreId: string | null = null;
  let primaryGenreName: string | null = null;

  for (const remoteGenre of remoteGenres) {
    const localGenre = await getOrCreateGenre(remoteGenre.name);
    genreRefs.push({ id: localGenre.genre_id, name: localGenre.name });

    // first genre is the primary one
    if (!primaryGenreId) {
      primaryGenreId = localGenre.genre_id;
      primaryGenreName = localGenre.name;
    }
  }

  // set album.genre_id to the primary genre
  await updateAlbum(albumId, { genre_id: primaryGenreId });

  return { primaryGenreId, primaryGenreName, genreRefs };
}

/**
 * build entity URLs array from remote API data
 */
function buildEntityUrls(
  apiUrls: Array<{ id: string | null; name: string | null; url: string }> | null | undefined,
): Array<{ id?: string; name?: string; url: string }> | undefined {
  if (!apiUrls?.length) return undefined;
  return apiUrls.map((u) => ({
    ...(u.id ? { id: u.id } : {}),
    ...(u.name ? { name: u.name } : {}),
    url: u.url,
  }));
}

/**
 * download a remote playlist and save it locally
 * fetches playlist metadata, songs, and audio files
 */
export async function downloadPlaylist(
  remoteUrl: string,
  remotePlaylistId: string,
  onProgress?: (progress: DownloadProgress) => void,
  apiKey?: string,
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
      debug(
        "downloadSync",
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
        await db.delete("playlist_songs", [ps.playlist_id, ps.song_id]);
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
      apiKey,
    );
    if (!etag) {
      throw new Error("failed to fetch playlist etag");
    }

    // fetch playlist metadata
    const playlistResult = await apiClient.music.getPlaylistById(remoteUrl, {
      id: remotePlaylistId,
    }, apiKey);
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
      }, apiKey);

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

    // download playlist images to local storage
    const playlistImages = await downloadAndStoreImages(remoteUrl, remotePlaylist.images, apiKey);

    // create local playlist
    const localPlaylistId = generateUUID();
    await createSyncedPlaylist(db, {
      playlist_id: localPlaylistId,
      title: remotePlaylist.title,
      description: remotePlaylist.description,
      is_public: Boolean(remotePlaylist.is_public),
      images: playlistImages.length > 0 ? playlistImages : undefined,
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
        }, apiKey);

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
          debug(
            "downloadSync",
            `song already exists with sha256 ${sha256}, skipping download`,
          );
          // just add to playlist mapping - use array index since remote position might be -1 (unsorted)
          localSongMappings.push({
            song_id: sha256,
            position: remoteSong.position != null && remoteSong.position >= 0 ? remoteSong.position : i,
          });
          continue;
        }

        // fetch audio blob from remote
        const blobUrl = `${remoteUrl}/api/blobs/${song.media_blob_id}`;
        const audioHeaders: HeadersInit = {};
        if (apiKey) {
          audioHeaders["Authorization"] = `Bearer ${apiKey}`;
        }
        const response = await fetch(blobUrl, {
          credentials: apiKey ? "omit" : "include",
          headers: audioHeaders,
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

        // update artist images and URLs if available and not already set
        if (artist) {
          const artistUpdates: Partial<typeof artistRecord> = {};
          if (artist.images?.length && !artistRecord.images?.length) {
            artistUpdates.images = await downloadAndStoreImages(remoteUrl, artist.images, apiKey);
          }
          if (artist.urls?.length && !artistRecord.urls?.length) {
            artistUpdates.urls = buildEntityUrls(artist.urls);
          }
          if (Object.keys(artistUpdates).length > 0) {
            await updateArtist(artistId, artistUpdates);
          }
        }

        // create or get album using the same helper as file upload
        const albumRecord = await getOrCreateAlbum(
          album?.title || "unknown album",
          artistId,
        );
        const albumId = albumRecord.album_id;

        // update album images and URLs if available and not already set
        if (album) {
          const albumUpdates: Partial<typeof albumRecord> = {};
          if (album.images?.length && !albumRecord.images?.length) {
            albumUpdates.images = await downloadAndStoreImages(remoteUrl, album.images, apiKey);
          }
          if (album.urls?.length && !albumRecord.urls?.length) {
            albumUpdates.urls = buildEntityUrls(album.urls);
          }
          if (Object.keys(albumUpdates).length > 0) {
            await updateAlbum(albumId, albumUpdates);
          }
        }

        // sync album genres from remote data
        const { primaryGenreId, primaryGenreName, genreRefs } =
          await syncAlbumGenres(albumId, album?.genres);

        // download song images to local storage
        const songImages = await downloadAndStoreImages(remoteUrl, song.images, apiKey);

        // build song entity URLs from remote
        const songUrls = buildEntityUrls(song.urls);

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
          track_artist: song.track_artist || null,
          lyrics: song.lyrics || null,
          metadata: song.metadata || null,
          created_at: Date.now(),
          updated_at: Date.now(),
          artist_name: artist?.name || "unknown artist",
          album_title: album?.title || "unknown album",
          images: songImages.length > 0 ? songImages : undefined,
          urls: songUrls,
          album_added_at: Date.now(),
          album_primary_genre_id: primaryGenreId,
          album_primary_genre_name: primaryGenreName,
          album_genres: genreRefs.length > 0 ? genreRefs : undefined,
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

        // add to playlist mapping - use array index since remote position might be -1 (unsorted)
        localSongMappings.push({
          song_id: sha256,
          position: remoteSong.position != null && remoteSong.position >= 0 ? remoteSong.position : i,
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
  apiKey?: string,
): Promise<boolean> {
  if (!localPlaylist.source_remote_id) {
    throw new Error("not a synced playlist");
  }

  const remoteEtag = await apiClient.music.getPlaylistETag(
    remoteUrl,
    localPlaylist.source_remote_id,
    apiKey,
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
  apiKey?: string,
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
      apiKey,
    );
    if (!newEtag) {
      throw new Error("failed to fetch playlist etag");
    }

    // fetch updated playlist metadata
    const playlistResult = await apiClient.music.getPlaylistById(remoteUrl, {
      id: localPlaylist.source_remote_id,
    }, apiKey);
    if (!playlistResult.success) {
      throw new Error("failed to fetch updated playlist metadata");
    }
    const remotePlaylist = playlistResult.data;

    // download and update local playlist images
    const playlistImages = await downloadAndStoreImages(remoteUrl, remotePlaylist.images, apiKey);
    const updatedPlaylist: Playlist = {
      ...localPlaylist,
      title: remotePlaylist.title,
      description: remotePlaylist.description,
      is_public: Boolean(remotePlaylist.is_public),
      images: playlistImages.length > 0 ? playlistImages : localPlaylist.images,
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
      }, apiKey);

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
        }, apiKey);

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
          // already have it, just add to mapping - use array index since remote position might be -1
          localSongMappings.push({
            song_id: sha256,
            position: remoteSong.position != null && remoteSong.position >= 0 ? remoteSong.position : i,
          });
          continue;
        }

        // download new song
        const blobUrl = `${remoteUrl}/api/blobs/${song.media_blob_id}`;
        const audioHeaders: HeadersInit = {};
        if (apiKey) {
          audioHeaders["Authorization"] = `Bearer ${apiKey}`;
        }
        const response = await fetch(blobUrl, {
          credentials: apiKey ? "omit" : "include",
          headers: audioHeaders,
        });

        if (!response.ok) {
          throw new Error(`failed to fetch blob: ${response.statusText}`);
        }

        const blob = await response.blob();
        const mimeType = blobMetadata.mime || blob.type || "audio/mpeg";
        const extension = getExtensionFromMimeType(mimeType);

        // save to OPFS
        const opfsPath = await writeAudioToOPFS(blob, sha256, extension);

        // create or get artist
        const artistRecord = await getOrCreateArtist(
          artist?.name || "unknown artist",
        );
        const artistId = artistRecord.artist_id;

        // update artist images and URLs if available and not already set
        if (artist) {
          const artistUpdates: Partial<typeof artistRecord> = {};
          if (artist.images?.length && !artistRecord.images?.length) {
            artistUpdates.images = await downloadAndStoreImages(remoteUrl, artist.images, apiKey);
          }
          if (artist.urls?.length && !artistRecord.urls?.length) {
            artistUpdates.urls = buildEntityUrls(artist.urls);
          }
          if (Object.keys(artistUpdates).length > 0) {
            await updateArtist(artistId, artistUpdates);
          }
        }

        // create or get album
        const albumRecord = await getOrCreateAlbum(
          album?.title || "unknown album",
          artistId,
        );
        const albumId = albumRecord.album_id;

        // update album images and URLs if available and not already set
        if (album) {
          const albumUpdates: Partial<typeof albumRecord> = {};
          if (album.images?.length && !albumRecord.images?.length) {
            albumUpdates.images = await downloadAndStoreImages(remoteUrl, album.images, apiKey);
          }
          if (album.urls?.length && !albumRecord.urls?.length) {
            albumUpdates.urls = buildEntityUrls(album.urls);
          }
          if (Object.keys(albumUpdates).length > 0) {
            await updateAlbum(albumId, albumUpdates);
          }
        }

        // sync album genres from remote data
        const { primaryGenreId, primaryGenreName, genreRefs } =
          await syncAlbumGenres(albumId, album?.genres);

        // download song images to local storage
        const songImages = await downloadAndStoreImages(remoteUrl, song.images, apiKey);

        // build song entity URLs from remote
        const songUrls = buildEntityUrls(song.urls);

        // create local song entry
        const localSong: Song = {
          id: sha256, // for synced files, use sha256 as the id
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
          track_artist: song.track_artist || null,
          lyrics: song.lyrics || null,
          metadata: song.metadata || null,
          created_at: Date.now(),
          updated_at: Date.now(),
          artist_name: artist?.name || "unknown artist",
          album_title: album?.title || "unknown album",
          images: songImages.length > 0 ? songImages : undefined,
          urls: songUrls,
          album_added_at: Date.now(),
          album_primary_genre_id: primaryGenreId,
          album_primary_genre_name: primaryGenreName,
          album_genres: genreRefs.length > 0 ? genreRefs : undefined,
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
          position: remoteSong.position != null && remoteSong.position >= 0 ? remoteSong.position : i,
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
  apiKey?: string,
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
    apiKey,
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
