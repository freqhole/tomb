/**
 * Music analytics hook for tracking song play events
 *
 * Provides reactive session management and methods to emit play, pause, seek,
 * complete events with automatic batching via event buffer. Integrates with
 * existing music hooks and player state.
 */

import { createSignal, onCleanup } from "solid-js";
import { trackEvent, eventBuffer } from "../../lib/analytics/event-buffer";
import {
  getCurrentSessionId,
  updateSessionActivity,
} from "../../lib/analytics/session-manager";
import {
  MusicEventBuilder,
  PlayDetector,
  PlaySessionTracker,
  type PlaybackState,
  type MusicEventContext,
} from "../../lib/analytics/event-types";
import { configureAnalyticsClient } from "../../lib/analytics/analytics-client";

export interface UseMusicAnalyticsConfig {
  /** Enable debug logging */
  enableDebugLogs?: boolean;
  /** Complete play threshold (0.9 = 90%) */
  completeThreshold?: number;
  /** Minimum play time in seconds */
  minimumPlayTime?: number;
}

export interface MusicAnalyticsContext {
  trackPlayStart: (
    mediaBlobId: string,
    playbackState: PlaybackState,
    songId?: string
  ) => void;
  trackPlayComplete: (
    mediaBlobId: string,
    playbackState: PlaybackState,
    songId?: string
  ) => void;
  trackPlayPartial: (
    mediaBlobId: string,
    playbackState: PlaybackState,
    songId?: string
  ) => void;
  trackProgress: (
    mediaBlobId: string,
    currentTime: number,
    duration: number
  ) => void;
  trackSeek: (
    mediaBlobId: string,
    fromTime: number,
    toTime: number,
    songId?: string
  ) => void;
  trackRating: (
    mediaBlobId: string,
    rating: number,
    previousRating?: number,
    songId?: string
  ) => void;
  trackFavorite: (
    mediaBlobId: string,
    isFavorite: boolean,
    songId?: string
  ) => void;
  getCurrentSession: () => string;
  getAnalyticsStatus: () => {
    sessionId: string;
    bufferSize: number;
    isEnabled: boolean;
  };
  flushEvents: () => Promise<void>;
  initializeSession: (baseUrl?: string) => void;
}

export function useMusicAnalytics(
  config: UseMusicAnalyticsConfig = {}
): MusicAnalyticsContext {
  // Configuration
  const enableDebugLogs = config.enableDebugLogs || false;

  /**
   * Debug logging helper
   */
  const debugLog = (message: string, data?: unknown): void => {
    if (enableDebugLogs) {
      console.log(`[useMusicAnalytics] ${message}`, data);
    }
  };

  // Initialize play detector and session tracker
  const playDetector = new PlayDetector({
    completeThreshold: config.completeThreshold || 0.9,
    minimumPlayTime: config.minimumPlayTime || 5,
  });

  const sessionTracker = new PlaySessionTracker();

  // Track current session
  const [currentSessionId, setCurrentSessionId] = createSignal<string>("");

  // Initialize session
  const initializeSession = (baseUrl?: string) => {
    // Configure analytics client and event buffer with correct base URL
    if (baseUrl) {
      configureAnalyticsClient(baseUrl);
      eventBuffer.setBaseUrl(baseUrl);
    }

    const sessionId = getCurrentSessionId();
    setCurrentSessionId(sessionId);
    debugLog("analytics session initialized", { sessionId });
  };

  // Call on mount
  initializeSession();

  // Clean up old sessions periodically
  const cleanupInterval = setInterval(
    () => {
      sessionTracker.cleanupOldSessions();
    },
    5 * 60 * 1000
  ); // Every 5 minutes

  onCleanup(() => {
    clearInterval(cleanupInterval);
  });

  /**
   * Create event builder for a media blob
   */
  const createEventBuilder = (
    mediaBlobId: string,
    songId?: string
  ): MusicEventBuilder => {
    updateSessionActivity();

    const context: MusicEventContext = {
      mediaBlobId,
      songId,
      sessionId: currentSessionId(),
      userAgent: navigator.userAgent,
    };

    return new MusicEventBuilder(context);
  };

  /**
   * Track play start event
   */
  const trackPlayStart = (
    mediaBlobId: string,
    playbackState: PlaybackState,
    songId?: string
  ) => {
    debugLog("tracking play start", {
      mediaBlobId,
      songId,
      currentTime: playbackState.currentTime,
    });

    const session =
      sessionTracker.getSession(mediaBlobId, currentSessionId()) ||
      sessionTracker.startSession(mediaBlobId, currentSessionId());

    // Only emit start event once per session
    if (!session.hasEmittedStart) {
      const builder = createEventBuilder(mediaBlobId, songId);
      const event = builder.playStart(playbackState);

      trackEvent(event);
      sessionTracker.markStartEmitted(mediaBlobId, currentSessionId());

      debugLog("play start event emitted", {
        mediaBlobId,
        sessionId: currentSessionId(),
      });
    } else {
      debugLog("play start already emitted for this session", { mediaBlobId });
    }
  };

  /**
   * Track play complete event (90%+ or natural end)
   */
  const trackPlayComplete = (
    mediaBlobId: string,
    playbackState: PlaybackState,
    songId?: string
  ) => {
    debugLog("tracking play complete", {
      mediaBlobId,
      songId,
      progress: playbackState.progress,
    });

    const session = sessionTracker.getSession(mediaBlobId, currentSessionId());

    // Only emit complete event once per session and if we haven't already emitted an end event
    if (session && !session.hasEmittedEnd) {
      const builder = createEventBuilder(mediaBlobId, songId);
      const event = builder.playComplete(playbackState);

      trackEvent(event);
      sessionTracker.markEndEmitted(mediaBlobId, currentSessionId());
      sessionTracker.endSession(mediaBlobId, currentSessionId());

      debugLog("play complete event emitted", {
        mediaBlobId,
        sessionId: currentSessionId(),
      });
    } else {
      debugLog("play complete not emitted", {
        mediaBlobId,
        hasSession: !!session,
        hasEmittedEnd: session?.hasEmittedEnd,
      });
    }
  };

  /**
   * Track play partial event (paused/skipped before 90%)
   */
  const trackPlayPartial = (
    mediaBlobId: string,
    playbackState: PlaybackState,
    songId?: string
  ) => {
    debugLog("tracking play partial", {
      mediaBlobId,
      songId,
      progress: playbackState.progress,
    });

    const session = sessionTracker.getSession(mediaBlobId, currentSessionId());

    // Only emit partial event if we haven't already emitted an end event and the play was meaningful
    if (
      session &&
      !session.hasEmittedEnd &&
      playDetector.isMeaningfulPlay(playbackState.currentTime)
    ) {
      const builder = createEventBuilder(mediaBlobId, songId);
      const event = builder.playPartial(playbackState);

      trackEvent(event);
      sessionTracker.markEndEmitted(mediaBlobId, currentSessionId());
      sessionTracker.endSession(mediaBlobId, currentSessionId());

      debugLog("play partial event emitted", {
        mediaBlobId,
        sessionId: currentSessionId(),
      });
    } else {
      debugLog("play partial not emitted", {
        mediaBlobId,
        hasSession: !!session,
        hasEmittedEnd: session?.hasEmittedEnd,
        isMeaningful: playDetector.isMeaningfulPlay(playbackState.currentTime),
      });
    }
  };

  /**
   * Track progress during playback (used for detecting completion threshold)
   */
  const trackProgress = (
    mediaBlobId: string,
    currentTime: number,
    duration: number
  ) => {
    // Update session position for completion detection
    sessionTracker.updatePosition(mediaBlobId, currentSessionId(), currentTime);

    // Auto-emit complete event if we hit the completion threshold
    const session = sessionTracker.getSession(mediaBlobId, currentSessionId());
    if (
      session &&
      !session.hasEmittedEnd &&
      playDetector.isCompletePlay(currentTime, duration)
    ) {
      const playbackState: PlaybackState = {
        isPlaying: true,
        currentTime,
        duration,
        volume: 1.0, // We don't have volume in this context
        progress: duration > 0 ? currentTime / duration : 0,
      };

      trackPlayComplete(mediaBlobId, playbackState);
    }
  };

  /**
   * Track seek events (user manually changed position)
   */
  const trackSeek = (
    mediaBlobId: string,
    fromTime: number,
    toTime: number,
    songId?: string
  ) => {
    debugLog("tracking seek", { mediaBlobId, songId, fromTime, toTime });

    const builder = createEventBuilder(mediaBlobId, songId);
    const event = builder.seek(fromTime, toTime);

    trackEvent(event);
    updateSessionActivity();
  };

  /**
   * Track rating events
   */
  const trackRating = (
    mediaBlobId: string,
    rating: number,
    previousRating?: number,
    songId?: string
  ) => {
    debugLog("tracking rating", {
      mediaBlobId,
      songId,
      rating,
      previousRating,
    });

    const builder = createEventBuilder(mediaBlobId, songId);
    const event = builder.rate(rating, previousRating);

    trackEvent(event);
    updateSessionActivity();
  };

  /**
   * Track favorite/unfavorite events
   */
  const trackFavorite = (
    mediaBlobId: string,
    isFavorite: boolean,
    songId?: string
  ) => {
    debugLog("tracking favorite", { mediaBlobId, songId, isFavorite });

    const builder = createEventBuilder(mediaBlobId, songId);
    const event = builder.favorite(isFavorite);

    trackEvent(event);
    updateSessionActivity();
  };

  /**
   * Get current session ID
   */
  const getCurrentSession = (): string => {
    return currentSessionId();
  };

  /**
   * Get analytics status for debugging
   */
  const getAnalyticsStatus = () => {
    const bufferStatus = eventBuffer.getStatus();

    return {
      sessionId: currentSessionId(),
      bufferSize: bufferStatus.bufferSize,
      isEnabled: true, // Analytics is always enabled in this implementation
    };
  };

  /**
   * Manually flush buffered events
   */
  const flushEvents = async (): Promise<void> => {
    debugLog("manually flushing analytics events");
    await eventBuffer.flush();
  };

  return {
    trackPlayStart,
    trackPlayComplete,
    trackPlayPartial,
    trackProgress,
    trackSeek,
    trackRating,
    trackFavorite,
    getCurrentSession,
    getAnalyticsStatus,
    flushEvents,
    initializeSession, // Expose for external configuration
  };
}
