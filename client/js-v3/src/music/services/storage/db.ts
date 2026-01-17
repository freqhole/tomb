// music database service (music domain)
import { openDB, type IDBPDatabase } from "idb";
import { createSignal } from "solid-js";
import {
  MUSIC_DB_NAME,
  MUSIC_DB_VERSION,
  STORE_MUSIC_SONGS,
  type MusicSong,
  type MusicSourceType,
} from "./types";

let dbInstance: IDBPDatabase | null = null;

// reactive signals for music data
const [songs, setSongs] = createSignal<MusicSong[]>([]);

// initialize music database
async function initMusicDB(): Promise<IDBPDatabase> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB(MUSIC_DB_NAME, MUSIC_DB_VERSION, {
    upgrade(db) {
      // create music_songs store
      if (!db.objectStoreNames.contains(STORE_MUSIC_SONGS)) {
        const store = db.createObjectStore(STORE_MUSIC_SONGS, {
          keyPath: "id",
        });
        // index by source type for filtering
        store.createIndex("by_source_type", "source_type");
        // index by added date for sorting
        store.createIndex("by_added_at", "added_at");
      }
    },
  });

  // load initial songs
  await loadAllSongs();

  return dbInstance;
}

// load all songs from db
async function loadAllSongs(): Promise<MusicSong[]> {
  const db = await initMusicDB();
  const allSongs = await db.getAll(STORE_MUSIC_SONGS);
  setSongs(allSongs);
  return allSongs;
}

// get song by id
async function getSongById(id: string): Promise<MusicSong | undefined> {
  const db = await initMusicDB();
  return await db.get(STORE_MUSIC_SONGS, id);
}

// add song to library
async function addSong(song: MusicSong): Promise<void> {
  const db = await initMusicDB();
  await db.put(STORE_MUSIC_SONGS, song);

  // manually update the signal instead of reloading all songs
  setSongs([...songs(), song]);
}

// update song
async function updateSong(
  id: string,
  updates: Partial<Omit<MusicSong, "id">>,
): Promise<void> {
  const db = await initMusicDB();
  const existing = await db.get(STORE_MUSIC_SONGS, id);
  if (!existing) {
    throw new Error(`song not found: ${id}`);
  }

  const updated: MusicSong = {
    ...existing,
    ...updates,
    id,
  };

  await db.put(STORE_MUSIC_SONGS, updated);
  await loadAllSongs();
}

// delete song
async function deleteSong(id: string): Promise<void> {
  const db = await initMusicDB();
  await db.delete(STORE_MUSIC_SONGS, id);
  await loadAllSongs();
}

// get songs by source type
async function getSongsBySource(
  sourceType: MusicSourceType,
): Promise<MusicSong[]> {
  const db = await initMusicDB();
  const index = db.transaction(STORE_MUSIC_SONGS).store.index("by_source_type");
  return await index.getAll(sourceType);
}

// clear all music data
async function clearMusicData(): Promise<void> {
  const db = await initMusicDB();
  await db.clear(STORE_MUSIC_SONGS);
  setSongs([]);
}

export {
  addSong,
  clearMusicData,
  deleteSong,
  getSongById,
  getSongsBySource,
  initMusicDB,
  loadAllSongs,
  songs,
  updateSong,
};
