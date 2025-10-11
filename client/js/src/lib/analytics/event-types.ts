/**
 * TypeScript event types for analytics
 *
 * Provides type definitions for analytics events, extending the client schemas
 * with additional utility types and interfaces for the music player integration.
 */

import type { MediaEventType, MediaEventRequest } from "./analytics-client";

// Music-specific event data types
export interface PlayEventData {
  position: string;
  progress?: number;
  quality?: string;
}

export interface SeekEventData {
  from_position: string;
  to_position: string;
  seek_distance: number;
}

export interface RatingEventData {
  rating: number;
  previous_rating?: number;
}

export interface VolumeEventData {
  volume: number;
  previous_volume?: number;
}

// Event creation helpers with proper typing
export interface MusicEventContext {
  mediaBlobId: string;
  songId?: string;
  sessionId?: string;
  userAgent?: string;
}

export interface PlaybackState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  progress: number;
}

// Helper functions for creating typed events
export class MusicEventBuilder {
  private context: MusicEventContext;

  constructor(context: MusicEventContext) {
    this.context = context;
  }

  /**
   * Create a play start event
   */
  playStart(
    playbackState: Pick<PlaybackState, "currentTime" | "duration">
  ): MediaEventRequest {
    const progress =
      playbackState.duration > 0
        ? playbackState.currentTime / playbackState.duration
        : 0;

    return {
      media_blob_id: this.context.mediaBlobId,
      event_type: "play",
      event_data: {
        position: this.formatTime(playbackState.currentTime),
        progress: Math.min(progress, 1.0),
      },
      session_id: this.context.sessionId,
      domain_type: "song",
      domain_id: this.context.songId,
    };
  }

  /**
   * Create a play complete event (90%+ or natural end)
   */
  playComplete(
    playbackState: Pick<PlaybackState, "currentTime" | "duration">
  ): MediaEventRequest {
    return {
      media_blob_id: this.context.mediaBlobId,
      event_type: "complete",
      event_data: {
        position: this.formatTime(playbackState.currentTime),
        progress: 1.0,
      },
      session_id: this.context.sessionId,
      domain_type: "song",
      domain_id: this.context.songId,
    };
  }

  /**
   * Create a play partial event (paused/skipped before 90%)
   */
  playPartial(
    playbackState: Pick<PlaybackState, "currentTime" | "duration">
  ): MediaEventRequest {
    const progress =
      playbackState.duration > 0
        ? playbackState.currentTime / playbackState.duration
        : 0;

    return {
      media_blob_id: this.context.mediaBlobId,
      event_type: "pause",
      event_data: {
        position: this.formatTime(playbackState.currentTime),
        progress: Math.min(progress, 1.0),
      },
      session_id: this.context.sessionId,
      domain_type: "song",
      domain_id: this.context.songId,
    };
  }

  /**
   * Create a seek event
   */
  seek(fromTime: number, toTime: number): MediaEventRequest {
    return {
      media_blob_id: this.context.mediaBlobId,
      event_type: "seek",
      event_data: {
        from_position: this.formatTime(fromTime),
        to_position: this.formatTime(toTime),
        seek_distance: toTime - fromTime,
      },
      session_id: this.context.sessionId,
      domain_type: "song",
      domain_id: this.context.songId,
    };
  }

  /**
   * Create a rating event
   */
  rate(rating: number, previousRating?: number): MediaEventRequest {
    return {
      media_blob_id: this.context.mediaBlobId,
      event_type: "rate",
      event_data: {
        rating,
        previous_rating: previousRating,
      },
      session_id: this.context.sessionId,
      domain_type: "song",
      domain_id: this.context.songId,
    };
  }

  /**
   * Create a favorite/unfavorite event
   */
  favorite(isFavorite: boolean): MediaEventRequest {
    return {
      media_blob_id: this.context.mediaBlobId,
      event_type: isFavorite ? "favorite" : "unfavorite",
      event_data: null,
      session_id: this.context.sessionId,
      domain_type: "song",
      domain_id: this.context.songId,
    };
  }

  /**
   * Format time in seconds to MM:SS format
   */
  private formatTime(seconds: number): string {
    if (!seconds || isNaN(seconds)) return "00:00";

    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
}

// Play detection logic - determines if a play is "complete" vs "partial"
export interface PlayDetectionConfig {
  /** Minimum percentage to consider a complete play (default: 0.9 = 90%) */
  completeThreshold: number;
  /** Minimum seconds to consider any play meaningful (default: 5 seconds) */
  minimumPlayTime: number;
}

export class PlayDetector {
  private config: PlayDetectionConfig;

  constructor(config: Partial<PlayDetectionConfig> = {}) {
    this.config = {
      completeThreshold: config.completeThreshold || 0.9,
      minimumPlayTime: config.minimumPlayTime || 5,
    };
  }

  /**
   * Determine if a play session should count as "complete"
   */
  isCompletePlay(currentTime: number, duration: number): boolean {
    if (duration <= 0) return false;

    const progress = currentTime / duration;
    return progress >= this.config.completeThreshold || currentTime >= duration;
  }

  /**
   * Determine if a play session is meaningful (long enough to count)
   */
  isMeaningfulPlay(currentTime: number): boolean {
    return currentTime >= this.config.minimumPlayTime;
  }

  /**
   * Get the appropriate event type based on playback state
   */
  getEventType(
    currentTime: number,
    duration: number,
    wasNaturalEnd: boolean
  ): MediaEventType {
    if (wasNaturalEnd || this.isCompletePlay(currentTime, duration)) {
      return "complete";
    } else if (this.isMeaningfulPlay(currentTime)) {
      return "pause"; // Represents partial play
    } else {
      return "stop"; // Very short play, essentially a skip
    }
  }
}

// Session-based play tracking to avoid duplicate events
export interface PlaySession {
  mediaBlobId: string;
  sessionId: string;
  startTime: number;
  hasEmittedStart: boolean;
  hasEmittedEnd: boolean;
  lastPosition: number;
}

export class PlaySessionTracker {
  private activeSessions = new Map<string, PlaySession>();

  /**
   * Start tracking a new play session
   */
  startSession(mediaBlobId: string, sessionId: string): PlaySession {
    const key = `${sessionId}:${mediaBlobId}`;

    const session: PlaySession = {
      mediaBlobId,
      sessionId,
      startTime: Date.now(),
      hasEmittedStart: false,
      hasEmittedEnd: false,
      lastPosition: 0,
    };

    this.activeSessions.set(key, session);
    return session;
  }

  /**
   * Get active session for a media blob
   */
  getSession(mediaBlobId: string, sessionId: string): PlaySession | null {
    const key = `${sessionId}:${mediaBlobId}`;
    return this.activeSessions.get(key) || null;
  }

  /**
   * Update session position
   */
  updatePosition(
    mediaBlobId: string,
    sessionId: string,
    position: number
  ): void {
    const session = this.getSession(mediaBlobId, sessionId);
    if (session) {
      session.lastPosition = position;
    }
  }

  /**
   * Mark session as having emitted start event
   */
  markStartEmitted(mediaBlobId: string, sessionId: string): void {
    const session = this.getSession(mediaBlobId, sessionId);
    if (session) {
      session.hasEmittedStart = true;
    }
  }

  /**
   * Mark session as having emitted end event
   */
  markEndEmitted(mediaBlobId: string, sessionId: string): void {
    const session = this.getSession(mediaBlobId, sessionId);
    if (session) {
      session.hasEmittedEnd = true;
    }
  }

  /**
   * End and clean up a session
   */
  endSession(mediaBlobId: string, sessionId: string): void {
    const key = `${sessionId}:${mediaBlobId}`;
    this.activeSessions.delete(key);
  }

  /**
   * Clean up old sessions (call periodically)
   */
  cleanupOldSessions(maxAgeMs: number = 30 * 60 * 1000): void {
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
  getActiveSessions(): PlaySession[] {
    return Array.from(this.activeSessions.values());
  }
}

// Export default instances
export const playDetector = new PlayDetector();
export const playSessionTracker = new PlaySessionTracker();
