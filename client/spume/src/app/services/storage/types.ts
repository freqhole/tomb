// application-level storage types (domain-agnostic)
import type { ImageMetadata, Song } from "../../../music/services/storage/types";

export interface AppState {
  id: "app_state";
  current_sha256: string | null; // currently playing song
  queue: Song[]; // array of songs in play order
  queue_open: boolean; // whether queue sidebar is open
  active_remote_id: string | null; // currently active remote source id
  last_updated: number;
  // tracks dismissed persistent notices, keyed by notice ID + version
  // e.g. { "config-upgrade:0.1.4": true }
  dismissed_notices?: Record<string, boolean>;
  // when true, queue songs from remotes are synced to local library (default: true)
  sync_queue_to_local?: boolean;
  // when true, auto-downloads all queue songs in background (default: false)
  auto_download_enabled?: boolean;
}

// queue history entry — represents one "add to queue" action
export type QueueHistorySourceType =
  | "song"
  | "album"
  | "artist"
  | "genre"
  | "playlist"
  | "shuffle"
  | "radio_station";

// reference to a radio station stored in queue history
export interface RadioStationRef {
  peer_addr: string;        // peer addr used with tuneIntoRadio
  station_id?: string;      // optional station id
  station_name: string;     // display label
  is_local?: boolean;       // true if this is an in-process (self) station
  art_thumb_b64?: string;   // base64 thumbnail for display
  art_thumb_mime?: string;
}

export interface QueueHistoryEntry {
  id: string; // uuid
  type: QueueHistorySourceType;
  label: string; // display text, e.g. "KMFDM - Angst"
  entity_id?: string; // album_id, artist_id, playlist_id, genre name
  remote_name?: string; // name of the remote server (null/undefined for local)
  song_count: number; // how many songs were added
  songs: Song[]; // the actual songs (for re-queuing)
  queued_at: number; // timestamp
  image?: ImageMetadata; // first image for thumbnail
  // listen progress tracking (v4)
  listened_seconds: number; // total seconds listened across all songs
  total_seconds: number; // sum of all song durations
  songs_completed: number; // songs where >90% was listened
  current_song_index: number; // which song we're on (for resume)
  current_song_position: number; // position in current song (for resume)
  // server session tracking (for reconnection after page reload)
  server_session_id?: string; // active server-side listen session id
  server_remote_id?: string; // remote_server_id the session is on
  // radio station bookmark (only set when type === "radio_station")
  radio_station_ref?: RadioStationRef;
}

// analytics event — queued locally for offline-first sync to server
export type AnalyticsEventType =
  | "play_complete"
  | "favorite"
  | "unfavorite"
  | "rate";

export type AnalyticsEventStatus =
  | "pending"
  | "sending"
  | "failed"
  | "sent";

export interface AnalyticsEvent {
  id: string; // uuid
  type: AnalyticsEventType;
  payload: {
    media_blob_id?: string;
    song_id?: string;
    session_id?: string;
    event_data?: Record<string, unknown>;
    // routing: which remote this event should be sent to
    target_remote_id?: string;
    target_base_url?: string;
  };
  status: AnalyticsEventStatus;
  retry_count: number;
  max_retries: number;
  created_at: number;
  last_attempt_at?: number;
  error?: string;
}

// source context passed to addToQueue/playQueue for history tracking
export interface QueueSourceContext {
  type: QueueHistorySourceType;
  label: string;
  entity_id?: string;
  image?: ImageMetadata;
}

// remote types - re-export from centralized zod schemas
export {
  type TransportType,
  type Remote,
  type HttpRemote,
  type P2PRemote,
  type RemoteRef,
  isHttpRemote,
  isP2PRemote,
  parseRemote,
  safeParseRemote,
  parseRemotes,
  toRemoteRef,
} from "./schemas";

// P2P identity stored in app_state store with id: "p2p_identity"
export interface P2PIdentity {
  id: "p2p_identity";
  secret_key: Uint8Array; // 32-byte iroh secret key
  node_id: string; // public node_id derived from secret key
  created_at: number;
}

// database schema version
export const APP_DB_NAME = "freqhole_app";
export const APP_DB_VERSION = 7; // added radio_history store

// app store names
export const STORE_APP_STATE = "app_state"; // also stores P2PIdentity with id: "p2p_identity"
export const STORE_REMOTES = "remotes";
export const STORE_QUEUE_HISTORY = "queue_history";
export const STORE_ANALYTICS_EVENTS = "analytics_events";
export const STORE_PENDING_REMOTES = "pending_remotes";
export const STORE_RADIO_HISTORY = "radio_history";

// radio history entry — one per (station, song_id) transition observed by
// the listener. capped at MAX_RADIO_HISTORY rows by radioHistory module.
export interface RadioHistoryEntry {
  id: string;                       // uuid
  played_at: number;                // ms epoch (sort key)
  station_id: string | null;
  station_name: string | null;
  peer_addr: string;                // remote that served the stream
  song_id: string | null;
  title: string;
  artist: string | null;
  album: string | null;
  duration_ms: number | null;
  art_blob_id: string | null;
  art_thumb_b64: string | null;     // optional inline thumb (option A)
  art_thumb_mime: string | null;
}

// pending remote stage - tracks progress of adding a new remote
export type PendingRemoteStage =
  | "testing"         // connection test in progress
  | "connected"       // test connection succeeded, have server info
  | "failed"          // connection failed (timeout, unreachable, etc.)
  | "knock_pending"   // knock request was sent, awaiting response
  | "knock_accepted"  // knock was accepted, can complete setup
  | "knock_rejected"; // knock was rejected

// pending remote — tracks in-progress remote additions
export interface PendingRemote {
  id: string; // uuid
  peer_addr: string; // node_id or http url
  transport: "http" | "wasm" | "app";
  stage: PendingRemoteStage;
  created_at: number;
  updated_at: number;
  // server info (from /api/hello)
  server_name: string | null;
  server_description: string | null;
  server_version: string | null;
  // cached server image (base64 encoded)
  server_image_data: string | null;
  server_image_type: string | null;
  // knock info (optional, only if knock was sent)
  knock_username: string | null;
  knock_message: string | null;
  // error info (optional, only if stage is "failed")
  error_message: string | null;
}
