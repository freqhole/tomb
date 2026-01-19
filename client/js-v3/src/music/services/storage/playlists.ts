// playlist storage helpers for local and synced playlists

import type { IDBPDatabase } from "idb";
import type { Playlist, PlaylistSong } from "./types";
import { STORE_PLAYLISTS, STORE_PLAYLIST_SONGS } from "./types";

// ===== SYNCED PLAYLIST FUNCTIONS =====

/**
 * create a synced playlist downloaded from a remote server
 * sets source_type="remote" and stores sync metadata
 */
export async function createSyncedPlaylist(
  db: IDBPDatabase,
  playlist: {
    playlist_id: string;
    title: string;
    description: string | null;
    is_public: boolean;
    thumbnail_blob_id: string | null;
    source_remote_id: string;
    source_remote_url: string;
    source_etag: string;
  },
): Promise<void> {
  const now = Date.now();
  const syncedPlaylist: Playlist = {
    ...playlist,
    source_type: "remote",
    source_remote_id: playlist.source_remote_id,
    source_remote_url: playlist.source_remote_url,
    source_etag: playlist.source_etag,
    last_synced_at: now,
    is_editable: false,
    created_at: now,
    updated_at: now,
  };

  await db.put(STORE_PLAYLISTS, syncedPlaylist);
}

/**
 * update the etag and last_synced_at for a synced playlist
 */
export async function updateSyncedPlaylistETag(
  db: IDBPDatabase,
  playlistId: string,
  etag: string,
): Promise<void> {
  const playlist = await db.get(STORE_PLAYLISTS, playlistId);
  if (!playlist) {
    throw new Error("playlist not found");
  }

  playlist.source_etag = etag;
  playlist.last_synced_at = Date.now();
  playlist.updated_at = Date.now();

  await db.put(STORE_PLAYLISTS, playlist);
}

/**
 * get all synced playlists (source_type="remote")
 */
export async function getSyncedPlaylists(
  db: IDBPDatabase,
): Promise<Playlist[]> {
  const index = db.transaction(STORE_PLAYLISTS).store.index("by_source_type");
  return await index.getAll("remote");
}

/**
 * convert a synced playlist to a local editable copy
 * clears sync metadata and allows editing
 */
export async function convertToLocalPlaylist(
  db: IDBPDatabase,
  playlistId: string,
): Promise<void> {
  const playlist = await db.get(STORE_PLAYLISTS, playlistId);
  if (!playlist) {
    throw new Error("playlist not found");
  }

  // clear sync fields
  playlist.source_type = "local";
  playlist.source_remote_id = null;
  playlist.source_remote_url = null;
  playlist.source_etag = null;
  playlist.last_synced_at = null;
  playlist.is_editable = true;
  playlist.updated_at = Date.now();

  await db.put(STORE_PLAYLISTS, playlist);
}

/**
 * check if a playlist is synced from a remote
 */
export function isSyncedPlaylist(playlist: Playlist): boolean {
  return playlist.source_type === "remote";
}

/**
 * check if a playlist is editable
 */
export function isEditablePlaylist(playlist: Playlist): boolean {
  // default to true for legacy playlists without is_editable field
  return playlist.is_editable !== false;
}

/**
 * get a playlist by its remote id and url
 * useful for checking if a remote playlist is already downloaded
 */
export async function getPlaylistByRemoteId(
  db: IDBPDatabase,
  remoteId: string,
  remoteUrl: string,
): Promise<Playlist | undefined> {
  const allPlaylists = await db.getAll(STORE_PLAYLISTS);
  return allPlaylists.find(
    (p) => p.source_remote_id === remoteId && p.source_remote_url === remoteUrl,
  );
}

/**
 * create or update playlist songs for a synced playlist
 * replaces all existing songs with the new list
 */
export async function updatePlaylistSongs(
  db: IDBPDatabase,
  playlistId: string,
  songs: Array<{ sha256: string; position: number }>,
): Promise<void> {
  const tx = db.transaction(STORE_PLAYLIST_SONGS, "readwrite");
  const store = tx.objectStore(STORE_PLAYLIST_SONGS);

  // delete existing songs for this playlist
  const index = store.index("by_playlist_id");
  const existingSongs = await index.getAll(playlistId);
  for (const song of existingSongs) {
    await store.delete([song.playlist_id, song.sha256]);
  }

  // add new songs
  const now = Date.now();
  for (const song of songs) {
    const playlistSong: PlaylistSong = {
      playlist_id: playlistId,
      sha256: song.sha256,
      position: song.position,
      added_at: now,
    };
    await store.put(playlistSong);
  }

  await tx.done;
}

/**
 * delete a playlist and all its songs
 */
export async function deletePlaylist(
  db: IDBPDatabase,
  playlistId: string,
): Promise<void> {
  const tx = db.transaction(
    [STORE_PLAYLISTS, STORE_PLAYLIST_SONGS],
    "readwrite",
  );

  // delete playlist
  await tx.objectStore(STORE_PLAYLISTS).delete(playlistId);

  // delete all playlist songs
  const playlistSongsStore = tx.objectStore(STORE_PLAYLIST_SONGS);
  const index = playlistSongsStore.index("by_playlist_id");
  const songs = await index.getAll(playlistId);
  for (const song of songs) {
    await playlistSongsStore.delete([song.playlist_id, song.sha256]);
  }

  await tx.done;
}
