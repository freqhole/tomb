// application-level storage types (domain-agnostic)
import type { ImageMetadata, Song } from "../../../music/services/storage/types";

export interface AppState {
  id: "app_state";
  current_sha256: string | null; // currently playing song
  queue: Song[]; // array of songs in play order
  queue_open: boolean; // whether queue sidebar is open
  active_remote_id: string | null; // currently active remote source id
  last_updated: number;
}

// queue history entry — represents one "add to queue" action
export type QueueHistorySourceType =
  | "song"
  | "album"
  | "artist"
  | "genre"
  | "playlist"
  | "shuffle";

export interface QueueHistoryEntry {
  id: string; // uuid
  type: QueueHistorySourceType;
  label: string; // display text, e.g. "KMFDM - Angst"
  entity_id?: string; // album_id, artist_id, playlist_id, genre name
  song_count: number; // how many songs were added
  songs: Song[]; // the actual songs (for re-queuing)
  queued_at: number; // timestamp
  image?: ImageMetadata; // first image for thumbnail
}

// source context passed to addToQueue/playQueue for history tracking
export interface QueueSourceContext {
  type: QueueHistorySourceType;
  label: string;
  entity_id?: string;
  image?: ImageMetadata;
}

// remote server configurations (no credentials - uses cookies)
export interface Remote {
  remote_id: string; // uuid
  name: string; // user-friendly name (e.g. "home server", "work laptop")
  base_url: string; // server url (e.g. "https://music.example.com")
  is_active: boolean; // currently selected remote
  last_connected_at: number | null; // timestamp of last successful connection
  created_at: number;
  updated_at: number;
  // server info (fetched from /api/hello)
  server_id: string | null; // stable unique identifier from server
  description: string | null; // server description
  image_url: string | null; // server image/logo url
  version: string | null; // server version
  last_info_check: number | null; // timestamp of last server info fetch
}

// database schema version
export const APP_DB_NAME = "freqhole_app";
export const APP_DB_VERSION = 3; // bumped for queue_history store

// app store names
export const STORE_APP_STATE = "app_state";
export const STORE_REMOTES = "remotes";
export const STORE_QUEUE_HISTORY = "queue_history";
