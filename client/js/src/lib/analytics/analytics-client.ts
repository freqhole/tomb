/**
 * Analytics HTTP client for sending events to the server
 *
 * Provides a clean interface for submitting analytics events with proper
 * error handling, retry logic, and type safety.
 */

import { z } from "zod";

// Event types matching server-side enums
export const MediaEventTypeSchema = z.enum([
  "play",
  "pause",
  "resume",
  "stop",
  "complete",
  "seek",
  "skip",
  "rate",
  "favorite",
  "unfavorite",
  "tag",
  "untag",
  "download",
  "share",
  "view",
  "thumbnail_click",
  "playlist_add",
  "playlist_remove",
  "repeat",
  "shuffle",
  "volume_change",
  "quality_change",
  "fullscreen",
  "picture_in_picture",
  "cast",
]);

export const DomainTypeSchema = z.enum([
  "song",
  "album",
  "artist",
  "genre",
  "playlist",
  "photo",
  "video",
  "book",
  "document",
]);

// Event data schemas for different event types
export const MediaEventDataSchema = z.union([
  z.object({
    position: z.string(),
    progress: z.number().min(0).max(1).optional(),
    quality: z.string().optional(),
  }),
  z.object({
    rating: z.number().int().min(1).max(5),
    previous_rating: z.number().int().min(1).max(5).optional(),
  }),
  z.object({
    volume: z.number().min(0).max(1),
    previous_volume: z.number().min(0).max(1).optional(),
  }),
  z.object({
    from_position: z.string(),
    to_position: z.string(),
    seek_distance: z.number(),
  }),
  z.object({
    platform: z.string(),
    context: z.string().optional(),
  }),
  z.object({
    tag: z.string(),
    operation: z.enum(["add", "remove"]),
  }),
  z.object({
    total_songs: z.number(),
    shuffle_enabled: z.boolean(),
    play_source: z.enum(["play_all", "shuffle_all", "continue_playing"]),
    first_song_id: z.string().optional(),
  }),
  z.record(z.unknown()), // Generic data
  z.null(), // Empty data
]);

// Request schemas
export const MediaEventRequestSchema = z.object({
  media_blob_id: z.string().nullable(),
  event_type: MediaEventTypeSchema,
  event_data: MediaEventDataSchema.optional(),
  session_id: z.string().optional(),
  domain_type: DomainTypeSchema.optional(),
  domain_id: z.string().optional(),
});

export const MediaEventBatchRequestSchema = z.object({
  events: z.array(MediaEventRequestSchema),
});

// Response schemas
export const MediaEventResponseSchema = z.object({
  id: z.string(),
  created_at: z.unknown(), // Time format from server
  status: z.string(),
});

export const MediaEventBatchResponseSchema = z.object({
  processed: z.number(),
  failed: z.number(),
  events: z.array(MediaEventResponseSchema),
  errors: z.array(z.string()),
});

// Type exports
export type MediaEventType = z.infer<typeof MediaEventTypeSchema>;
export type DomainType = z.infer<typeof DomainTypeSchema>;
export type MediaEventData = z.infer<typeof MediaEventDataSchema>;
export type MediaEventRequest = z.infer<typeof MediaEventRequestSchema>;
export type MediaEventBatchRequest = z.infer<
  typeof MediaEventBatchRequestSchema
>;
export type MediaEventResponse = z.infer<typeof MediaEventResponseSchema>;
export type MediaEventBatchResponse = z.infer<
  typeof MediaEventBatchResponseSchema
>;

export interface AnalyticsClientConfig {
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
  enableDebugLogs?: boolean;
}

export class AnalyticsClient {
  private config: Required<AnalyticsClientConfig>;

  constructor(config: AnalyticsClientConfig = {}) {
    this.config = {
      baseUrl: config.baseUrl || window.location.origin,
      timeout: config.timeout || 5000,
      maxRetries: config.maxRetries || 1,
      retryDelay: config.retryDelay || 1000,
      enableDebugLogs: config.enableDebugLogs || false,
    };
  }

  /**
   * Submit a single analytics event
   */
  async submitEvent(event: MediaEventRequest): Promise<MediaEventResponse> {
    this.debugLog("submitting single event", event);

    const response = await this.makeRequest("/api/analytics/events", event);

    // Parse and validate response
    const parsed = MediaEventResponseSchema.parse(response);
    this.debugLog("event submitted successfully", parsed);

    return parsed;
  }

  /**
   * Submit multiple analytics events in a batch
   */
  async submitBatch(
    events: MediaEventRequest[]
  ): Promise<MediaEventBatchResponse> {
    if (events.length === 0) {
      return {
        processed: 0,
        failed: 0,
        events: [],
        errors: [],
      };
    }

    this.debugLog(`submitting batch of ${events.length} events`);

    const batchRequest: MediaEventBatchRequest = { events };
    const response = await this.makeRequest(
      "/api/analytics/events",
      batchRequest
    );

    // Parse and validate response
    const parsed = MediaEventBatchResponseSchema.parse(response);
    this.debugLog(
      `batch submitted: ${parsed.processed} processed, ${parsed.failed} failed`
    );

    return parsed;
  }

  /**
   * Get play analytics for a song
   */
  async getSongAnalytics(mediaBlobId: string): Promise<unknown> {
    this.debugLog("fetching song analytics", { mediaBlobId });

    const response = await this.makeRequest(
      `/api/analytics/songs/${encodeURIComponent(mediaBlobId)}/plays`,
      null,
      "GET"
    );

    this.debugLog("song analytics received", response);
    return response;
  }

  /**
   * Get user's listening history
   */
  async getUserHistory(limit?: number, offset?: number): Promise<unknown[]> {
    this.debugLog("fetching user history", { limit, offset });

    const params = new URLSearchParams();
    if (limit !== undefined) params.set("limit", limit.toString());
    if (offset !== undefined) params.set("offset", offset.toString());

    const url = `/api/analytics/history${params.toString() ? `?${params}` : ""}`;
    const response = await this.makeRequest(url, null, "GET");

    this.debugLog(
      `user history received: ${Array.isArray(response) ? response.length : 0} items`
    );
    return Array.isArray(response) ? response : [];
  }

  /**
   * Make an HTTP request with retry logic
   */
  private async makeRequest(
    endpoint: string,
    data: unknown,
    method: "GET" | "POST" = "POST"
  ): Promise<unknown> {
    const url = `${this.config.baseUrl}${endpoint}`;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          this.config.timeout
        );

        const response = await fetch(url, {
          method,
          headers: {
            "Content-Type": "application/json",
          },
          body: data ? JSON.stringify(data) : undefined,
          credentials: "include", // Include cookies for authentication
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        return await response.json();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < this.config.maxRetries) {
          this.debugLog(
            `request failed, retrying in ${this.config.retryDelay}ms`,
            {
              attempt: attempt + 1,
              error: lastError.message,
            }
          );

          await new Promise((resolve) =>
            setTimeout(resolve, this.config.retryDelay)
          );
        }
      }
    }

    // If we get here, all retries failed
    const finalError = new Error(
      `analytics request failed after ${this.config.maxRetries + 1} attempts: ${lastError?.message}`
    );

    this.debugLog("analytics request failed permanently", {
      error: finalError.message,
      endpoint,
    });

    throw finalError;
  }

  /**
   * Debug logging helper
   */
  private debugLog(message: string, data?: unknown): void {
    if (this.config.enableDebugLogs) {
      console.log(`[analytics-client] ${message}`, data);
    }
  }

  /**
   * Create a simple event for common use cases
   */
  static createPlayEvent(
    mediaBlobId: string,
    position: string,
    progress?: number
  ): MediaEventRequest {
    return {
      media_blob_id: mediaBlobId,
      event_type: "play",
      event_data: {
        position,
        progress,
      },
      domain_type: "song",
    };
  }

  static createCompleteEvent(
    mediaBlobId: string,
    finalPosition: string
  ): MediaEventRequest {
    return {
      media_blob_id: mediaBlobId,
      event_type: "complete",
      event_data: {
        position: finalPosition,
        progress: 1.0,
      },
      domain_type: "song",
    };
  }

  static createPauseEvent(
    mediaBlobId: string,
    position: string,
    progress?: number
  ): MediaEventRequest {
    return {
      media_blob_id: mediaBlobId,
      event_type: "pause",
      event_data:
        progress !== undefined
          ? {
              position,
              progress,
            }
          : null,
      domain_type: "song",
    };
  }
}

// Create default client instance - will be configured with proper base URL when imported
export const analyticsClient = new AnalyticsClient();

// Function to configure analytics client with api base URL
export function configureAnalyticsClient(baseUrl: string): void {
  (analyticsClient as any).config.baseUrl = baseUrl;
}
