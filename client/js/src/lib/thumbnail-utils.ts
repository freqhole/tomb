/**
 * Comprehensive thumbnail utilities for MediaBlob handling
 * Framework-agnostic functions for thumbnail generation, caching, and display
 */

export interface MediaBlob {
  id: string;
  mime?: string;
  blob_type: string;
  size: number;
  parent_id?: string;
  local_path?: string;
  created_at: string;
  updated_at: string;
  filename?: string;
  sha256?: string;
  metadata?: any;
  data?: number[]; // Binary data as array of bytes
}

export interface ThumbnailInfo {
  id: string;
  mime?: string;
  data?: number[];
  blob_type: string;
  size?: number;
}

export interface ThumbnailOptions {
  size?: number;
  quality?: number;
  format?: "webp" | "jpeg" | "png";
  fallbackIcon?: string;
  placeholderColor?: string;
}

export interface ThumbnailState {
  isLoading: boolean;
  hasError: boolean;
  url: string | null;
  errorMessage?: string;
}

/**
 * Create a data URL from binary data array
 */
export function createDataUrl(data: number[], mimeType: string): string {
  const uint8Array = new Uint8Array(data);
  const blob = new Blob([uint8Array], { type: mimeType });
  return URL.createObjectURL(blob);
}

/**
 * Create a data URL with automatic cleanup
 */
export function createTemporaryDataUrl(
  data: number[],
  mimeType: string,
  autoRevokeMs: number = 60000
): string {
  const url = createDataUrl(data, mimeType);

  // Auto-cleanup after specified time
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, autoRevokeMs);

  return url;
}

/**
 * Extract thumbnails from MediaBlob metadata
 */
export function getThumbnails(item: MediaBlob): ThumbnailInfo[] {
  if (!item.metadata) return [];

  const thumbnails = item.metadata.thumbnails;
  if (!Array.isArray(thumbnails)) return [];

  return thumbnails.filter(
    (thumb): thumb is ThumbnailInfo =>
      thumb && typeof thumb === "object" && typeof thumb.id === "string"
  );
}

/**
 * Check if a MediaBlob has thumbnails
 */
export function hasThumbnails(item: MediaBlob): boolean {
  if (item.metadata?.has_thumbnails === true) return true;
  return getThumbnails(item).length > 0;
}

/**
 * Check if a MediaBlob supports thumbnail generation
 */
export function supportsThumbnails(item: MediaBlob): boolean {
  const mime = item.mime?.toLowerCase();
  if (!mime) return false;

  // Images
  if (mime.startsWith("image/")) {
    return [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/gif",
      "image/webp",
      "image/bmp",
      "image/tiff",
    ].includes(mime);
  }

  // Videos
  if (mime.startsWith("video/")) {
    return [
      "video/mp4",
      "video/webm",
      "video/avi",
      "video/mov",
      "video/mkv",
      "video/wmv",
    ].includes(mime);
  }

  // PDFs
  if (mime === "application/pdf") return true;

  return false;
}

/**
 * Get the primary thumbnail URL for a MediaBlob
 */
export function getThumbnailUrl(
  item: MediaBlob,
  apiBaseUrl: string = "",
  options: ThumbnailOptions = {}
): string | null {
  const thumbnails = getThumbnails(item);

  if (thumbnails.length === 0) return null;

  const primaryThumbnail = thumbnails[0];
  if (!primaryThumbnail) return null;

  // If we have binary data, create a data URL
  if (primaryThumbnail.data && primaryThumbnail.data.length > 0) {
    const mimeType = primaryThumbnail.mime || "image/webp";
    return createDataUrl(primaryThumbnail.data, mimeType);
  }

  // Fallback to API endpoint
  const baseUrl = apiBaseUrl.replace(/\/$/, ""); // Remove trailing slash
  const sizeParam = options.size ? `?size=${options.size}` : "";
  return `${baseUrl}/api/media-blobs/${primaryThumbnail.id}/download${sizeParam}`;
}

/**
 * Get all thumbnail URLs for a MediaBlob
 */
export function getAllThumbnailUrls(
  item: MediaBlob,
  apiBaseUrl: string = "",
  options: ThumbnailOptions = {}
): string[] {
  const thumbnails = getThumbnails(item);

  return thumbnails.map((thumbnail) => {
    if (thumbnail.data && thumbnail.data.length > 0) {
      const mimeType = thumbnail.mime || "image/webp";
      return createDataUrl(thumbnail.data, mimeType);
    }

    const baseUrl = apiBaseUrl.replace(/\/$/, "");
    const sizeParam = options.size ? `?size=${options.size}` : "";
    return `${baseUrl}/api/media-blobs/${thumbnail.id}/download${sizeParam}`;
  });
}

/**
 * Get thumbnail preview URL with fallback logic
 */
export function getThumbnailPreviewUrl(
  item: MediaBlob,
  apiBaseUrl: string = "",
  options: ThumbnailOptions = {}
): string | null {
  // First try to get a thumbnail
  const thumbnailUrl = getThumbnailUrl(item, apiBaseUrl, options);
  if (thumbnailUrl) return thumbnailUrl;

  // For displayable images, use the original image as thumbnail
  if (isDisplayableImage(item)) {
    const baseUrl = apiBaseUrl.replace(/\/$/, "");
    return `${baseUrl}/api/media-blobs/${item.id}/download`;
  }

  return null;
}

/**
 * Check if MediaBlob is a displayable image
 */
export function isDisplayableImage(item: MediaBlob): boolean {
  const mime = item.mime?.toLowerCase();
  return !!(
    mime &&
    (mime === "image/jpeg" ||
      mime === "image/jpg" ||
      mime === "image/png" ||
      mime === "image/gif" ||
      mime === "image/webp" ||
      mime === "image/svg+xml")
  );
}

/**
 * Generate a thumbnail request URL for the API
 */
export function generateThumbnailRequestUrl(
  itemId: string,
  apiBaseUrl: string = "",
  options: ThumbnailOptions = {}
): string {
  const baseUrl = apiBaseUrl.replace(/\/$/, "");
  const params = new URLSearchParams();

  if (options.size) params.set("size", options.size.toString());
  if (options.quality) params.set("quality", options.quality.toString());
  if (options.format) params.set("format", options.format);

  const queryString = params.toString();
  return `${baseUrl}/api/media-blobs/${itemId}/thumbnail${queryString ? `?${queryString}` : ""}`;
}

/**
 * Create a placeholder thumbnail data URL
 */
export function createPlaceholderThumbnail(
  width: number = 120,
  height: number = 120,
  backgroundColor: string = "#374151",
  textColor: string = "#9CA3AF",
  text: string = "📄"
): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    // Fallback for environments without canvas
    return `data:image/svg+xml;base64,${btoa(`
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="${backgroundColor}"/>
        <text x="50%" y="50%" text-anchor="middle" dy="0.35em" font-size="24" fill="${textColor}">${text}</text>
      </svg>
    `)}`;
  }

  // Fill background
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, width, height);

  // Draw text/icon
  ctx.fillStyle = textColor;
  ctx.font = `${Math.min(width, height) * 0.4}px Arial`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, width / 2, height / 2);

  return canvas.toDataURL("image/png");
}

/**
 * Create a loading placeholder thumbnail
 */
export function createLoadingPlaceholder(
  width: number = 120,
  height: number = 120
): string {
  return createPlaceholderThumbnail(width, height, "#1F2937", "#6B7280", "⏳");
}

/**
 * Create an error placeholder thumbnail
 */
export function createErrorPlaceholder(
  width: number = 120,
  height: number = 120
): string {
  return createPlaceholderThumbnail(width, height, "#DC2626", "#FFFFFF", "❌");
}

/**
 * Get file type icon for thumbnail fallback
 */
export function getThumbnailFallbackIcon(mimeType?: string): string {
  if (!mimeType) return "📄";

  if (mimeType.startsWith("image/")) return "🖼️";
  if (mimeType.startsWith("video/")) return "🎥";
  if (mimeType.startsWith("audio/")) return "🎵";
  if (mimeType.startsWith("text/")) return "📝";
  if (mimeType.includes("pdf")) return "📕";
  if (mimeType.includes("zip") || mimeType.includes("archive")) return "📦";
  if (mimeType.includes("json") || mimeType.includes("xml")) return "🔧";

  return "📄";
}

/**
 * Thumbnail cache management
 */
export class ThumbnailCache {
  private cache = new Map<string, string>();
  private maxSize: number;
  private accessOrder = new Map<string, number>();
  private accessCounter = 0;

  constructor(maxSize: number = 100) {
    this.maxSize = maxSize;
  }

  get(key: string): string | undefined {
    const value = this.cache.get(key);
    if (value) {
      this.accessOrder.set(key, ++this.accessCounter);
    }
    return value;
  }

  set(key: string, value: string): void {
    // Remove oldest entries if cache is full
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictOldest();
    }

    this.cache.set(key, value);
    this.accessOrder.set(key, ++this.accessCounter);
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  delete(key: string): boolean {
    this.accessOrder.delete(key);
    return this.cache.delete(key);
  }

  clear(): void {
    // Revoke all object URLs to prevent memory leaks
    for (const url of this.cache.values()) {
      if (url.startsWith("blob:")) {
        URL.revokeObjectURL(url);
      }
    }
    this.cache.clear();
    this.accessOrder.clear();
  }

  private evictOldest(): void {
    let oldestKey = "";
    let oldestAccess = Infinity;

    for (const [key, access] of this.accessOrder) {
      if (access < oldestAccess) {
        oldestAccess = access;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      const url = this.cache.get(oldestKey);
      if (url && url.startsWith("blob:")) {
        URL.revokeObjectURL(url);
      }
      this.delete(oldestKey);
    }
  }

  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate:
        this.accessCounter > 0 ? this.cache.size / this.accessCounter : 0,
    };
  }
}

/**
 * Global thumbnail cache instance
 */
export const thumbnailCache = new ThumbnailCache(100);

/**
 * Enhanced thumbnail manager with caching and loading states
 */
export class ThumbnailManager {
  private cache: ThumbnailCache;
  private loadingStates = new Map<string, Promise<string>>();
  private errorStates = new Set<string>();

  constructor(cache?: ThumbnailCache) {
    this.cache = cache || thumbnailCache;
  }

  async getThumbnail(
    item: MediaBlob,
    apiBaseUrl: string = "",
    options: ThumbnailOptions = {}
  ): Promise<string> {
    const cacheKey = this.getCacheKey(item.id, options);

    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    // Check if already loading
    const loading = this.loadingStates.get(cacheKey);
    if (loading) return loading;

    // Check if previously errored
    if (this.errorStates.has(cacheKey)) {
      return this.getFallbackUrl(item, options);
    }

    // Start loading
    const loadPromise = this.loadThumbnail(item, apiBaseUrl, options, cacheKey);
    this.loadingStates.set(cacheKey, loadPromise);

    try {
      const url = await loadPromise;
      this.cache.set(cacheKey, url);
      return url;
    } catch (error) {
      this.errorStates.add(cacheKey);
      return this.getFallbackUrl(item, options);
    } finally {
      this.loadingStates.delete(cacheKey);
    }
  }

  private async loadThumbnail(
    item: MediaBlob,
    apiBaseUrl: string,
    options: ThumbnailOptions,
    _cacheKey: string
  ): Promise<string> {
    // Try to get existing thumbnail URL
    const existingUrl = getThumbnailUrl(item, apiBaseUrl, options);
    if (existingUrl) return existingUrl;

    // If item supports thumbnails but doesn't have them, we could request generation
    // For now, return fallback
    throw new Error("No thumbnail available");
  }

  private getFallbackUrl(item: MediaBlob, options: ThumbnailOptions): string {
    // For displayable images, try the original
    if (isDisplayableImage(item)) {
      return (
        getThumbnailPreviewUrl(item, "", options) ||
        createPlaceholderThumbnail(
          options.size,
          options.size,
          options.placeholderColor,
          "#9CA3AF",
          options.fallbackIcon || getThumbnailFallbackIcon(item.mime)
        )
      );
    }

    // Return placeholder
    return createPlaceholderThumbnail(
      options.size,
      options.size,
      options.placeholderColor,
      "#9CA3AF",
      options.fallbackIcon || getThumbnailFallbackIcon(item.mime)
    );
  }

  private getCacheKey(itemId: string, options: ThumbnailOptions): string {
    const optionsStr = JSON.stringify(options);
    return `${itemId}:${optionsStr}`;
  }

  clearCache(): void {
    this.cache.clear();
    this.loadingStates.clear();
    this.errorStates.clear();
  }

  isLoading(itemId: string, options: ThumbnailOptions = {}): boolean {
    const cacheKey = this.getCacheKey(itemId, options);
    return this.loadingStates.has(cacheKey);
  }

  hasError(itemId: string, options: ThumbnailOptions = {}): boolean {
    const cacheKey = this.getCacheKey(itemId, options);
    return this.errorStates.has(cacheKey);
  }
}

/**
 * Global thumbnail manager instance
 */
export const thumbnailManager = new ThumbnailManager();

/**
 * Cleanup utility - call this when component unmounts or app shuts down
 */
export function cleanupThumbnails(): void {
  thumbnailCache.clear();
  thumbnailManager.clearCache();
}
