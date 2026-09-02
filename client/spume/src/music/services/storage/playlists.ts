// playlist storage helpers

import type { IDBPDatabase } from "idb";
import type { ImageMetadata, Playlist, PlaylistItem, Song } from "./types";
import { STORE_PLAYLISTS, STORE_PLAYLIST_ITEMS } from "./types";

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

  // update songs - replace all existing song-typed items with new list
  // (video-typed items in the same unified store are left untouched)
  const tx = db.transaction(STORE_PLAYLIST_ITEMS, "readwrite");
  const store = tx.objectStore(STORE_PLAYLIST_ITEMS);

  // delete existing song-typed items for this playlist
  const index = store.index("by_playlist_id");
  const existingItems = (await index.getAll(playlist.playlist_id)) as PlaylistItem[];
  for (const item of existingItems) {
    if (item.entity_type === "song") {
      await store.delete([item.playlist_id, item.entity_type, item.entity_id]);
    }
  }

  // add new songs (using sha256 as entity_id for local storage)
  for (let i = 0; i < songs.length; i++) {
    const song = songs[i];
    const playlistItem: PlaylistItem = {
      playlist_id: playlist.playlist_id,
      entity_type: "song",
      entity_id: song.sha256,
      position: i,
      added_at: now,
    };
    await store.put(playlistItem);
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
 * replaces all existing song-typed items with the new list (video-typed
 * items in the same unified store are left untouched)
 */
export async function updatePlaylistSongs(
  db: IDBPDatabase,
  playlistId: string,
  songs: Array<{ song_id: string; position: number }>
): Promise<void> {
  const tx = db.transaction(STORE_PLAYLIST_ITEMS, "readwrite");
  const store = tx.objectStore(STORE_PLAYLIST_ITEMS);

  // delete existing song-typed items for this playlist
  const index = store.index("by_playlist_id");
  const existingItems = (await index.getAll(playlistId)) as PlaylistItem[];
  for (const item of existingItems) {
    if (item.entity_type === "song") {
      await store.delete([item.playlist_id, item.entity_type, item.entity_id]);
    }
  }

  // add new songs
  const now = Date.now();
  for (const song of songs) {
    const playlistItem: PlaylistItem = {
      playlist_id: playlistId,
      entity_type: "song",
      entity_id: song.song_id,
      position: song.position,
      added_at: now,
    };
    await store.put(playlistItem);
  }

  await tx.done;
}

/**
 * reorder every item (songs AND videos) in a local playlist -
 * `orderedItems` must contain every item currently in the playlist, in
 * the desired new order (see grimoire's ReorderPlaylistItemsRequest doc
 * comment for why a full ordered list, rather than a move-to-position
 * delta, is required). local counterpart to the remote
 * `reorder_playlist_items` route.
 */
export async function reorderLocalPlaylistItems(
  db: IDBPDatabase,
  playlistId: string,
  orderedItems: Array<{ entity_type: "song" | "video"; entity_id: string }>
): Promise<void> {
  const tx = db.transaction([STORE_PLAYLISTS, STORE_PLAYLIST_ITEMS], "readwrite");
  const store = tx.objectStore(STORE_PLAYLIST_ITEMS);

  const index = store.index("by_playlist_id");
  const existingItems = (await index.getAll(playlistId)) as PlaylistItem[];
  const addedAtByKey = new Map(
    existingItems.map((item) => [`${item.entity_type}:${item.entity_id}`, item.added_at])
  );

  const now = Date.now();
  for (let i = 0; i < orderedItems.length; i++) {
    const ref = orderedItems[i];
    const key = `${ref.entity_type}:${ref.entity_id}`;
    const item: PlaylistItem = {
      playlist_id: playlistId,
      entity_type: ref.entity_type,
      entity_id: ref.entity_id,
      position: i,
      added_at: addedAtByKey.get(key) ?? now,
    };
    await store.put(item);
  }

  const playlistsStore = tx.objectStore(STORE_PLAYLISTS);
  const playlist = await playlistsStore.get(playlistId);
  if (playlist) {
    playlist.updated_at = now;
    await playlistsStore.put(playlist);
  }

  await tx.done;
}

/**
 * delete a playlist and all its items (songs + videos)
 */
export async function deletePlaylist(db: IDBPDatabase, playlistId: string): Promise<void> {
  const tx = db.transaction([STORE_PLAYLISTS, STORE_PLAYLIST_ITEMS], "readwrite");

  // delete playlist
  await tx.objectStore(STORE_PLAYLISTS).delete(playlistId);

  // delete all playlist items (songs + videos)
  const playlistItemsStore = tx.objectStore(STORE_PLAYLIST_ITEMS);
  const index = playlistItemsStore.index("by_playlist_id");
  const items = (await index.getAll(playlistId)) as PlaylistItem[];
  for (const item of items) {
    await playlistItemsStore.delete([item.playlist_id, item.entity_type, item.entity_id]);
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
): Promise<Array<{ playlist_id: string; video_id: string; position: number; added_at: number }>> {
  const index = db.transaction(STORE_PLAYLIST_ITEMS).store.index("by_playlist_id");
  const items = (await index.getAll(playlistId)) as PlaylistItem[];
  return items
    .filter((item) => item.entity_type === "video")
    .map((item) => ({
      playlist_id: item.playlist_id,
      video_id: item.entity_id,
      position: item.position,
      added_at: item.added_at,
    }))
    .sort((a, b) => a.position - b.position);
}

/**
 * add several entities (songs and/or videos) to a local playlist in one
 * call, auto-appending each at the end (in the order given). items
 * already in the playlist are silently skipped - local counterpart to
 * the remote `add_playlist_items` bulk route.
 */
export async function addPlaylistItemsToLocal(
  db: IDBPDatabase,
  playlistId: string,
  refs: Array<{ entity_type: "song" | "video"; entity_id: string }>
): Promise<void> {
  const tx = db.transaction([STORE_PLAYLISTS, STORE_PLAYLIST_ITEMS], "readwrite");
  const store = tx.objectStore(STORE_PLAYLIST_ITEMS);

  const index = store.index("by_playlist_id");
  const existingItems = (await index.getAll(playlistId)) as PlaylistItem[];
  let maxPosition = existingItems.reduce((max, item) => Math.max(max, item.position), 0);
  const existingKeys = new Set(existingItems.map((i) => `${i.entity_type}:${i.entity_id}`));

  const now = Date.now();
  for (const ref of refs) {
    const key = `${ref.entity_type}:${ref.entity_id}`;
    if (existingKeys.has(key)) continue;
    maxPosition += 1;
    const item: PlaylistItem = {
      playlist_id: playlistId,
      entity_type: ref.entity_type,
      entity_id: ref.entity_id,
      position: maxPosition,
      added_at: now,
    };
    await store.put(item);
    existingKeys.add(key);
  }

  const playlistsStore = tx.objectStore(STORE_PLAYLISTS);
  const playlist = await playlistsStore.get(playlistId);
  if (playlist) {
    playlist.updated_at = now;
    await playlistsStore.put(playlist);
  }

  await tx.done;
}

/**
 * remove several entities (songs and/or videos) from a local playlist in
 * one call - local counterpart to the remote `remove_playlist_items` bulk
 * route.
 */
export async function removePlaylistItemsFromLocal(
  db: IDBPDatabase,
  playlistId: string,
  refs: Array<{ entity_type: "song" | "video"; entity_id: string }>
): Promise<void> {
  const tx = db.transaction([STORE_PLAYLISTS, STORE_PLAYLIST_ITEMS], "readwrite");
  const store = tx.objectStore(STORE_PLAYLIST_ITEMS);

  for (const ref of refs) {
    await store.delete([playlistId, ref.entity_type, ref.entity_id]);
  }

  const playlistsStore = tx.objectStore(STORE_PLAYLISTS);
  const playlist = await playlistsStore.get(playlistId);
  if (playlist) {
    playlist.updated_at = Date.now();
    await playlistsStore.put(playlist);
  }

  await tx.done;
}
