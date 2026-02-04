// application-level storage types (domain-agnostic)
import type { Song } from "../../../music/services/storage/types";

export interface AppState {
  id: "app_state";
  current_sha256: string | null; // currently playing song
  queue: Song[]; // array of songs in play order
  queue_open: boolean; // whether queue sidebar is open
  active_remote_id: string | null; // currently active remote source id
  last_updated: number;
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
export const APP_DB_VERSION = 2; // bumped for remotes table

// app store names
export const STORE_APP_STATE = "app_state";
export const STORE_REMOTES = "remotes";
