// application-level storage types (domain-agnostic)

export interface AppState {
  id: "app_state";
  current_song_id: string | null; // currently playing song
  queue: string[]; // array of song ids in play order
  last_updated: number;
}

// database schema version
export const APP_DB_NAME = "freqhole_app";
export const APP_DB_VERSION = 1;

// app store names
export const STORE_APP_STATE = "app_state";
