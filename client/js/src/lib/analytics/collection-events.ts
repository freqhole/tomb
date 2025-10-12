/**
 * Collection analytics event builder
 *
 * Provides event creation utilities for tracking collection-level plays
 * (albums, playlists, artists, genres) separate from individual song analytics.
 */

import type { MediaEventRequest } from "./analytics-client";
import { trackEvent, getSessionClientId } from "./event-buffer";

// Collection play event data
export interface CollectionPlayEventData {
  total_songs: number;
  shuffle_enabled: boolean;
  play_source: "play_all" | "shuffle_all" | "continue_playing";
  first_song_id?: string;
  collection_name?: string;
}

// Collection context for event creation
interface CollectionEventContext {
  domainType: "album" | "playlist" | "artist" | "genre";
  domainIds: string[];
  sessionId?: string;
}

/**
 * Builder for collection-level analytics events
 */
export class CollectionEventBuilder {
  private context: CollectionEventContext;

  constructor(context: CollectionEventContext) {
    this.context = context;
  }

  /**
   * Create a collection play event
   */
  playCollection(eventData: CollectionPlayEventData): MediaEventRequest {
    return {
      media_blob_id: eventData.first_song_id || null,
      event_type: "play",
      event_data: eventData,
      session_id: this.context.sessionId,
      domain_type: this.context.domainType,
      domain_ids: this.context.domainIds,
      client_id: getSessionClientId(),
    };
  }

  /**
   * Static helper for quick collection play event creation
   */
  static createPlayEvent(
    domainType: "album" | "playlist" | "artist" | "genre",
    domainIds: string[],
    eventData: CollectionPlayEventData,
    sessionId?: string
  ): MediaEventRequest {
    const builder = new CollectionEventBuilder({
      domainType,
      domainIds,
      sessionId,
    });
    return builder.playCollection(eventData);
  }

  /**
   * Create album play event
   */
  static playAlbum(
    songIds: string[],
    albumName: string,
    totalSongs: number,
    shuffleEnabled: boolean = false,
    sessionId?: string,
    firstSongId?: string
  ): MediaEventRequest {
    return CollectionEventBuilder.createPlayEvent(
      "album",
      songIds,
      {
        total_songs: totalSongs,
        shuffle_enabled: shuffleEnabled,
        play_source: shuffleEnabled ? "shuffle_all" : "play_all",
        first_song_id: firstSongId,
        collection_name: albumName,
      },
      sessionId
    );
  }

  /**
   * Create artist play event
   */
  static playArtist(
    songIds: string[],
    artistName: string,
    totalSongs: number,
    shuffleEnabled: boolean = false,
    sessionId?: string,
    firstSongId?: string
  ): MediaEventRequest {
    return CollectionEventBuilder.createPlayEvent(
      "artist",
      songIds,
      {
        total_songs: totalSongs,
        shuffle_enabled: shuffleEnabled,
        play_source: shuffleEnabled ? "shuffle_all" : "play_all",
        first_song_id: firstSongId,
        collection_name: artistName,
      },
      sessionId
    );
  }

  /**
   * Create genre play event
   */
  static playGenre(
    songIds: string[],
    genreName: string,
    totalSongs: number,
    shuffleEnabled: boolean = false,
    sessionId?: string,
    firstSongId?: string
  ): MediaEventRequest {
    return CollectionEventBuilder.createPlayEvent(
      "genre",
      songIds,
      {
        total_songs: totalSongs,
        shuffle_enabled: shuffleEnabled,
        play_source: shuffleEnabled ? "shuffle_all" : "play_all",
        first_song_id: firstSongId,
        collection_name: genreName,
      },
      sessionId
    );
  }

  /**
   * Create playlist play event
   */
  static playPlaylist(
    songIds: string[],
    playlistName: string,
    totalSongs: number,
    shuffleEnabled: boolean = false,
    sessionId?: string,
    firstSongId?: string
  ): MediaEventRequest {
    return CollectionEventBuilder.createPlayEvent(
      "playlist",
      songIds,
      {
        total_songs: totalSongs,
        shuffle_enabled: shuffleEnabled,
        play_source: shuffleEnabled ? "shuffle_all" : "play_all",
        first_song_id: firstSongId,
        collection_name: playlistName,
      },
      sessionId
    );
  }
}

// Collection play tracking utilities
export interface CollectionPlaySession {
  domainType: "album" | "playlist" | "artist" | "genre";
  domainId: string;
  sessionId: string;
  startTime: number;
  totalSongs: number;
  shuffleEnabled: boolean;
  hasEmittedEvent: boolean;
}

/**
 * Tracks active collection play sessions to avoid duplicate events
 */
export class CollectionPlayTracker {
  private activeSessions = new Map<string, CollectionPlaySession>();

  /**
   * Start tracking a collection play session
   */
  startSession(
    domainType: "album" | "playlist" | "artist" | "genre",
    domainId: string,
    sessionId: string,
    totalSongs: number,
    shuffleEnabled: boolean = false
  ): CollectionPlaySession {
    const key = `${sessionId}:${domainType}:${domainId}`;

    const session: CollectionPlaySession = {
      domainType,
      domainId,
      sessionId,
      startTime: Date.now(),
      totalSongs,
      shuffleEnabled,
      hasEmittedEvent: false,
    };

    this.activeSessions.set(key, session);
    return session;
  }

  /**
   * Get active session for a collection
   */
  getSession(
    domainType: "album" | "playlist" | "artist" | "genre",
    domainId: string,
    sessionId: string
  ): CollectionPlaySession | null {
    const key = `${sessionId}:${domainType}:${domainId}`;
    return this.activeSessions.get(key) || null;
  }

  /**
   * Mark session as having emitted play event
   */
  markEventEmitted(
    domainType: "album" | "playlist" | "artist" | "genre",
    domainId: string,
    sessionId: string
  ): void {
    const session = this.getSession(domainType, domainId, sessionId);
    if (session) {
      session.hasEmittedEvent = true;
    }
  }

  /**
   * Check if session has already emitted event
   */
  hasEmittedEvent(
    domainType: "album" | "playlist" | "artist" | "genre",
    domainId: string,
    sessionId: string
  ): boolean {
    const session = this.getSession(domainType, domainId, sessionId);
    return session?.hasEmittedEvent || false;
  }

  /**
   * End and clean up a session
   */
  endSession(
    domainType: "album" | "playlist" | "artist" | "genre",
    domainId: string,
    sessionId: string
  ): void {
    const key = `${sessionId}:${domainType}:${domainId}`;
    this.activeSessions.delete(key);
  }

  /**
   * Clean up old sessions (call periodically)
   */
  cleanupOldSessions(maxAgeMs: number = 60 * 60 * 1000): void {
    const now = Date.now();

    for (const [key, session] of this.activeSessions.entries()) {
      if (now - session.startTime > maxAgeMs) {
        this.activeSessions.delete(key);
      }
    }
  }

  /**
   * Get all active sessions (for debugging)
   */
  getActiveSessions(): CollectionPlaySession[] {
    return Array.from(this.activeSessions.values());
  }
}

// Export default instance
export const collectionPlayTracker = new CollectionPlayTracker();

// Helper function to track collection play events
export function trackCollectionPlay(
  domainType: "album" | "playlist" | "artist" | "genre",
  songIds: string[],
  collectionName: string,
  totalSongs: number,
  shuffleEnabled: boolean = false,
  sessionId?: string,
  firstSongId?: string
): void {
  const event = CollectionEventBuilder.createPlayEvent(
    domainType,
    songIds,
    {
      total_songs: totalSongs,
      shuffle_enabled: shuffleEnabled,
      play_source: shuffleEnabled ? "shuffle_all" : "play_all",
      first_song_id: firstSongId,
      collection_name: collectionName,
    },
    sessionId
  );

  trackEvent(event);
}
