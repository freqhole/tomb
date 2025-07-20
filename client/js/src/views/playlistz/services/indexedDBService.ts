// IndexedDB Service with Reactive Queries
// Based on the existing demo pattern but adapted for music playlists

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Playlist, Song } from "../types/playlist.js";

// Simple signal implementation (matching the demo pattern)
interface Signal<T> {
  get: () => T;
  set: (value: T) => void;
  subscribe: (fn: (value: T) => void) => () => void;
}

interface ExtendedSignal<T> extends Signal<T> {
  // Extended signal with proper cleanup
}

function createSignal<T>(initial: T): Signal<T> {
  let value = initial;
  const subs = new Set<(value: T) => void>();

  return {
    get: () => value,
    set: (newVal) => {
      if (value !== newVal) {
        value = newVal;
        subs.forEach((fn) => fn(value));
      }
    },
    subscribe: (fn) => {
      subs.add(fn);
      fn(value);
      return () => subs.delete(fn);
    },
  };
}

// Database configuration
export const DB_NAME = "musicPlaylistDB";
export const DB_VERSION = 1;
export const PLAYLISTS_STORE = "playlists";
export const SONGS_STORE = "songs";

// Database schema definition
interface PlaylistDB extends DBSchema {
  playlists: {
    key: string;
    value: Playlist;
  };
  songs: {
    key: string;
    value: Song;
    indexes: { playlistId: string };
  };
}

// Database connection cache to prevent excessive setupDB calls
let cachedDB: Promise<IDBPDatabase<PlaylistDB>> | null = null;

// Database setup with caching
export async function setupDB(): Promise<IDBPDatabase<PlaylistDB>> {
  if (cachedDB) {
    return cachedDB;
  }

  console.log("🗄️ Setting up IndexedDB:", DB_NAME, "version:", DB_VERSION);
  cachedDB = openDB<PlaylistDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      console.log("🔧 Database upgrade triggered");
      // Create playlists store
      if (!db.objectStoreNames.contains(PLAYLISTS_STORE)) {
        console.log("📝 Creating playlists store");
        db.createObjectStore(PLAYLISTS_STORE, { keyPath: "id" });
      }

      // Create songs store with playlist index
      if (!db.objectStoreNames.contains(SONGS_STORE)) {
        console.log("📝 Creating songs store");
        const songStore = db.createObjectStore(SONGS_STORE, { keyPath: "id" });
        songStore.createIndex("playlistId", "playlistId", { unique: false });
      }
      console.log("✅ Database stores created");
    },
  });

  return cachedDB;
}

// Live query configuration
interface LiveQueryConfig {
  dbName: string;
  storeName: string;
  queryFn?: (item: any) => boolean;
  fields?: string[];
  limit?: number | null;
}

// Simple diff function (avoiding microdiff dependency)
function arraysDiffer<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return true;
  return a.some((item, index) => {
    if (typeof item === "object" && item !== null && b[index] !== null) {
      return JSON.stringify(item) !== JSON.stringify(b[index]);
    }
    return item !== b[index];
  });
}

// Create live query (returns both custom signal and SolidJS integration)
// Global registry to track all live queries for direct updates
const globalQueryRegistry = new Map<string, Set<() => void>>();

export function createLiveQuery<T>({
  dbName,
  storeName,
  queryFn,
  fields = [],
  limit = null,
}: LiveQueryConfig): ExtendedSignal<T[]> {
  const signal = createSignal<T[]>([]);
  const bc = new BroadcastChannel(`${dbName}-changes`);
  let last: T[] = [];

  async function fetchAndUpdate() {
    try {
      const db = await setupDB();
      let items = await db.getAll(storeName as any);

      console.log(`📊 Fetched ${items.length} items from ${storeName}`);

      if (queryFn) items = items.filter(queryFn);
      if (limit) items = items.slice(0, limit);

      const filtered = items.map((item) => {
        if (fields.length === 0) return item;

        const out: any = { id: item.id };
        for (const f of fields) {
          out[f] = item[f];
        }
        return out;
      });

      console.log(`📊 Filtered to ${filtered.length} items for ${storeName}`);

      if (arraysDiffer(last, filtered)) {
        last = filtered;
        signal.set(filtered);
        console.log(
          `🔄 Updated signal for ${storeName} with ${filtered.length} items`
        );
      }
    } catch (error) {
      console.error("Error in fetchAndUpdate:", error);
    }
  }

  // Register this query in the global registry for direct updates
  const registryKey = `${dbName}-${storeName}`;
  if (!globalQueryRegistry.has(registryKey)) {
    globalQueryRegistry.set(registryKey, new Set());
  }
  const querySet = globalQueryRegistry.get(registryKey)!;
  querySet.add(fetchAndUpdate);

  // BroadcastChannel listener (for cross-tab updates)
  bc.onmessage = (e) => {
    console.log(
      "📡 Broadcast message received:",
      e.data,
      "for store:",
      storeName
    );
    if (e.data?.type === "mutation" && e.data.store === storeName) {
      console.log("🔄 Triggering fetchAndUpdate for store:", storeName);
      fetchAndUpdate();
    }
  };

  // Initial fetch
  fetchAndUpdate();

  // Return signal with cleanup function
  const originalSignal = signal;
  return {
    ...originalSignal,
    subscribe: (fn: (value: T[]) => void) => {
      const unsubscribe = originalSignal.subscribe(fn);
      return () => {
        unsubscribe();
        // Remove from registry when unsubscribing
        querySet.delete(fetchAndUpdate);
        if (querySet.size === 0) {
          globalQueryRegistry.delete(registryKey);
        }
        bc.close();
      };
    },
  } as ExtendedSignal<T[]>;
}

// Mutation with notification (matching demo pattern)
interface MutationConfig {
  dbName: string;
  storeName: string;
  key: string;
  updateFn: (current: any) => any;
}

export async function mutateAndNotify({
  dbName,
  storeName,
  key,
  updateFn,
}: MutationConfig): Promise<void> {
  const db = await setupDB();
  const tx = db.transaction(storeName as any, "readwrite");
  const store = tx.objectStore(storeName as any);

  const current = await store.get(key);
  const updated = await updateFn(current || { id: key });
  await store.put(updated);
  await tx.done;

  // Direct updates to same-tab queries (immediate)
  const registryKey = `${dbName}-${storeName}`;
  const querySet = globalQueryRegistry.get(registryKey);
  if (querySet) {
    console.log(
      `🔄 Direct update: triggering ${querySet.size} queries for ${storeName}`
    );
    for (const fetchAndUpdate of querySet) {
      try {
        fetchAndUpdate();
      } catch (error) {
        console.error("Error in direct query update:", error);
      }
    }
  }

  // BroadcastChannel for cross-tab updates (async)
  const bc = new BroadcastChannel(`${dbName}-changes`);
  const message = { type: "mutation", store: storeName, id: key };
  console.log("📢 Broadcasting mutation:", message);
  bc.postMessage(message);
  bc.close();
}

// Playlist operations
export async function createPlaylist(
  playlist: Omit<Playlist, "id" | "createdAt" | "updatedAt">
): Promise<Playlist> {
  const id = crypto.randomUUID();
  const now = Date.now();

  const newPlaylist: Playlist = {
    id,
    createdAt: now,
    updatedAt: now,
    ...playlist,
    songIds: playlist.songIds || [],
  };

  await mutateAndNotify({
    dbName: DB_NAME,
    storeName: PLAYLISTS_STORE,
    key: id,
    updateFn: () => newPlaylist,
  });

  console.log("💾 Playlist saved to IndexedDB:", newPlaylist);
  return newPlaylist;
}

export async function updatePlaylist(
  id: string,
  updates: Partial<Playlist>
): Promise<void> {
  await mutateAndNotify({
    dbName: DB_NAME,
    storeName: PLAYLISTS_STORE,
    key: id,
    updateFn: (current) => ({
      ...current,
      ...updates,
      updatedAt: Date.now(),
    }),
  });
}

export async function deletePlaylist(id: string): Promise<void> {
  const db = await setupDB();

  // Delete all songs in the playlist first
  const tx1 = db.transaction(SONGS_STORE, "readwrite");
  const songStore = tx1.objectStore(SONGS_STORE);
  const index = songStore.index("playlistId");

  let cursor = await index.openCursor(IDBKeyRange.only(id));
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx1.done;

  // Delete the playlist
  const tx2 = db.transaction(PLAYLISTS_STORE, "readwrite");
  await tx2.objectStore(PLAYLISTS_STORE).delete(id);
  await tx2.done;

  const bc = new BroadcastChannel(`${DB_NAME}-changes`);
  bc.postMessage({ type: "mutation", store: PLAYLISTS_STORE, id });
  bc.postMessage({ type: "mutation", store: SONGS_STORE, id });
}

// Song operations
export async function addSongToPlaylist(
  playlistId: string,
  file: File,
  metadata: Partial<Song> = {}
): Promise<Song> {
  const songId = crypto.randomUUID();
  const now = Date.now();

  const song: Song = {
    id: songId,
    file,
    title: metadata.title || file.name.replace(/\.[^/.]+$/, ""), // Remove file extension
    artist: metadata.artist || "Unknown Artist",
    album: metadata.album || "Unknown Album",
    duration: metadata.duration || 0,
    position: metadata.position || 0,
    playlistId,
    createdAt: now,
    updatedAt: now,
    ...metadata,
  };

  // Add song to songs store
  await mutateAndNotify({
    dbName: DB_NAME,
    storeName: SONGS_STORE,
    key: songId,
    updateFn: () => song,
  });

  console.log("🎵 Song saved to IndexedDB:", song.title);

  // Update playlist's song list
  await mutateAndNotify({
    dbName: DB_NAME,
    storeName: PLAYLISTS_STORE,
    key: playlistId,
    updateFn: (playlist) => ({
      ...playlist,
      songIds: [...(playlist.songIds || []), songId],
      updatedAt: now,
    }),
  });

  console.log("📝 Playlist updated with new song");
  return song;
}

export async function updateSong(
  id: string,
  updates: Partial<Song>
): Promise<void> {
  await mutateAndNotify({
    dbName: DB_NAME,
    storeName: SONGS_STORE,
    key: id,
    updateFn: (current) => ({
      ...current,
      ...updates,
      updatedAt: Date.now(),
    }),
  });
}

export async function deleteSong(songId: string): Promise<void> {
  const db = await setupDB();

  // Get the song to find its playlist
  const song = await db.get(SONGS_STORE, songId);
  if (!song) return;

  // Remove song from playlist's songIds
  await mutateAndNotify({
    dbName: DB_NAME,
    storeName: PLAYLISTS_STORE,
    key: song.playlistId,
    updateFn: (playlist) => ({
      ...playlist,
      songIds: (playlist.songIds || []).filter((id: string) => id !== songId),
      updatedAt: Date.now(),
    }),
  });

  // Delete the song
  const tx = db.transaction(SONGS_STORE, "readwrite");
  await tx.objectStore(SONGS_STORE).delete(songId);
  await tx.done;

  const bc = new BroadcastChannel(`${DB_NAME}-changes`);
  bc.postMessage({ type: "mutation", store: SONGS_STORE, id: songId });
}

// Reorder songs in playlist
export async function reorderSongs(
  playlistId: string,
  fromIndex: number,
  toIndex: number
): Promise<void> {
  await mutateAndNotify({
    dbName: DB_NAME,
    storeName: PLAYLISTS_STORE,
    key: playlistId,
    updateFn: (playlist) => {
      const songIds = [...(playlist.songIds || [])];
      const [movedSong] = songIds.splice(fromIndex, 1);
      songIds.splice(toIndex, 0, movedSong);

      return {
        ...playlist,
        songIds,
        updatedAt: Date.now(),
      };
    },
  });

  // Update position field on all affected songs
  const db = await setupDB();
  const tx = db.transaction(SONGS_STORE, "readwrite");
  const store = tx.objectStore(SONGS_STORE);
  const index = store.index("playlistId");

  const updates: Promise<void>[] = [];
  let cursor = await index.openCursor(IDBKeyRange.only(playlistId));

  while (cursor) {
    const song = cursor.value;
    // Find new position in the reordered array
    // This is a simplified approach - in practice you might want to get the playlist first
    updates.push(
      mutateAndNotify({
        dbName: DB_NAME,
        storeName: SONGS_STORE,
        key: song.id,
        updateFn: (current) => ({
          ...current,
          position: 0, // Will be updated with proper logic
          updatedAt: Date.now(),
        }),
      })
    );
    cursor = await cursor.continue();
  }

  await tx.done;
}

// Query helpers
export function createPlaylistsQuery() {
  return createLiveQuery<Playlist>({
    dbName: DB_NAME,
    storeName: PLAYLISTS_STORE,
    fields: [
      "title",
      "description",
      "image",
      "createdAt",
      "updatedAt",
      "songIds",
    ],
  });
}

export function createPlaylistSongsQuery(playlistId: string) {
  return createLiveQuery<Song>({
    dbName: DB_NAME,
    storeName: SONGS_STORE,
    queryFn: (song) => song.playlistId === playlistId,
    fields: [
      "title",
      "artist",
      "album",
      "duration",
      "position",
      "image",
      "createdAt",
      "updatedAt",
      "playlistId",
    ],
  });
}
