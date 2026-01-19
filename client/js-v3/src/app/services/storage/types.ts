// application-level storage types (domain-agnostic)
import type { Song } from "../../../music/services/storage/types";

export interface AppState {
  id: "app_state";
  current_song_id: string | null; // currently playing song
  queue: Song[]; // array of songs in play order
  queue_open: boolean; // whether queue sidebar is open
  active_remote_id: string | null; // currently active remote source id
  last_updated: number;
}

// database schema version
export const APP_DB_NAME = "freqhole_app";
export const APP_DB_VERSION = 1;

// app store names
export const STORE_APP_STATE = "app_state";
