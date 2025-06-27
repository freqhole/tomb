/**
 * Media Blob Manager
 *
 * Handles media blob data management, caching, thumbnail generation,
 * and display formatting for WebSocket-received media blobs.
 */

import type { MediaBlob } from "./websocket-types.js";
import { ManagedEventTarget } from "./event-utils.js";

export interface MediaBlobData {
  id: string;
  data: number[];
  mime: string;
  size: number;
}

export interface BlobDisplayInfo {
  id: string;
  mime: string;
  size: string;
  sha256: string;
  clientId: string;
  path: string;
  createdAt: string;
  metadata: string;
  thumbnailHtml: string;
  fileUrl?: string; // Full URL for accessing large files
  storageType: "database" | "disk"; // How the file is stored
}

export class MediaBlobManager extends ManagedEventTarget {
  private blobs: MediaBlob[] = [];
  private blobDataCache = new Map<string, string>(); // blob ID -> data URL
  private loadingBlobs = new Set<string>();
  private baseUrl: string;

  constructor(baseUrl: string = "http://localhost:8080") {
    super();
    this.baseUrl = baseUrl.replace(/\/$/, ""); // Remove trailing slash
  }

  /**
   * Update the list of media blobs
   */
  updateBlobs(blobs: MediaBlob[]): void {
    this.blobs = [...blobs];

    // Auto-load images for thumbnails (only for database-stored images)
    this.blobs.forEach((blob) => {
      if (
        blob.mime?.startsWith("image/") &&
        !blob.local_path && // Only load database-stored images
        !this.isCached(blob.id) &&
        !this.isLoading(blob.id)
      ) {
        setTimeout(() => this.requestBlobData(blob.id), 100);
      }
    });

    this.dispatchEvent(
      new CustomEvent("blobs-updated", {
        detail: { blobs: this.blobs, count: this.blobs.length },
      })
    );
  }

  /**
   * Get all blobs
   */
  getBlobs(): MediaBlob[] {
    return [...this.blobs];
  }

  /**
   * Get a specific blob by ID
   */
  getBlob(id: string): MediaBlob | undefined {
    return this.blobs.find((blob) => blob.id === id);
  }

  /**
   * Add blob data to cache
   */
  cacheBlobData(blobData: MediaBlobData): void {
    if (!blobData.id || !blobData.data) return;

    // Convert data array to Uint8Array and create blob
    const uint8Array = new Uint8Array(blobData.data);
    const blob = new Blob([uint8Array], {
      type: blobData.mime || "application/octet-stream",
    });
    const dataUrl = URL.createObjectURL(blob);

    // Cache the data URL
    this.blobDataCache.set(blobData.id, dataUrl);
    this.loadingBlobs.delete(blobData.id);

    this.dispatchEvent(
      new CustomEvent("blob-data-cached", {
        detail: { id: blobData.id, dataUrl, mime: blobData.mime },
      })
    );
  }

  /**
   * Check if blob data is cached
   */
  isCached(blobId: string): boolean {
    return this.blobDataCache.has(blobId);
  }

  /**
   * Get cached data URL for a blob
   */
  getCachedDataUrl(blobId: string): string | undefined {
    return this.blobDataCache.get(blobId);
  }

  /**
   * Check if blob is currently loading
   */
  isLoading(blobId: string): boolean {
    return this.loadingBlobs.has(blobId);
  }

  /**
   * Mark blob as loading
   */
  markAsLoading(blobId: string): void {
    this.loadingBlobs.add(blobId);
  }

  /**
   * Request blob data (emits event for external handler)
   */
  requestBlobData(blobId: string): void {
    if (this.isCached(blobId) || this.isLoading(blobId)) {
      return;
    }

    this.markAsLoading(blobId);

    this.dispatchEvent(
      new CustomEvent("blob-data-requested", {
        detail: { id: blobId },
      })
    );
  }

  /**
   * Generate display information for a blob
   */
  getBlobDisplayInfo(blob: MediaBlob): BlobDisplayInfo {
    const storageType = this.getStorageType(blob);
    const fileUrl = this.getFileUrl(blob);

    return {
      id: blob.id,
      mime: blob.mime || "Unknown type",
      size: this.formatFileSize(blob.size || 0),
      sha256: blob.sha256,
      clientId: blob.source_client_id || "Unknown",
      path: blob.local_path || "None",
      createdAt: new Date(blob.created_at).toLocaleString(),
      metadata:
        Object.keys(blob.metadata || {}).length > 0
          ? JSON.stringify(blob.metadata)
          : "",
      thumbnailHtml: this.generateThumbnailHtml(blob),
      fileUrl,
      storageType,
    };
  }

  /**
   * Generate thumbnail HTML for a blob
   */
  generateThumbnailHtml(blob: MediaBlob): string {
    const mime = blob.mime || "";
    const cachedData = this.getCachedDataUrl(blob.id);
    const isLoading = this.isLoading(blob.id);
    const storageType = this.getStorageType(blob);
    const fileUrl = this.getFileUrl(blob);

    const baseStyle =
      "width: 80px; height: 80px; border-radius: 4px; object-fit: cover;";
    const placeholderStyle =
      "display: flex; align-items: center; justify-content: center; background: #f0f0f0; font-size: 0.7em; border-radius: 4px; cursor: pointer;";

    if (mime.startsWith("image/")) {
      // For large files stored on disk, use the direct URL
      if (storageType === "disk" && fileUrl) {
        return `<img src="${fileUrl}" alt="Thumbnail" style="${baseStyle}" loading="lazy">`;
      }
      // For small files in database, use cached data or load on demand
      else if (cachedData) {
        return `<img src="${cachedData}" alt="Thumbnail" style="${baseStyle}" loading="lazy">`;
      } else if (isLoading) {
        return `<div style="${baseStyle} ${placeholderStyle}">Loading...</div>`;
      } else {
        return `<div style="${baseStyle} ${placeholderStyle}" onclick="window.loadBlobData('${blob.id}')">LOAD IMAGE</div>`;
      }
    } else if (mime.startsWith("video/")) {
      // For large files stored on disk, use the direct URL
      if (storageType === "disk" && fileUrl) {
        return this.generateVideoElement(fileUrl, mime, baseStyle);
      }
      // For small files in database, use cached data or load on demand
      else if (cachedData) {
        return this.generateVideoElement(cachedData, mime, baseStyle);
      } else if (isLoading) {
        return `<div style="${baseStyle} ${placeholderStyle}">Loading...</div>`;
      } else {
        return `<div style="${baseStyle} ${placeholderStyle}" onclick="window.loadBlobData('${blob.id}')">LOAD VIDEO</div>`;
      }
    } else if (mime.startsWith("audio/")) {
      // For large files stored on disk, use the direct URL
      if (storageType === "disk" && fileUrl) {
        return `<audio style="${baseStyle}" controls><source src="${fileUrl}" type="${mime}"></audio>`;
      }
      // For small files in database, use cached data or load on demand
      else if (cachedData) {
        return `<audio style="${baseStyle}" controls><source src="${cachedData}" type="${mime}"></audio>`;
      } else if (isLoading) {
        return `<div style="${baseStyle} ${placeholderStyle}">Loading...</div>`;
      } else {
        return `<div style="${baseStyle} ${placeholderStyle}" onclick="window.loadBlobData('${blob.id}')">LOAD AUDIO</div>`;
      }
    } else if (mime === "application/pdf") {
      return `<div style="${baseStyle} ${placeholderStyle}">PDF</div>`;
    } else {
      return `<div style="${baseStyle} ${placeholderStyle}">FILE</div>`;
    }
  }

  /**
   * Generate video element with browser compatibility fallbacks
   */
  private generateVideoElement(
    src: string,
    mime: string,
    baseStyle: string
  ): string {
    // Check if this is a potentially problematic format for Chrome
    const isQuickTime =
      mime === "video/quicktime" || src.toLowerCase().endsWith(".mov");

    const browserInfo = this.getBrowserInfo();

    if (isQuickTime && !browserInfo.supportsMov) {
      // For QuickTime/MOV files in unsupported browsers, show helpful message
      return `
        <div style="${baseStyle} display: flex; align-items: center; justify-content: center; font-size: 0.6em; text-align: center; padding: 8px; background: #fef3c7; color: #92400e; border-radius: 4px; flex-direction: column;">
          <div style="font-weight: bold; margin-bottom: 4px;">📹 Video format not supported in ${browserInfo.name}</div>
          <div style="margin-bottom: 6px;">This .mov file works best in Safari</div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap; justify-content: center;">
            <a href="${src}" target="_blank" style="color: #92400e; text-decoration: underline; font-size: 0.9em;">📥 Download file</a>
            <span style="color: #6b7280;">•</span>
            <span style="font-size: 0.8em; color: #6b7280;">Try Safari browser</span>
          </div>
        </div>
      `;
    } else {
      // Standard video element with additional attributes for better compatibility
      const videoAttributes = isQuickTime
        ? 'controls muted preload="metadata" playsinline'
        : 'controls muted preload="metadata"';

      return `<video style="${baseStyle}" ${videoAttributes}><source src="${src}" type="${mime}">Your browser does not support this video format. <a href="${src}" target="_blank">Download to view</a></video>`;
    }
  }

  /**
   * Get browser information and capabilities
   */
  private getBrowserInfo(): { name: string; supportsMov: boolean } {
    const userAgent = navigator.userAgent.toLowerCase();
    let browserName = "Unknown";

    if (userAgent.includes("safari") && !userAgent.includes("chrome")) {
      browserName = "Safari";
    } else if (userAgent.includes("chrome")) {
      browserName = "Chrome";
    } else if (userAgent.includes("firefox")) {
      browserName = "Firefox";
    } else if (userAgent.includes("edge")) {
      browserName = "Edge";
    }

    // Dynamically test codec support
    const supportsMov = this.canPlayVideoType("video/quicktime");

    return { name: browserName, supportsMov };
  }

  /**
   * Test if browser can play a specific video type
   */
  private canPlayVideoType(mimeType: string): boolean {
    try {
      const video = document.createElement("video");
      const canPlay = video.canPlayType(mimeType);
      // canPlayType returns "probably", "maybe", or ""
      return canPlay === "probably" || canPlay === "maybe";
    } catch {
      return false;
    }
  }

  /**
   * Download a cached blob
   */
  downloadBlob(blobId: string, filename?: string): boolean {
    const cachedData = this.getCachedDataUrl(blobId);
    if (!cachedData) {
      this.requestBlobData(blobId);
      return false;
    }

    const blob = this.getBlob(blobId);
    const downloadName = filename || blob?.local_path || `blob-${blobId}`;

    // Create download link
    const a = document.createElement("a");
    a.href = cachedData;
    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    this.dispatchEvent(
      new CustomEvent("blob-downloaded", {
        detail: { id: blobId, filename: downloadName },
      })
    );

    return true;
  }

  /**
   * View a cached blob in new tab
   */
  viewBlob(blobId: string): boolean {
    const cachedData = this.getCachedDataUrl(blobId);
    if (!cachedData) {
      this.requestBlobData(blobId);
      return false;
    }

    window.open(cachedData, "_blank");

    this.dispatchEvent(
      new CustomEvent("blob-viewed", {
        detail: { id: blobId },
      })
    );

    return true;
  }

  /**
   * Format file size in human-readable format
   */
  /**
   * Determine storage type for a blob
   */
  private getStorageType(blob: MediaBlob): "database" | "disk" {
    // Large files have local_path set (data is stripped by server for efficiency)
    if (blob.local_path) {
      return "disk";
    }
    // Small files have no local_path (data may be stripped by server)
    return "database";
  }

  /**
   * Get full URL for accessing a blob file
   */
  private getFileUrl(blob: MediaBlob): string | undefined {
    if (blob.local_path) {
      // local_path is stored as relative path like "private/uploads/abc123.jpg"
      // Convert to full URL like "http://localhost:8080/private/uploads/abc123.jpg"
      const cleanPath = blob.local_path.startsWith("/")
        ? blob.local_path.substring(1)
        : blob.local_path;
      return `${this.baseUrl}/${cleanPath}`;
    }
    return undefined;
  }

  /**
   * Update base URL for file access
   */
  updateBaseUrl(baseUrl: string): void {
    this.baseUrl = baseUrl.replace(/\/$/, ""); // Remove trailing slash
  }

  private formatFileSize(bytes: number): string {
    if (!bytes) return "Unknown size";

    const units = ["B", "KB", "MB", "GB"];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }

  /**
   * Clear all cached data
   */
  clearCache(): void {
    // Revoke all object URLs to free memory
    for (const dataUrl of this.blobDataCache.values()) {
      URL.revokeObjectURL(dataUrl);
    }

    this.blobDataCache.clear();
    this.loadingBlobs.clear();

    this.dispatchEvent(
      new CustomEvent("cache-cleared", {
        detail: { timestamp: Date.now() },
      })
    );
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    cachedCount: number;
    loadingCount: number;
    totalBlobs: number;
  } {
    return {
      cachedCount: this.blobDataCache.size,
      loadingCount: this.loadingBlobs.size,
      totalBlobs: this.blobs.length,
    };
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.clearCache();
    this.blobs = [];

    // Remove all event listeners
    this.cleanup(); // Use ManagedEventTarget cleanup
  }
}
