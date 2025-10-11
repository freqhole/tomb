/**
 * Analytics library index
 *
 * Main entry point for the analytics system. Exports all analytics functionality
 * including client, event buffer, session management, and TypeScript types.
 */

// Core analytics client
export {
  AnalyticsClient,
  analyticsClient,
  MediaEventTypeSchema,
  DomainTypeSchema,
  MediaEventDataSchema,
  MediaEventRequestSchema,
  MediaEventBatchRequestSchema,
  MediaEventResponseSchema,
  MediaEventBatchResponseSchema,
} from "./analytics-client";

export type {
  MediaEventType,
  DomainType,
  MediaEventData,
  MediaEventRequest,
  MediaEventBatchRequest,
  MediaEventResponse,
  MediaEventBatchResponse,
  AnalyticsClientConfig,
} from "./analytics-client";

// Event buffering system
export {
  EventBuffer,
  eventBuffer,
  trackEvent,
  flushEvents,
} from "./event-buffer";

export type {
  EventBufferConfig,
} from "./event-buffer";

// Session management
export {
  SessionManager,
  sessionManager,
  getCurrentSessionId,
  updateSessionActivity,
} from "./session-manager";

export type {
  SessionManagerConfig,
} from "./session-manager";

// Event types and builders
export {
  MusicEventBuilder,
  PlayDetector,
  PlaySessionTracker,
  playDetector,
  playSessionTracker,
} from "./event-types";

export type {
  PlayEventData,
  SeekEventData,
  RatingEventData,
  VolumeEventData,
  MusicEventContext,
  PlaybackState,
  PlayDetectionConfig,
  PlaySession,
} from "./event-types";

// Music analytics hook
export {
  useMusicAnalytics,
} from "../../hooks/music/useMusicAnalytics";

export type {
  UseMusicAnalyticsConfig,
  MusicAnalyticsContext,
} from "../../hooks/music/useMusicAnalytics";

// Convenience functions for common use cases
export function createQuickPlayEvent(mediaBlobId: string, position: string, progress?: number) {
  return AnalyticsClient.createPlayEvent(mediaBlobId, position, progress);
}

export function createQuickCompleteEvent(mediaBlobId: string, finalPosition: string) {
  return AnalyticsClient.createCompleteEvent(mediaBlobId, finalPosition);
}

export function createQuickPauseEvent(mediaBlobId: string, position: string, progress?: number) {
  return AnalyticsClient.createPauseEvent(mediaBlobId, position, progress);
}

// Re-export from analytics-client for backwards compatibility
import { AnalyticsClient } from "./analytics-client";
