// playlist storage helpers

import type { IDBPDatabase } from "idb";
import type { ImageMetadata, Playlist, PlaylistSong, PlaylistVideoItem, Song } from "./types";
import { STORE_PLAYLISTS, STORE_PLAYLIST_SONGS, STORE_PLAYLIST_VIDEO_ITEMS } from "./types";

/**
 * unwrap proxy arrays before storing in IndexedDB
 * (SolidJS stores use proxies that can't be cloned for IDB)
 */
function unwrapImages(images?: ImageMetadata[]): ImageMetadata[] | undefined {
  if (!images) return undefined;
  return images.map((img) => ({ ...img }));
}

/**
 * create a local playlist
 */
export async function createLocalPlaylist(
  db: IDBPDatabase,
  playlist: {
    playlist_id: string;
    title: string;
    description?: string | null;
    is_public?: boolean;
    images?: ImageMetadata[];
  }
): Promise<void> {
  const now = Date.now();
  const localPlaylist: Playlist = {
    playlist_id: playlist.playlist_id,
    title: playlist.title,
    description: playlist.description ?? null,
    is_public: playlist.is_public ?? false,
    images: unwrapImages(playlist.images),
    created_at: now,
    updated_at: now,
  };

  await db.put(STORE_PLAYLISTS, localPlaylist);
}

/**
 * create or update a local playlist with its songs.
 * called when syncing songs from a remote playlist to local storage.
 */
export async function upsertLocalPlaylistWithSongs(
  db: IDBPDatabase,
  playlist: {
    playlist_id: string;
    title: string;
    description?: string | null;
    is_public?: boolean;
    images?: ImageMetadata[];
  },
  songs: Song[]
): Promise<void> {
  const now = Date.now();

  // unwrap proxy arrays before storing
  const images = unwrapImages(playlist.images);

  // check if playlist exists
  const existing = await db.get(STORE_PLAYLISTS, playlist.playlist_id);

  if (existing) {
    // update existing playlist metadata
    const updated: Playlist = {
      ...existing,
      title: playlist.title,
      description: playlist.description ?? existing.description,
      is_public: playlist.is_public ?? existing.is_public,
      images: images ?? existing.images,
      updated_at: now,
    };
    await db.put(STORE_PLAYLISTS, updated);
  } else {
    // create new playlist
    const newPlaylist: Playlist = {
      playlist_id: playlist.playlist_id,
      title: playlist.title,
      description: playlist.description ?? null,
      is_public: playlist.is_public ?? false,
      images,
      created_at: now,
      updated_at: now,
    };
    await db.put(STORE_PLAYLISTS, newPlaylist);
  }

  // update songs - replace all existing with new list
  const tx = db.transaction(STORE_PLAYLIST_SONGS, "readwrite");
  const store = tx.objectStore(STORE_PLAYLIST_SONGS);

  // delete existing songs for this playlist
  const index = store.index("by_playlist_id");
  const existingSongs = await index.getAll(playlist.playlist_id);
  for (const song of existingSongs) {
    await store.delete([song.playlist_id, song.song_id]);
  }

  // add new songs (using sha256 as song_id for local storage)
  for (let i = 0; i < songs.length; i++) {
    const song = songs[i];
    const playlistSong: PlaylistSong = {
      playlist_id: playlist.playlist_id,
      song_id: song.sha256,
      position: i,
      added_at: now,
    };
    await store.put(playlistSong);
  }

  await tx.done;
}

/**
 * check if a playlist is editable
 */
export function isEditablePlaylist(_playlist: Playlist): boolean {
  // all playlists are now editable (sync metadata removed)
  return true;
}

/**
 * create or update playlist songs
 * replaces all existing songs with the new list
 */
export async function updatePlaylistSongs(
  db: IDBPDatabase,
  playlistId: string,
  songs: Array<{ song_id: string; position: number }>
): Promise<void> {
  const tx = db.transaction(STORE_PLAYLIST_SONGS, "readwrite");
  const store = tx.objectStore(STORE_PLAYLIST_SONGS);

  // delete existing songs for this playlist
  const index = store.index("by_playlist_id");
  const existingSongs = await index.getAll(playlistId);
  for (const song of existingSongs) {
    await store.delete([song.playlist_id, song.song_id]);
  }

  // add new songs
  const now = Date.now();
  for (const song of songs) {
    const playlistSong: PlaylistSong = {
      playlist_id: playlistId,
      song_id: song.song_id,
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
export async function deletePlaylist(db: IDBPDatabase, playlistId: string): Promise<void> {
  const tx = db.transaction(
    [STORE_PLAYLISTS, STORE_PLAYLIST_SONGS, STORE_PLAYLIST_VIDEO_ITEMS],
    "readwrite"
  );

  // delete playlist
  await tx.objectStore(STORE_PLAYLISTS).delete(playlistId);

  // delete all playlist songs
  const playlistSongsStore = tx.objectStore(STORE_PLAYLIST_SONGS);
  const index = playlistSongsStore.index("by_playlist_id");
  const songs = await index.getAll(playlistId);
  for (const song of songs) {
    await playlistSongsStore.delete([song.playlist_id, song.song_id]);
  }

  // delete all playlist video items
  const playlistVideoItemsStore = tx.objectStore(STORE_PLAYLIST_VIDEO_ITEMS);
  const videoIndex = playlistVideoItemsStore.index("by_playlist_id");
  const videoItems = await videoIndex.getAll(playlistId);
  for (const item of videoItems) {
    await playlistVideoItemsStore.delete([item.playlist_id, item.video_id]);
  }

  await tx.done;
}

/**
 * every video-typed item in a local playlist, ordered by position -
 * local counterpart to the remote `list_playlist_items` route (video-only
 * slice). resolving each id to full video metadata is the caller's job
 * (mirrors video/queries/playlistItems.ts's remote path).
 */
export async function getLocalPlaylistVideoItems(
  db: IDBPDatabase,
  playlistId: string
): Promise<PlaylistVideoItem[]> {
  const index = db.transaction(STORE_PLAYLIST_VIDEO_ITEMS).store.index("by_playlist_id");
  const items = (await index.getAll(playlistId)) as PlaylistVideoItem[];
  return items.sort((a, b) => a.position - b.position);
}

/**
 * add a single video to a local playlist (no-op if already present) -
 * local counterpart to the remote `add_playlist_item` route.
 */
export async function addVideoToLocalPlaylist(
  db: IDBPDatabase,
  playlistId: string,
  videoId: string
): Promise<void> {
  const tx = db.transaction([STORE_PLAYLISTS, STORE_PLAYLIST_VIDEO_ITEMS], "readwrite");
  const store = tx.objectStore(STORE_PLAYLIST_VIDEO_ITEMS);

  const existing = await store.get([playlistId, videoId]);
  if (!existing) {
    const index = store.index("by_playlist_id");
    const existingItems = (await index.getAll(playlistId)) as PlaylistVideoItem[];
    const maxPosition = existingItems.reduce((max, item) => Math.max(max, item.position), 0);
    const item: PlaylistVideoItem = {
      playlist_id: playlistId,
      video_id: videoId,
      position: maxPosition + 1,
      added_at: Date.now(),
    };
    await store.put(item);
  }

  const playlistsStore = tx.objectStore(STORE_PLAYLISTS);
  const playlist = await playlistsStore.get(playlistId);
  if (playlist) {
    playlist.updated_at = Date.now();
    await playlistsStore.put(playlist);
  }

  await tx.done;
}

/**
 * remove a single video from a local playlist - local counterpart to the
 * remote `remove_playlist_item` route.
 */
export async function removeVideoFromLocalPlaylist(
  db: IDBPDatabase,
  playlistId: string,
  videoId: string
): Promise<void> {
  const tx = db.transaction([STORE_PLAYLISTS, STORE_PLAYLIST_VIDEO_ITEMS], "readwrite");
  await tx.objectStore(STORE_PLAYLIST_VIDEO_ITEMS).delete([playlistId, videoId]);

  const playlistsStore = tx.objectStore(STORE_PLAYLISTS);
  const playlist = await playlistsStore.get(playlistId);
  if (playlist) {
    playlist.updated_at = Date.now();
    await playlistsStore.put(playlist);
  }

  await tx.done;
}
