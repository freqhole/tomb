// application-level storage types (domain-agnostic)
import type { ImageMetadata, Song } from "../../../music/services/storage/types";
import type { MediaItem, QueuedVideo } from "./mediaItem";

export interface AppState {
  id: "app_state";
  current_sha256: string | null; // currently playing song/video identity key
  queue: MediaItem[]; // array of songs/videos in play order
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
  // currently tuned radio station (for resume on page reload)
  current_radio_station?: RadioStationRef | null;
  // user-configurable display name for the web/indexeddb-backed "local
  // library" source. defaults to "local library" when unset.
  local_library_name?: string;
  // when true (default), video grid/table thumbnails crop to a square via
  // object-fit: cover. when false, they letterbox (object-fit: contain)
  // instead so nothing is cropped.
  cropped_square_thumbnails?: boolean;
}

/** graph-view preferences — stored as id: "graph_prefs" in STORE_APP_STATE. */
export interface GraphPrefs {
  id: "graph_prefs";
  /** when false, the explore graph shows all remote hubs but only fans
   *  out album/artist data for the single remote the user clicks next.
   *  clicking the root node resets focus. defaults to true. */
  multi_remote_mode: boolean;
}

// queue history entry — represents one "add to queue" action
export type QueueHistorySourceType =
  "song" | "album" | "artist" | "genre" | "playlist" | "shuffle" | "radio_station";

// reference to a radio station stored in queue history
export interface RadioStationRef {
  peer_addr: string; // peer addr used with tuneIntoRadio
  station_id?: string; // optional station id
  station_name: string; // display label
  is_local?: boolean; // true if this is an in-process (self) station
  art_thumb_b64?: string; // base64 thumbnail for display
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
  "play_complete" | "video_play_complete" | "favorite" | "unfavorite" | "rate";

export type AnalyticsEventStatus = "pending" | "sending" | "failed" | "sent";

export interface AnalyticsEvent {
  id: string; // uuid
  type: AnalyticsEventType;
  payload: {
    media_blob_id?: string;
    song_id?: string;
    video_id?: string;
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

// --- video queue history (parallel to the song history above) ---
// kept as fully separate types/store from QueueHistoryEntry, which stays
// song-only by design (see music/services/queue/queueHistory.ts). server
// session linkage mirrors the song side (phase 5c of
// docs/playlist-unification-plan.md) — see
// video/services/queue/videoQueueHistory.ts's
// updateVideoHistoryServerSession/clearVideoHistoryServerSession.
export type VideoQueueHistorySourceType = "video" | "series" | "season" | "shuffle" | "playlist";

// source context passed to addVideoHistoryEntry/playVideoQueue for history tracking
export interface VideoQueueSourceContext {
  type: VideoQueueHistorySourceType;
  label: string;
  entity_id?: string; // series_id/season_id
  image?: ImageMetadata;
}

export interface VideoQueueHistoryEntry {
  id: string; // uuid
  type: VideoQueueHistorySourceType;
  label: string; // display text, e.g. a video/series title
  entity_id?: string; // series_id/season_id
  remote_name?: string; // name of the remote server (undefined for local)
  video_count: number; // how many videos were added
  videos: QueuedVideo[]; // the actual videos (for re-queuing)
  queued_at: number; // timestamp
  image?: ImageMetadata; // thumbnail, when available
  // local watch-progress tracking (idb-only)
  watched_seconds: number; // total seconds watched across all videos
  total_seconds: number; // sum of all video durations
  videos_completed: number; // videos where >90% was watched
  current_video_index: number; // which video we're on (for resume)
  current_video_position: number; // position in current video (for resume)
  // server session tracking (for reconnection after page reload) — mirrors
  // QueueHistoryEntry's fields above
  server_session_id?: string; // active server-side playback session id
  server_remote_id?: string; // remote_server_id the session is on
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

// P2P identity - secret_key/node_id/created_at, persisted in app_state store
// with an id: "p2p_identity" tag added at the storage boundary (see
// getP2PIdentity/saveP2PIdentity in db.ts).
export type { P2PIdentity } from "@freqhole/haruspex/identity";

// database schema version
export const APP_DB_NAME = "freqhole_app";
export const APP_DB_VERSION = 10; // added paired_players store

// app store names
export const STORE_APP_STATE = "app_state"; // also stores P2PIdentity with id: "p2p_identity"
export const STORE_REMOTES = "remotes";
export const STORE_QUEUE_HISTORY = "queue_history";
export const STORE_ANALYTICS_EVENTS = "analytics_events";
export const STORE_PENDING_REMOTES = "pending_remotes";
export const STORE_RADIO_HISTORY = "radio_history";
export const STORE_SHARED_ITEMS = "shared_items";
export const STORE_VIDEO_QUEUE_HISTORY = "video_queue_history"; // capped at 200 entries by videoQueueHistory.ts
export const STORE_PAIRED_PLAYERS = "paired_players";

export type SharedItemKind =
  "album" | "playlist" | "song" | "artist" | "radio_station" | "video" | "video_series";

export interface SharedItemEntry {
  // deterministic dedupe key from (kind, id, parent, source)
  id: string;
  // canonical base64url token for reopening the share
  token: string;
  kind: SharedItemKind;
  entity_id: string;
  parent_id?: string;
  title?: string;
  source_node_id?: string;
  source_http_origin?: string;
  first_seen_at: number;
  last_seen_at: number;
  seen_count: number;
}

// a paired freqhole-player device (a `player.freqhole.net`-style p2p
// playback target), NOT a `Remote` - a paired player has no HTTP/admin api
// surface, so it's kept out of the Remote discriminated union entirely
// (see docs/player-remote-site-plan.md phase 5 for the rationale).
export interface PairedPlayer {
  node_id: string;
  display_name: string;
  paired_at: number;
  last_used_at: number | null;
}

// radio history entry — one per (station, song_id) transition observed by
// the listener. capped at MAX_RADIO_HISTORY rows by radioHistory module.
export interface RadioHistoryEntry {
  id: string; // uuid
  played_at: number; // ms epoch (sort key)
  station_id: string | null;
  station_name: string | null;
  peer_addr: string; // remote that served the stream
  song_id: string | null;
  title: string;
  artist: string | null;
  album: string | null;
  duration_ms: number | null;
  art_blob_id: string | null;
  art_thumb_b64: string | null; // optional inline thumb (option A)
  art_thumb_mime: string | null;
}

// pending remote stage - tracks progress of adding a new remote
export type PendingRemoteStage =
  | "testing" // connection test in progress
  | "connected" // test connection succeeded, have server info
  | "failed" // connection failed (timeout, unreachable, etc.)
  | "knock_pending" // knock request was sent, awaiting response
  | "knock_accepted" // knock was accepted, can complete setup
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
