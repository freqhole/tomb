//! Sync API Client - Type-safe adapter for sync endpoints
//!
//! This module provides a type-safe wrapper around the ApiClient specifically
//! for sync operations, with automatic Zod validation and error handling.

import { ApiClient } from "../lib/api-client.js";
import type {
  SyncRequest,
  SyncResponse,
  SyncStatusResponse,
  SyncRecommendationsResponse,
  FullSyncRequest,
  SyncAckRequest,
  IncrementalSyncQuery,
  FullSyncQuery,
  SyncError,
  SongSyncResponse,
  PlaylistSyncResponse,
  PlaylistSongSyncResponse,
} from "./sync-schemas.js";
import {
  safeParseSyncResponse,
  safeParseSyncStatus,
  safeParseSyncRecommendations,
  safeParseSongSyncResponse,
  safeParsePlaylistSyncResponse,
  safeParsePlaylistSongSyncResponse,
  SyncRequestSchema,
  FullSyncRequestSchema,
  SyncAckRequestSchema,
} from "./sync-schemas.js";

/**
 * Sync API client configuration
 */
export interface SyncApiClientConfig {
  /** Base API client instance */
  apiClient: ApiClient;
  /** Default timeout for sync operations in milliseconds */
  timeout?: number;
  /** Whether to validate requests before sending */
  validateRequests?: boolean;
}

/**
 * Type-safe sync API client
 */
export class SyncApiClient {
  private apiClient: ApiClient;

  private validateRequests: boolean;

  constructor(config: SyncApiClientConfig) {
    this.apiClient = config.apiClient;

    this.validateRequests = config.validateRequests ?? true;
  }

  /**
   * Perform incremental sync
   */
  async incrementalSync(query: IncrementalSyncQuery): Promise<SyncResponse> {
    const url = "/api/sync/media";

    try {
      const response = await this.apiClient.makeRequest<SyncResponse>(
        "GET",
        url,
        {
          params: this.sanitizeQuery(query),
        }
      );

      const validation = safeParseSyncResponse(response);
      if (!validation.success) {
        throw new SyncApiError(
          "INVALID_RESPONSE",
          `Invalid sync response from ${url}`,
          validation.error
        );
      }

      return validation.data;
    } catch (error) {
      throw this.handleApiError(error, "incremental_sync");
    }
  }

  /**
   * Perform full sync
   */
  async fullSync(query: FullSyncQuery): Promise<SyncResponse> {
    const url = "/api/sync/media/full";

    try {
      const response = await this.apiClient.makeRequest<SyncResponse>(
        "GET",
        url,
        {
          params: this.sanitizeQuery(query),
        }
      );

      const validation = safeParseSyncResponse(response);
      if (!validation.success) {
        throw new SyncApiError(
          "INVALID_RESPONSE",
          `Invalid sync response from ${url}`,
          validation.error
        );
      }

      return validation.data;
    } catch (error) {
      throw this.handleApiError(error, "full_sync");
    }
  }

  /**
   * Send sync acknowledgment
   */
  async acknowledgmentSync(
    clientId: string,
    request: SyncAckRequest
  ): Promise<void> {
    const url = "/api/sync/media/acknowledge";

    if (this.validateRequests) {
      try {
        SyncAckRequestSchema.parse(request);
      } catch (error) {
        throw new SyncApiError(
          "INVALID_REQUEST",
          "Invalid sync acknowledgment request",
          error
        );
      }
    }

    try {
      await this.apiClient.makeRequest("POST", url, {
        data: {
          client_id: clientId,
          ...request,
        },
      });
    } catch (error) {
      throw this.handleApiError(error, "acknowledge_sync");
    }
  }

  /**
   * Get sync status and server capabilities
   */
  async getSyncStatus(): Promise<SyncStatusResponse> {
    const url = "/api/sync/status";

    try {
      const response = await this.apiClient.makeRequest<SyncStatusResponse>(
        "GET",
        url
      );

      const validation = safeParseSyncStatus(response);
      if (!validation.success) {
        throw new SyncApiError(
          "INVALID_RESPONSE",
          `Invalid sync status response from ${url}`,
          validation.error
        );
      }

      return validation.data;
    } catch (error) {
      throw this.handleApiError(error, "sync_status");
    }
  }

  /**
   * Get sync recommendations
   */
  async getSyncRecommendations(): Promise<SyncRecommendationsResponse> {
    const url = "/api/sync/recommendations";

    try {
      const response =
        await this.apiClient.makeRequest<SyncRecommendationsResponse>(
          "GET",
          url
        );

      const validation = safeParseSyncRecommendations(response);
      if (!validation.success) {
        throw new SyncApiError(
          "INVALID_RESPONSE",
          `Invalid sync recommendations response from ${url}`,
          validation.error
        );
      }

      return validation.data;
    } catch (error) {
      throw this.handleApiError(error, "sync_recommendations");
    }
  }

  /**
   * Check if sync is needed
   */
  async checkSyncNeeded(): Promise<{ should_sync: boolean; reason?: string }> {
    const url = "/api/sync/check";

    try {
      const response = await this.apiClient.makeRequest<{
        should_sync: boolean;
        reason?: string;
      }>("GET", url);

      return response as { should_sync: boolean; reason?: string };
    } catch (error) {
      throw this.handleApiError(error, "check_sync_needed");
    }
  }

  /**
   * Perform incremental sync for songs
   */
  async syncSongs(query: {
    last_sync_time?: string;
    page_size?: number;
    artist?: string;
    album?: string;
    favorites_only?: boolean;
  }): Promise<SongSyncResponse> {
    const url = "/api/sync/songs";

    try {
      const response = await this.apiClient.makeRequest<SongSyncResponse>(
        "GET",
        url,
        {
          params: this.sanitizeQuery(query),
        }
      );

      const validation = safeParseSongSyncResponse(response);
      if (!validation.success) {
        throw new SyncApiError(
          "INVALID_RESPONSE",
          `Invalid song sync response from ${url}`,
          validation.error
        );
      }

      return validation.data;
    } catch (error) {
      throw this.handleApiError(error, "sync_songs");
    }
  }

  /**
   * Perform incremental sync for playlists
   */
  async syncPlaylists(query: {
    last_sync_time?: string;
    page_size?: number;
    public_only?: boolean;
    client_id?: string;
  }): Promise<PlaylistSyncResponse> {
    const url = "/api/sync/playlists";

    try {
      const response = await this.apiClient.makeRequest<PlaylistSyncResponse>(
        "GET",
        url,
        {
          params: this.sanitizeQuery(query),
        }
      );

      const validation = safeParsePlaylistSyncResponse(response);
      if (!validation.success) {
        throw new SyncApiError(
          "INVALID_RESPONSE",
          `Invalid playlist sync response from ${url}`,
          validation.error
        );
      }

      return validation.data;
    } catch (error) {
      throw this.handleApiError(error, "sync_playlists");
    }
  }

  /**
   * Perform incremental sync for playlist songs
   */
  async syncPlaylistSongs(
    playlistId: string,
    query: {
      last_sync_time?: string;
      page_size?: number;
    }
  ): Promise<PlaylistSongSyncResponse> {
    const url = `/api/sync/playlist-songs`;

    try {
      const response =
        await this.apiClient.makeRequest<PlaylistSongSyncResponse>("GET", url, {
          params: this.sanitizeQuery({
            ...query,
            playlist_id: playlistId,
          }),
        });

      const validation = safeParsePlaylistSongSyncResponse(response);
      if (!validation.success) {
        throw new SyncApiError(
          "INVALID_RESPONSE",
          `Invalid playlist songs sync response from ${url}`,
          validation.error
        );
      }

      return validation.data;
    } catch (error) {
      throw this.handleApiError(error, "sync_playlist_songs");
    }
  }

  /**
   * Create sync request from parameters
   */
  createSyncRequest(params: Partial<SyncRequest>): SyncRequest {
    const request: SyncRequest = {
      client_id: params.client_id || crypto.randomUUID(),
      page_size: params.page_size || 50,
      include_data: params.include_data || false,
      ...params,
    };

    if (this.validateRequests) {
      try {
        return SyncRequestSchema.parse(request);
      } catch (error) {
        throw new SyncApiError(
          "INVALID_REQUEST",
          "Invalid sync request parameters",
          error
        );
      }
    }

    return request;
  }

  /**
   * Create full sync request from parameters
   */
  createFullSyncRequest(params: Partial<FullSyncRequest>): FullSyncRequest {
    const request: FullSyncRequest = {
      client_id: params.client_id || crypto.randomUUID(),
      batch_size: params.batch_size || 100,
      include_data: params.include_data || false,
      ...params,
    };

    if (this.validateRequests) {
      try {
        return FullSyncRequestSchema.parse(request);
      } catch (error) {
        throw new SyncApiError(
          "INVALID_REQUEST",
          "Invalid full sync request parameters",
          error
        );
      }
    }

    return request;
  }

  // Private helper methods

  private sanitizeQuery(query: Record<string, any>): Record<string, string> {
    const sanitized: Record<string, string> = {};

    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        sanitized[key] = String(value);
      }
    }

    return sanitized;
  }

  private handleApiError(error: unknown, operation: string): SyncApiError {
    if (error instanceof SyncApiError) {
      return error;
    }

    if (error instanceof Error) {
      return new SyncApiError(
        "API_ERROR",
        `${operation} failed: ${error.message}`,
        error
      );
    }

    return new SyncApiError(
      "UNKNOWN_ERROR",
      `${operation} failed with unknown error`,
      error
    );
  }
}

/**
 * Sync API specific error class
 */
export class SyncApiError extends Error {
  public readonly code: string;
  public readonly originalCause?: unknown;

  constructor(code: string, message: string, originalCause?: unknown) {
    super(message);
    this.name = "SyncApiError";
    this.code = code;
    this.originalCause = originalCause;
  }

  /**
   * Check if error is recoverable
   */
  isRecoverable(): boolean {
    return this.code !== "INVALID_REQUEST" && this.code !== "INVALID_RESPONSE";
  }

  /**
   * Get suggested retry delay in milliseconds
   */
  getRetryDelay(): number {
    switch (this.code) {
      case "RATE_LIMITED":
        return 5000; // 5 seconds
      case "SERVER_ERROR":
        return 2000; // 2 seconds
      case "NETWORK_ERROR":
        return 1000; // 1 second
      default:
        return 0; // No retry
    }
  }

  /**
   * Convert to sync error format
   */
  toSyncError(): SyncError {
    return {
      type: this.code,
      message: this.message,
      timestamp: new Date().toISOString(),
      recoverable: this.isRecoverable(),
      retry_delay: this.getRetryDelay() / 1000, // Convert to seconds
      context: {
        cause: this.originalCause,
      },
    };
  }
}

/**
 * Factory function to create sync API client
 */
export function createSyncApiClient(
  config: SyncApiClientConfig
): SyncApiClient {
  return new SyncApiClient(config);
}

/**
 * Type guards for sync API errors
 */
export function isSyncApiError(error: unknown): error is SyncApiError {
  return error instanceof SyncApiError;
}

/**
 * Utility to convert API client errors to sync errors
 */
export function convertToSyncError(
  error: unknown,
  operation: string
): SyncError {
  if (isSyncApiError(error)) {
    return error.toSyncError();
  }

  return {
    type: "UNKNOWN_ERROR",
    message: error instanceof Error ? error.message : `${operation} failed`,
    timestamp: new Date().toISOString(),
    recoverable: true,
    retry_delay: 1,
    context: { error },
  };
}
