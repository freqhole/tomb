//! Blob Cache Interface
//!
//! Common interface for media blob cache implementations to avoid circular dependencies

import type { WebSocketClient } from "../lib/websocket-client.js";

/**
 * Common interface for cache implementations
 */
export interface IBlobCache {
  /** Check if binary data is cached for a blob ID */
  isCached(blobId: string): Promise<boolean>;

  /** Request and cache binary data for a blob ID */
  requestAndCache(
    blobId: string,
    websocketClient?: WebSocketClient
  ): Promise<boolean>;

  /** Get cached binary data for a blob ID */
  getCachedData(blobId: string): Promise<{
    id: string;
    data: Uint8Array;
    mime: string;
    size: number;
    cached_at: string;
  } | null>;

  /** Get or create blob URL for cached data */
  getBlobUrl(blobId: string): Promise<string | null>;

  /** Release blob URL and free memory */
  releaseBlobUrl(blobId: string): void;

  /** Get cache statistics */
  getStats(): Promise<{
    totalItems: number;
    totalSize: number;
    activeBlobUrls: number;
    hitRate: number;
  }>;

  /** Add event listener for cache events */
  addEventListener(type: string, listener: (event: any) => void): void;
}
