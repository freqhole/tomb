// application database service (domain-agnostic)
import { openDB, type IDBPDatabase } from "idb";
import { createSignal } from "solid-js";
import { clearInProgressTracking } from "../../../music/services/cache/blobCache";
import type { Song } from "../../../music/services/storage/types";
import {
  APP_DB_NAME,
  APP_DB_VERSION,
  STORE_APP_STATE,
  type AppState,
} from "./types";

let dbInstance: IDBPDatabase | null = null;

// reactive signals for app state
const [appState, setAppState] = createSignal<AppState | null>(null);

// initialize app database
async function initAppDB(): Promise<IDBPDatabase> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB(APP_DB_NAME, APP_DB_VERSION, {
    upgrade(db) {
      // create app_state store
      if (!db.objectStoreNames.contains(STORE_APP_STATE)) {
        db.createObjectStore(STORE_APP_STATE, { keyPath: "id" });
      }
    },
  });

  // load initial app state
  await loadAppState();

  return dbInstance;
}

// load app state from db
async function loadAppState(): Promise<AppState> {
  const db = await initAppDB();
  let state = await db.get(STORE_APP_STATE, "app_state");

  if (!state) {
    // create default state
    state = {
      id: "app_state",
      current_sha256: null,
      queue: [],
      queue_open: false,
      active_remote_id: null,
      last_updated: Date.now(),
    };
    await db.put(STORE_APP_STATE, state);
  }

  setAppState(state);
  return state;
}

// update app state
async function updateAppState(
  updates: Partial<Omit<AppState, "id">>,
): Promise<AppState> {
  const db = await initAppDB();
  const current = appState() || (await loadAppState());

  const updated: AppState = {
    ...current,
    ...updates,
    id: "app_state",
    last_updated: Date.now(),
  };

  await db.put(STORE_APP_STATE, updated);
  setAppState(updated);

  return updated;
}

// set current song
async function setCurrentSong(songId: string | null): Promise<void> {
  await updateAppState({ current_sha256: songId });
}

// update queue
async function setQueue(songs: Song[]): Promise<void> {
  // unwrap proxy arrays before storing in IndexedDB
  const plainSongs = songs.map((song) => {
    const plain: Song = { ...song };
    if (song.album_tags) plain.album_tags = [...song.album_tags];
    if (song.album_sub_genres) plain.album_sub_genres = [...song.album_sub_genres];
    if (song.album_images) plain.album_images = song.album_images.map(img => ({ ...img }));
    if (song.images) plain.images = song.images.map(img => ({ ...img }));

    return plain;
  });
  
  await updateAppState({ queue: plainSongs });
  clearInProgressTracking();
}

// update a specific song in the queue (for metadata changes like favorites, ratings)
async function updateSongInQueue(
  songId: string,
  sha256: string,
  updates: Partial<Song>,
): Promise<void> {
  const state = appState();
  if (!state?.queue) return;

  // find and update the song in the queue
  const updatedQueue = state.queue.map((song) =>
    song.id === songId || song.sha256 === sha256
      ? { ...song, ...updates }
      : song,
  );

  // only update if something changed
  const hasChanges = updatedQueue.some(
    (song, index) => song !== state.queue[index],
  );

  if (hasChanges) {
    await setQueue(updatedQueue);
  }
}

// set queue open state
async function setQueueOpen(isOpen: boolean): Promise<void> {
  await updateAppState({ queue_open: isOpen });
}

// set active remote id
async function setActiveRemoteId(remoteId: string | null): Promise<void> {
  await updateAppState({ active_remote_id: remoteId });
}

// clear all app data
async function clearAppData(): Promise<void> {
  const db = await initAppDB();
  await db.clear(STORE_APP_STATE);
  setAppState(null);
}

export {
  appState,
  clearAppData,
  initAppDB,
  loadAppState,
  setActiveRemoteId,
  setCurrentSong,
  setQueue,
  setQueueOpen,
  updateAppState,
  updateSongInQueue,
};
