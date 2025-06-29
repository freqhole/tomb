//! Music sync event emitter base class
//!
//! This module provides a simplified event emitter specifically for music sync
//! operations that doesn't conflict with the existing sync event system.

import { SyncStatus } from "./sync-constants.js";

/**
 * Generic event listener type
 */
export type MusicSyncEventListener<T = any> = (data: T) => void;

/**
 * Base event emitter for music sync operations
 *
 * This is a simplified version that avoids conflicts with the existing
 * SyncEventEmitter which is designed for a different event signature.
 */
export class MusicSyncEventEmitter {
  private listeners: Map<string, Set<MusicSyncEventListener>> = new Map();

  /**
   * Add an event listener
   */
  on<T = any>(event: string, listener: MusicSyncEventListener<T>): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
  }

  /**
   * Remove an event listener
   */
  off<T = any>(event: string, listener: MusicSyncEventListener<T>): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.delete(listener);
      if (eventListeners.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  /**
   * Add a one-time event listener
   */
  once<T = any>(event: string, listener: MusicSyncEventListener<T>): void {
    const onceWrapper = (data: T) => {
      this.off(event, onceWrapper);
      listener(data);
    };
    this.on(event, onceWrapper);
  }

  /**
   * Emit an event
   */
  protected emit<T = any>(event: string, data?: T): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      for (const listener of eventListeners) {
        try {
          listener(data);
        } catch (error) {
          console.error(`Error in event listener for "${event}":`, error);
        }
      }
    }
  }

  /**
   * Remove all listeners for an event, or all listeners if no event specified
   */
  removeAllListeners(event?: string): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  /**
   * Get the number of listeners for an event
   */
  listenerCount(event: string): number {
    return this.listeners.get(event)?.size || 0;
  }

  /**
   * Get all event names that have listeners
   */
  eventNames(): string[] {
    return Array.from(this.listeners.keys());
  }
}

/**
 * Common event data structures for music sync events
 */

export interface MusicSyncProgressData {
  progress: {
    status: SyncStatus;
    items_synced: number;
    total_items?: number;
    progress?: number;
    current_cursor?: string;
    estimated_remaining_seconds?: number;
    current_batch?: number;
    total_batches?: number;
  };
}

export interface MusicSyncErrorData {
  error: {
    type: string;
    message: string;
    timestamp: string;
    recoverable: boolean;
    retry_delay?: number;
  };
}

export interface MusicSyncConflictData {
  conflict: {
    id: string;
    item_id: string;
    item_type: "song" | "playlist" | "playlist_song" | "media_blob";
    type: "version" | "deletion" | "metadata";
    local_version: any;
    server_version: any;
    detected_at: string;
    resolved: boolean;
  };
}

export interface MusicSyncConnectionData {
  connected: boolean;
  reconnectAttempts?: number;
}

export interface MusicSyncStatusChangeData {
  status: SyncStatus;
  previousStatus: SyncStatus;
  timestamp: string;
}

export interface MusicSyncInitializedData {
  success: boolean;
  timestamp?: string;
}

export interface MusicSyncPausedResumedData {
  timestamp: string;
}

export interface MusicSyncConflictResolvedData {
  conflictId: string;
  resolution: string;
  resolvedItem: any;
}

export interface SongsSyncedData {
  songs: any[];
}

export interface PlaylistsSyncedData {
  playlists: any[];
}

export interface PlaylistSongsSyncedData {
  playlistSongs: any[];
}

export interface MediaBlobsSyncedData {
  items: any[];
}

export interface PlaylistCreatedData {
  playlist: any;
}

export interface PlaylistUpdatedData {
  playlist: any;
}

export interface PlaylistDeletedData {
  playlistId: string;
}

export interface SongAddedToPlaylistData {
  playlistSong: any;
}

export interface SongRemovedFromPlaylistData {
  playlistSongId: string;
}

export interface SongPositionUpdatedData {
  playlistSongId: string;
  newPosition: number;
}

export interface PlaylistReorderedData {
  playlistId: string;
  songIds: string[];
}

export interface SyncCompletedData {
  progress: any;
  stats: any;
}

export interface CleanupCompletedData {
  timestamp: string;
  stats: any;
}

export interface AutoSyncFailedData {
  error: string;
  timestamp: string;
}

/**
 * Type-safe event name constants
 */
export const MusicSyncEvents = {
  // Common events
  INITIALIZED: "initialized",
  ERROR: "error",
  PROGRESS: "progress",
  STATUS_CHANGED: "status_changed",
  CONFLICT: "conflict",
  CONFLICT_RESOLVED: "conflict_resolved",
  CONNECTION: "connection",
  PAUSED: "paused",
  RESUMED: "resumed",

  // Entity sync events
  SONGS_SYNCED: "songs_synced",
  PLAYLISTS_SYNCED: "playlists_synced",
  PLAYLIST_SONGS_SYNCED: "playlist_songs_synced",
  MEDIA_BLOBS_SYNCED: "media_blobs_synced",

  // Music manager specific events
  SYNC_COMPLETED: "sync_completed",
  CLEANUP_COMPLETED: "cleanup_completed",
  AUTO_SYNC_FAILED: "auto_sync_failed",

  // Playlist management events
  PLAYLIST_CREATED: "playlist_created",
  PLAYLIST_UPDATED: "playlist_updated",
  PLAYLIST_DELETED: "playlist_deleted",

  // Playlist song management events
  SONG_ADDED_TO_PLAYLIST: "song_added_to_playlist",
  SONG_REMOVED_FROM_PLAYLIST: "song_removed_from_playlist",
  SONG_POSITION_UPDATED: "song_position_updated",
  PLAYLIST_REORDERED: "playlist_reordered",
} as const;

export type MusicSyncEventName = typeof MusicSyncEvents[keyof typeof MusicSyncEvents];

/**
 * Helper function to create type-safe event emitters
 */
export function createMusicSyncEventEmitter(): MusicSyncEventEmitter {
  return new MusicSyncEventEmitter();
}
