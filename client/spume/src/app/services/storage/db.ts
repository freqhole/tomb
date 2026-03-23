// application database service (domain-agnostic)
import { openDB, type IDBPDatabase } from "idb";
import { createSignal } from "solid-js";
import { clearInProgressTracking } from "../../../music/services/cache/blobCache";
import type { Song } from "../../../music/services/storage/types";
import {
  APP_DB_NAME,
  APP_DB_VERSION,
  STORE_ANALYTICS_EVENTS,
  STORE_APP_STATE,
  STORE_QUEUE_HISTORY,
  STORE_REMOTES,
  STORE_PENDING_REMOTES,
  type AppState,
  type P2PIdentity,
  type PendingRemote,
} from "./types";
import { debug } from "../../../utils/logger";
import { generateUUID } from "../../../utils/uuid";

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

      // create remotes store (v2)
      if (!db.objectStoreNames.contains(STORE_REMOTES)) {
        const remotesStore = db.createObjectStore(STORE_REMOTES, {
          keyPath: "remote_id",
        });
        remotesStore.createIndex("by_name", "name");
        remotesStore.createIndex("by_is_active", "is_active");
        remotesStore.createIndex("by_created_at", "created_at");
      }

      // create queue_history store (v3)
      if (!db.objectStoreNames.contains(STORE_QUEUE_HISTORY)) {
        const historyStore = db.createObjectStore(STORE_QUEUE_HISTORY, {
          keyPath: "id",
        });
        historyStore.createIndex("by_queued_at", "queued_at");
      }

      // create analytics_events store (v4)
      if (!db.objectStoreNames.contains(STORE_ANALYTICS_EVENTS)) {
        const eventsStore = db.createObjectStore(STORE_ANALYTICS_EVENTS, {
          keyPath: "id",
        });
        eventsStore.createIndex("by_status", "status");
        eventsStore.createIndex("by_created_at", "created_at");
      }

      // delete old pending_knocks store if it exists (v5 → v6 migration)
      if (db.objectStoreNames.contains("pending_knocks")) {
        db.deleteObjectStore("pending_knocks");
      }

      // create pending_remotes store (v6)
      if (!db.objectStoreNames.contains(STORE_PENDING_REMOTES)) {
        const pendingStore = db.createObjectStore(STORE_PENDING_REMOTES, {
          keyPath: "id",
        });
        pendingStore.createIndex("by_peer_addr", "peer_addr");
        pendingStore.createIndex("by_stage", "stage");
        pendingStore.createIndex("by_created_at", "created_at");
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
  // assign queue_entry_id to songs that don't have one
  const plainSongs = songs.map((song) => {
    const plain: Song = { ...song };
    if (!plain.queue_entry_id) {
      plain.queue_entry_id = generateUUID();
    }
    if (song.album_tags) plain.album_tags = [...song.album_tags];
    if (song.album_genres) plain.album_genres = song.album_genres.map(g => ({ ...g }));
    if (song.album_images) plain.album_images = song.album_images.map(img => ({ ...img }));
    if (song.artist_images) plain.artist_images = song.artist_images.map(img => ({ ...img }));
    if (song.images) plain.images = song.images.map(img => ({ ...img }));
    if (song.urls) plain.urls = song.urls.map(url => ({ ...url }));

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

// set sync queue to local setting
async function setSyncQueueToLocal(enabled: boolean): Promise<void> {
  await updateAppState({ sync_queue_to_local: enabled });
}

// get sync queue to local setting (default: true)
function getSyncQueueToLocal(): boolean {
  return appState()?.sync_queue_to_local ?? true;
}

// set auto-download enabled setting
async function setAutoDownloadEnabled(enabled: boolean): Promise<void> {
  await updateAppState({ auto_download_enabled: enabled });
}

// get auto-download enabled setting (default: false)
function getAutoDownloadEnabled(): boolean {
  return appState()?.auto_download_enabled ?? false;
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

// close database connection (required before deletion)
function closeAppDB(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    debug("appDB", "app database connection closed");
  }
}

// ============================================================================
// P2P identity persistence (midden)
// ============================================================================

// get stored P2P identity (returns null if not yet created)
async function getP2PIdentity(): Promise<P2PIdentity | null> {
  const db = await initAppDB();
  const identity = await db.get(STORE_APP_STATE, "p2p_identity");
  return identity ?? null;
}

// save P2P identity to IDB
async function saveP2PIdentity(secretKey: Uint8Array, nodeId: string): Promise<P2PIdentity> {
  const db = await initAppDB();
  const identity: P2PIdentity = {
    id: "p2p_identity",
    secret_key: secretKey,
    node_id: nodeId,
    created_at: Date.now(),
  };
  await db.put(STORE_APP_STATE, identity);
  debug("appDB", "saved P2P identity:", nodeId.slice(0, 16) + "...");
  return identity;
}

// delete P2P identity (for reset/regeneration)
async function deleteP2PIdentity(): Promise<void> {
  const db = await initAppDB();
  await db.delete(STORE_APP_STATE, "p2p_identity");
  debug("appDB", "deleted P2P identity");
}

// ============================================================================
// pending remotes - in-progress remote additions
// ============================================================================

// create a pending remote (when test connection succeeds)
async function createPendingRemote(
  pending: Omit<PendingRemote, "id" | "created_at" | "updated_at">
): Promise<PendingRemote> {
  const db = await initAppDB();
  const newPending: PendingRemote = {
    ...pending,
    id: generateUUID(),
    created_at: Date.now(),
    updated_at: Date.now(),
  };
  await db.put(STORE_PENDING_REMOTES, newPending);
  debug("appDB", "created pending remote for peer:", pending.peer_addr.slice(0, 16) + "...");
  return newPending;
}

// get all pending remotes
async function getAllPendingRemotes(): Promise<PendingRemote[]> {
  const db = await initAppDB();
  return db.getAll(STORE_PENDING_REMOTES);
}

// get pending remote by peer_addr
async function getPendingRemoteByPeerAddr(peerAddr: string): Promise<PendingRemote | undefined> {
  const db = await initAppDB();
  const index = db.transaction(STORE_PENDING_REMOTES).store.index("by_peer_addr");
  return index.get(peerAddr);
}

// get pending remote by id
async function getPendingRemoteById(id: string): Promise<PendingRemote | undefined> {
  const db = await initAppDB();
  return db.get(STORE_PENDING_REMOTES, id);
}

// update pending remote
async function updatePendingRemote(
  id: string,
  updates: Partial<Omit<PendingRemote, "id" | "created_at">>
): Promise<PendingRemote | undefined> {
  const db = await initAppDB();
  const pending = (await db.get(STORE_PENDING_REMOTES, id)) as PendingRemote | undefined;
  if (!pending) return undefined;

  const updated: PendingRemote = {
    ...pending,
    ...updates,
    updated_at: Date.now(),
  };
  await db.put(STORE_PENDING_REMOTES, updated);
  debug("appDB", "updated pending remote:", id, "stage:", updated.stage);
  return updated;
}

// delete pending remote (when converted to real remote, or user dismisses)
async function deletePendingRemote(id: string): Promise<void> {
  const db = await initAppDB();
  await db.delete(STORE_PENDING_REMOTES, id);
  debug("appDB", "deleted pending remote:", id);
}

// delete pending remote by peer_addr
async function deletePendingRemoteByPeerAddr(peerAddr: string): Promise<void> {
  const db = await initAppDB();
  const pending = await getPendingRemoteByPeerAddr(peerAddr);
  if (pending) {
    await db.delete(STORE_PENDING_REMOTES, pending.id);
    debug("appDB", "deleted pending remote for peer:", peerAddr.slice(0, 16) + "...");
  }
}

export {
  appState,
  clearAppData,
  closeAppDB,
  createPendingRemote,
  deletePendingRemote,
  deletePendingRemoteByPeerAddr,
  deleteP2PIdentity,
  getAutoDownloadEnabled,
  getAllPendingRemotes,
  getPendingRemoteById,
  getPendingRemoteByPeerAddr,
  getP2PIdentity,
  getSyncQueueToLocal,
  initAppDB,
  loadAppState,
  saveP2PIdentity,
  setActiveRemoteId,
  setAutoDownloadEnabled,
  setCurrentSong,
  setQueue,
  setQueueOpen,
  setSyncQueueToLocal,
  updateAppState,
  updatePendingRemote,
  updateSongInQueue,
};
