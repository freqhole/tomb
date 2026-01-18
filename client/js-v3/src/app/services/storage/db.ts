// application database service (domain-agnostic)
import { openDB, type IDBPDatabase } from "idb";
import { createSignal } from "solid-js";
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
      current_song_id: null,
      queue: [],
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
  await updateAppState({ current_song_id: songId });
}

// update queue
async function setQueue(songs: Song[]): Promise<void> {
  await updateAppState({ queue: songs });
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
  setCurrentSong,
  setQueue,
  updateAppState,
};
