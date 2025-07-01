//! Zod schemas for sync API types and validation
//!
//! This module provides comprehensive Zod schemas for all sync-related API types,
//! ensuring type safety and runtime validation for the sync engine.
//! These schemas mirror the Rust server-side types to maintain consistency.

import { z } from "zod";
import {
  MediaBlobSchema,
  SongSchema,
  PlaylistSchema,
  PlaylistSongSchema,
} from "../lib/websocket-types.js";
import {
  SyncStatusSchema,
  ConflictResolution,
  SyncConflictType,
  SyncPriority,
} from "./sync-constants.js";

// Base schemas
const UuidSchema = z.string().uuid();
const ItemIdSchema = z.string().min(7); // Can be either UUID or short hash
const DateTimeSchema = z.string().datetime();
const PositiveIntSchema = z.number().int().positive();
const NonNegativeIntSchema = z.number().int().min(0);

/**
 * Sync request parameters for incremental synchronization
 */
export const SyncRequestSchema = z.object({
  /** Last sync timestamp - only get items modified after this time */
  last_sync_time: DateTimeSchema.optional(),
  /** Pagination cursor for continuing a large sync operation */
  cursor: z.string().optional(),
  /** Maximum number of items to return in this sync batch */
  page_size: PositiveIntSchema.max(1000).default(50),
  /** Client ID for tracking sync state per client */
  client_id: UuidSchema,
  /** Whether to include binary data or just metadata */
  include_data: z.boolean().default(false),
  /** Filter by specific MIME types */
  mime_types: z.array(z.string()).optional(),
});

export type SyncRequest = z.infer<typeof SyncRequestSchema>;

/**
 * Pagination metadata specific to sync operations
 */
export const SyncPaginationMetadataSchema = z.object({
  /** Number of items in this batch */
  batch_size: NonNegativeIntSchema,
  /** Whether there are more items to sync */
  has_more: z.boolean(),
  /** Cursor for the next batch of sync items */
  next_cursor: z.string().nullable().optional(),
  /** Estimated progress (0.0 to 1.0) if calculable */
  progress: z.number().min(0).max(1).nullable().optional(),
  /** Suggested delay before next sync request (in seconds) */
  suggested_delay: PositiveIntSchema.optional(),
});

export type SyncPaginationMetadata = z.infer<
  typeof SyncPaginationMetadataSchema
>;

/**
 * Sync response containing incremental updates
 */
export const SyncResponseSchema = z.object({
  /** Media blobs that have been added or modified since last sync */
  items: z.array(MediaBlobSchema),
  /** Pagination metadata for continuing the sync */
  pagination: SyncPaginationMetadataSchema,
  /** Server timestamp when this sync response was generated */
  sync_timestamp: DateTimeSchema,
  /** Whether this is a full sync (true) or incremental (false) */
  is_full_sync: z.boolean(),
  /** Total number of items available for sync (if known) */
  total_items: NonNegativeIntSchema.nullable().optional(),
});

export type SyncResponse = z.infer<typeof SyncResponseSchema>;

/**
 * Song sync request parameters
 */
export const SongSyncRequestSchema = z.object({
  /** Last sync timestamp - only get items modified after this time */
  last_sync_time: DateTimeSchema.optional(),
  /** Pagination cursor for continuing a large sync operation */
  cursor: z.string().optional(),
  /** Maximum number of items to return in this sync batch */
  page_size: PositiveIntSchema.max(1000).default(50),
  /** Client ID for tracking sync state per client */
  client_id: UuidSchema,
  /** Filter by artist */
  artist: z.string().optional(),
  /** Filter by album */
  album: z.string().optional(),
  /** Only include favorites */
  favorites_only: z.boolean().optional(),
});

export type SongSyncRequest = z.infer<typeof SongSyncRequestSchema>;

/**
 * Song sync response containing incremental updates
 */
export const SongSyncResponseSchema = z.object({
  /** Songs that have been added or modified since last sync */
  songs: z.array(SongSchema),
  /** Whether there are more items to sync */
  has_more: z.boolean(),
  /** Cursor for the next batch of sync items */
  next_cursor: z.string().nullable(),
  /** Total number of items available for sync */
  total_count: NonNegativeIntSchema,
});

export type SongSyncResponse = z.infer<typeof SongSyncResponseSchema>;

/**
 * Playlist sync request parameters
 */
export const PlaylistSyncRequestSchema = z.object({
  /** Last sync timestamp - only get items modified after this time */
  last_sync_time: DateTimeSchema.optional(),
  /** Pagination cursor for continuing a large sync operation */
  cursor: z.string().optional(),
  /** Maximum number of items to return in this sync batch */
  page_size: PositiveIntSchema.max(1000).default(50),
  /** Client ID for tracking sync state per client */
  client_id: UuidSchema,
  /** Only include public playlists */
  public_only: z.boolean().optional(),
});

export type PlaylistSyncRequest = z.infer<typeof PlaylistSyncRequestSchema>;

/**
 * Playlist sync response containing incremental updates
 */
export const PlaylistSyncResponseSchema = z.object({
  /** Playlists that have been added or modified since last sync */
  playlists: z.array(PlaylistSchema),
  /** Whether there are more items to sync */
  has_more: z.boolean(),
  /** Cursor for the next batch of sync items */
  next_cursor: z.string().nullable(),
  /** Total number of items available for sync */
  total_count: NonNegativeIntSchema,
});

export type PlaylistSyncResponse = z.infer<typeof PlaylistSyncResponseSchema>;

/**
 * PlaylistSong sync request parameters
 */
export const PlaylistSongSyncRequestSchema = z.object({
  /** Last sync timestamp - only get items modified after this time */
  last_sync_time: DateTimeSchema.optional(),
  /** Pagination cursor for continuing a large sync operation */
  cursor: z.string().optional(),
  /** Maximum number of items to return in this sync batch */
  page_size: PositiveIntSchema.max(1000).default(50),
  /** Client ID for tracking sync state per client */
  client_id: UuidSchema,
  /** Filter by playlist ID */
  playlist_id: UuidSchema.optional(),
});

export type PlaylistSongSyncRequest = z.infer<
  typeof PlaylistSongSyncRequestSchema
>;

/**
 * PlaylistSong sync response containing incremental updates
 */
export const PlaylistSongSyncResponseSchema = z.object({
  /** PlaylistSongs that have been added or modified since last sync */
  playlist_songs: z.array(PlaylistSongSchema),
  /** Playlist ID these songs belong to */
  playlist_id: UuidSchema,
  /** Whether there are more items to sync */
  has_more: z.boolean(),
  /** Cursor for the next batch of sync items */
  next_cursor: z.string().nullable(),
  /** Total number of items available for sync */
  total_count: NonNegativeIntSchema,
});

export type PlaylistSongSyncResponse = z.infer<
  typeof PlaylistSongSyncResponseSchema
>;

/**
 * Synchronization status - re-export from constants
 */
export { SyncStatusSchema as SyncStatusEnum } from "./sync-constants.js";

/**
 * Client synchronization state
 */
export const ClientSyncStateSchema = z.object({
  /** Client identifier */
  client_id: UuidSchema,
  /** Last successful sync timestamp */
  last_sync_time: DateTimeSchema,
  /** Total number of items synced by this client */
  total_items_synced: NonNegativeIntSchema,
  /** Current sync status */
  status: SyncStatusSchema,
  /** Last sync cursor position (for resuming interrupted syncs) */
  last_cursor: z.string().nullable().optional(),
  /** Timestamp when this state was last updated */
  updated_at: DateTimeSchema,
});

export type ClientSyncState = z.infer<typeof ClientSyncStateSchema>;

/**
 * Sync acknowledgment to confirm successful client sync
 */
export const SyncAcknowledgmentSchema = z.object({
  /** Client ID acknowledging the sync */
  client_id: UuidSchema,
  /** Timestamp of the sync that was successfully processed */
  sync_timestamp: DateTimeSchema,
  /** Number of items successfully synced */
  items_synced: NonNegativeIntSchema,
  /** Any items that failed to sync (by ID) */
  failed_items: z.array(ItemIdSchema).default([]),
  /** Client's current sync state */
  client_sync_state: ClientSyncStateSchema,
});

export type SyncAcknowledgment = z.infer<typeof SyncAcknowledgmentSchema>;

/**
 * Server synchronization capabilities
 */
export const SyncCapabilitiesSchema = z.object({
  /** Maximum batch size supported */
  max_batch_size: PositiveIntSchema,
  /** Minimum sync interval in seconds */
  min_sync_interval: PositiveIntSchema,
  /** Supported MIME type filters */
  supported_mime_filters: z.array(z.string()),
  /** Whether incremental sync is supported */
  supports_incremental: z.boolean(),
  /** Whether cursor-based pagination is supported */
  supports_cursors: z.boolean(),
  /** Maximum client sync history retained (in days) */
  sync_history_retention_days: PositiveIntSchema,
});

export type SyncCapabilities = z.infer<typeof SyncCapabilitiesSchema>;

/**
 * Sync status response for monitoring sync health
 */
export const SyncStatusResponseSchema = z.object({
  /** Current server timestamp */
  server_time: DateTimeSchema,
  /** Number of active sync sessions */
  active_syncs: NonNegativeIntSchema,
  /** Total items available for sync */
  total_items: NonNegativeIntSchema,
  /** Last modification time in the system */
  last_modification: DateTimeSchema.nullable().optional(),
  /** Server sync capabilities */
  capabilities: SyncCapabilitiesSchema,
});

export type SyncStatusResponse = z.infer<typeof SyncStatusResponseSchema>;

/**
 * Full sync request for initial synchronization
 */
export const FullSyncRequestSchema = z.object({
  /** Client ID requesting full sync */
  client_id: UuidSchema,
  /** Batch size for paginated full sync */
  batch_size: PositiveIntSchema.max(1000).default(100),
  /** Starting cursor (for resuming interrupted full sync) */
  start_cursor: z.string().optional(),
  /** Whether to include binary data */
  include_data: z.boolean().default(false),
  /** Filter by MIME types */
  mime_types: z.array(z.string()).optional(),
});

export type FullSyncRequest = z.infer<typeof FullSyncRequestSchema>;

/**
 * Sync progress information for UI updates
 */
export const SyncProgressSchema = z.object({
  /** Current sync status */
  status: SyncStatusSchema,
  /** Items synced in current session */
  items_synced: NonNegativeIntSchema,
  /** Total items to sync (if known) */
  total_items: NonNegativeIntSchema.nullable().optional(),
  /** Progress percentage (0-100) */
  progress: z.number().min(0).max(100).nullable().optional(),
  /** Current sync cursor */
  current_cursor: z.string().nullable().optional(),
  /** Estimated time remaining in seconds */
  estimated_remaining_seconds: PositiveIntSchema.optional(),
  /** Current batch being processed */
  current_batch: PositiveIntSchema.optional(),
  /** Total batches (if known) */
  total_batches: PositiveIntSchema.optional(),
});

export type SyncProgress = z.infer<typeof SyncProgressSchema>;

/**
 * Sync error information
 */
export const SyncErrorSchema = z.object({
  /** Error type/code */
  type: z.string(),
  /** Human-readable error message */
  message: z.string().min(1),
  /** Timestamp when error occurred */
  timestamp: DateTimeSchema,
  /** Additional error context */
  context: z.record(z.any()).optional(),
  /** Whether this error is recoverable */
  recoverable: z.boolean().default(true),
  /** Suggested retry delay in seconds */
  retry_delay: PositiveIntSchema.optional(),
});

export type SyncError = z.infer<typeof SyncErrorSchema>;

/**
 * Sync conflict information
 */
export const SyncConflictSchema = z.object({
  /** Unique identifier for this conflict */
  id: UuidSchema,
  /** ID of the item in conflict (UUID for songs/playlists, short hash for media blobs) */
  item_id: ItemIdSchema,
  /** Type of item in conflict */
  item_type: z.enum(["media_blob", "song", "playlist", "playlist_song"]),
  /** Type of conflict */
  type: z.enum([
    SyncConflictType.Version,
    SyncConflictType.Deletion,
    SyncConflictType.Metadata,
  ]),
  /** Local version of the item */
  local_version: z.union([
    MediaBlobSchema,
    SongSchema,
    PlaylistSchema,
    PlaylistSongSchema,
  ]),
  /** Server version of the item */
  server_version: z.union([
    MediaBlobSchema,
    SongSchema,
    PlaylistSchema,
    PlaylistSongSchema,
  ]),
  /** Timestamp when conflict was detected */
  detected_at: DateTimeSchema,
  /** Whether conflict has been resolved */
  resolved: z.boolean().default(false),
  /** Resolution strategy if resolved */
  resolution: z
    .enum([
      ConflictResolution.LocalWins,
      ConflictResolution.RemoteWins,
      ConflictResolution.Merge,
      ConflictResolution.Skip,
    ])
    .optional(),
});

export type SyncConflict = z.infer<typeof SyncConflictSchema>;

/**
 * Sync recommendations response
 */
export const SyncRecommendationsResponseSchema = z.object({
  should_sync: z.boolean(),
  recommended_batch_size: PositiveIntSchema,
  recommended_interval_seconds: PositiveIntSchema,
  estimated_batches: NonNegativeIntSchema,
  estimated_duration_seconds: NonNegativeIntSchema,
  priority: z.enum([
    SyncPriority.Low,
    SyncPriority.Normal,
    SyncPriority.High,
    SyncPriority.Urgent,
  ]),
  items_to_sync: NonNegativeIntSchema,
});

export type SyncRecommendationsResponse = z.infer<
  typeof SyncRecommendationsResponseSchema
>;

/**
 * Query parameters for incremental sync API
 */
export const IncrementalSyncQuerySchema = z.object({
  last_sync_time: z.string().optional(),
  cursor: z.string().optional(),
  page_size: z.coerce.number().int().positive().max(1000).default(50),
  include_data: z.coerce.boolean().default(false),
  mime_types: z.string().optional(), // Comma-separated string that gets parsed
});

export type IncrementalSyncQuery = z.infer<typeof IncrementalSyncQuerySchema>;

/**
 * Query parameters for full sync API
 */
export const FullSyncQuerySchema = z.object({
  batch_size: z.coerce.number().int().positive().max(1000).default(100),
  start_cursor: z.string().optional(),
  include_data: z.coerce.boolean().default(false),
  mime_types: z.string().optional(), // Comma-separated string that gets parsed
});

export type FullSyncQuery = z.infer<typeof FullSyncQuerySchema>;

/**
 * Sync acknowledgment request body
 */
export const SyncAckRequestSchema = z.object({
  sync_timestamp: DateTimeSchema,
  items_synced: NonNegativeIntSchema,
  failed_items: z.array(ItemIdSchema).default([]),
});

export type SyncAckRequest = z.infer<typeof SyncAckRequestSchema>;

/**
 * Configuration for sync manager
 */
export const SyncConfigSchema = z.object({
  /** API base URL */
  apiBaseUrl: z.string().url(),
  /** Authentication token */
  authToken: z.string().min(1),
  /** Client identifier */
  clientId: UuidSchema,
  /** Default batch size */
  batchSize: PositiveIntSchema.max(1000).default(50),
  /** Maximum retry attempts */
  maxRetryAttempts: z.number().int().min(0).max(10).default(3),
  /** Base retry delay in milliseconds */
  retryDelay: PositiveIntSchema.default(1000),
  /** Include binary data by default */
  includeBinaryData: z.boolean().default(false),
  /** Conflict resolution strategy */
  conflictResolution: z
    .enum([
      ConflictResolution.Manual,
      ConflictResolution.LocalWins,
      ConflictResolution.RemoteWins,
    ])
    .default(ConflictResolution.Manual),
  /** Enable local storage */
  enableStorage: z.boolean().default(true),
  /** Maximum storage size in bytes */
  maxStorageSize: PositiveIntSchema.default(100 * 1024 * 1024), // 100MB
  /** Maximum cache age in days */
  maxCacheAge: PositiveIntSchema.default(30),
});

export type SyncConfig = z.infer<typeof SyncConfigSchema>;

/**
 * Safe parsing utilities for sync API responses
 */
export const safeParseSyncResponse = (data: unknown) => {
  return SyncResponseSchema.safeParse(data);
};

export const safeParseSyncStatus = (data: unknown) => {
  return SyncStatusResponseSchema.safeParse(data);
};

export const safeParseSyncRecommendations = (data: unknown) => {
  return SyncRecommendationsResponseSchema.safeParse(data);
};

export const safeParseSongSyncResponse = (data: unknown) => {
  return SongSyncResponseSchema.safeParse(data);
};

export const safeParsePlaylistSyncResponse = (data: unknown) => {
  return PlaylistSyncResponseSchema.safeParse(data);
};

export const safeParsePlaylistSongSyncResponse = (data: unknown) => {
  return PlaylistSongSyncResponseSchema.safeParse(data);
};

/**
 * Validation helpers for sync operations
 */
export const validateSyncRequest = (request: unknown): SyncRequest => {
  return SyncRequestSchema.parse(request);
};

export const validateSyncConfig = (config: unknown): SyncConfig => {
  return SyncConfigSchema.parse(config);
};

export const validateSyncProgress = (progress: unknown): SyncProgress => {
  return SyncProgressSchema.parse(progress);
};

/**
 * Type guards for sync events
 */
export const isSyncError = (obj: unknown): obj is SyncError => {
  return SyncErrorSchema.safeParse(obj).success;
};

export const isSyncConflict = (obj: unknown): obj is SyncConflict => {
  return SyncConflictSchema.safeParse(obj).success;
};

export const isSyncProgress = (obj: unknown): obj is SyncProgress => {
  return SyncProgressSchema.safeParse(obj).success;
};
