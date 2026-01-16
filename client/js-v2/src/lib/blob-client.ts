/**
 * Blob API Client
 *
 * Handles fetching blob data from the /api/blobs endpoint.
 * Supports both small blobs (stored in database) and large blobs (stored as files).
 */

import { z } from "zod";

/**
 * Blob metadata schema
 */
export const BlobMetadataSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{7,16}$/, "Must be a 7-16 character hex hash"),
  sha256: z.string(),
  size: z.number().int().optional(),
  mime_type: z.string().optional(),
  source_client_id: z.string().optional(),
  local_path: z.string().nullish(),
  metadata: z.record(z.any()).default({}),
  created_at: z
    .union([z.string().datetime(), z.array(z.any())])
    .transform((val) => (Array.isArray(val) ? new Date().toISOString() : val)),
  updated_at: z
    .union([z.string().datetime(), z.array(z.any())])
    .transform((val) => (Array.isArray(val) ? new Date().toISOString() : val)),
});

export type BlobMetadata = z.infer<typeof BlobMetadataSchema>;

/**
 * Blob error types
 */
export enum BlobErrorType {
  NotFound = "NOT_FOUND",
  Unauthorized = "UNAUTHORIZED",
  Forbidden = "FORBIDDEN",
  NetworkError = "NETWORK_ERROR",
  ServerError = "SERVER_ERROR",
  InvalidResponse = "INVALID_RESPONSE",
}

export class BlobError extends Error {
  constructor(
    public type: BlobErrorType,
    message: string,
    public status?: number,
    public originalError?: Error
  ) {
    super(message);
    this.name = "BlobError";
  }
}

/**
 * Configuration for the blob client
 */
export interface BlobClientConfig {
  /** Base URL for the API (e.g., 'http://localhost:3000') */
  baseUrl: string;
  /** Include credentials in requests (default: true) */
  credentials: boolean;
  /** Timeout for requests in milliseconds (default: 30 seconds) */
  timeoutMs: number;
}

/**
 * Blob API Client for fetching blob data and metadata
 */
export class BlobClient {
  private config: Required<BlobClientConfig>;

  constructor(config: Partial<BlobClientConfig> = {}) {
    this.config = {
      baseUrl: "http://localhost:3000",
      credentials: true,
      timeoutMs: 30_000,
      ...config,
    };
  }

  /**
   * Get blob data as a Blob object
   * Useful for creating object URLs for images, videos, etc.
   */
  async getBlob(id: string): Promise<Blob> {
    const response = await this.fetchBlob(id);
    return response.blob();
  }

  /**
   * Get blob data as an ArrayBuffer
   * Useful for binary data processing
   */
  async getBlobArrayBuffer(id: string): Promise<ArrayBuffer> {
    const response = await this.fetchBlob(id);
    return response.arrayBuffer();
  }

  /**
   * Get blob data as a Uint8Array
   * Useful for binary data manipulation
   */
  async getBlobBytes(id: string): Promise<Uint8Array> {
    const arrayBuffer = await this.getBlobArrayBuffer(id);
    return new Uint8Array(arrayBuffer);
  }

  /**
   * Get blob data as text
   * Only use for text-based blobs
   */
  async getBlobText(id: string): Promise<string> {
    const response = await this.fetchBlob(id);
    return response.text();
  }

  /**
   * Get blob data as JSON
   * Only use for JSON blobs
   */
  async getBlobJson<T = any>(id: string): Promise<T> {
    const response = await this.fetchBlob(id);
    return response.json();
  }

  /**
   * Create an object URL for a blob
   * Remember to call URL.revokeObjectURL when done
   */
  async createBlobUrl(id: string): Promise<string> {
    const blob = await this.getBlob(id);
    return URL.createObjectURL(blob);
  }

  /**
   * Get blob metadata without downloading the actual data
   */
  async getBlobMetadata(id: string): Promise<BlobMetadata> {
    const response = await fetch(
      `${this.config.baseUrl}/api/blobs/${id}/metadata`,
      {
        method: "GET",
        credentials: this.config.credentials ? "include" : "omit",
        signal: AbortSignal.timeout(this.config.timeoutMs),
      }
    );

    if (!response.ok) {
      throw await this.handleErrorResponse(response);
    }

    const result = await response.json();
    return BlobMetadataSchema.parse(result);
  }

  /**
   * Download a blob as a file
   * Triggers browser download with the original filename if available
   */
  async downloadBlob(id: string, filename?: string): Promise<void> {
    const [blob, metadata] = await Promise.all([
      this.getBlob(id),
      this.getBlobMetadata(id),
    ]);

    // Use provided filename or extract from metadata
    const downloadFilename =
      filename || (metadata.metadata as any)?.filename || `blob-${id}`;

    // Create download link
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = downloadFilename;

    // Trigger download
    document.body.appendChild(link);
    link.click();

    // Cleanup
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  /**
   * Check if a blob exists
   */
  async blobExists(id: string): Promise<boolean> {
    try {
      await this.getBlobMetadata(id);
      return true;
    } catch (error) {
      if (error instanceof BlobError && error.type === BlobErrorType.NotFound) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Get blob info for display purposes
   * Returns metadata plus display-friendly information
   */
  async getBlobInfo(id: string): Promise<BlobViewerInfo> {
    const metadata = await this.getBlobMetadata(id);

    return {
      ...metadata,
      display_name: this.getDisplayName(metadata),
      file_extension: this.getFileExtension(metadata),
      formatted_size: this.formatFileSize(metadata.size || 0),
      is_image: this.isImageType(metadata.mime_type),
      is_video: this.isVideoType(metadata.mime_type),
      is_audio: this.isAudioType(metadata.mime_type),
      is_text: this.isTextType(metadata.mime_type),
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<BlobClientConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Private method to fetch blob data
   */
  private async fetchBlob(id: string): Promise<Response> {
    const response = await fetch(`${this.config.baseUrl}/api/blobs/${id}`, {
      method: "GET",
      credentials: this.config.credentials ? "include" : "omit",
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    if (!response.ok) {
      throw await this.handleErrorResponse(response);
    }

    return response;
  }

  /**
   * Handle error responses
   */
  private async handleErrorResponse(response: Response): Promise<BlobError> {
    let errorMessage: string;
    let errorType: BlobErrorType;

    try {
      const errorData = await response.json();
      errorMessage =
        errorData.error || errorData.message || `HTTP ${response.status}`;
    } catch {
      errorMessage = `HTTP ${response.status} ${response.statusText}`;
    }

    switch (response.status) {
      case 401:
        errorType = BlobErrorType.Unauthorized;
        break;
      case 403:
        errorType = BlobErrorType.Forbidden;
        break;
      case 404:
        errorType = BlobErrorType.NotFound;
        break;
      default:
        errorType =
          response.status >= 500
            ? BlobErrorType.ServerError
            : BlobErrorType.NetworkError;
    }

    return new BlobError(errorType, errorMessage, response.status);
  }

  /**
   * Get display name for a blob
   */
  private getDisplayName(metadata: BlobMetadata): string {
    const metadataObj = metadata.metadata as any;
    if (metadataObj?.filename) {
      return metadataObj.filename;
    }
    if (metadataObj?.original_name) {
      return metadataObj.original_name;
    }
    return `Blob ${metadata.id.substring(0, 8)}`;
  }

  /**
   * Get file extension from metadata
   */
  private getFileExtension(metadata: BlobMetadata): string | undefined {
    const metadataObj = metadata.metadata as any;
    if (metadataObj?.filename) {
      const match = metadataObj.filename.match(/\.([^.]+)$/);
      return match ? match[1].toLowerCase() : undefined;
    }

    // Fallback to MIME type
    if (metadata.mime_type) {
      const mimeToExt: Record<string, string> = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/gif": "gif",
        "image/webp": "webp",
        "video/mp4": "mp4",
        "video/webm": "webm",
        "audio/mp3": "mp3",
        "audio/wav": "wav",
        "application/pdf": "pdf",
        "text/plain": "txt",
      };
      return mimeToExt[metadata.mime_type];
    }

    return undefined;
  }

  /**
   * Format file size for display
   */
  private formatFileSize(bytes: number): string {
    if (!bytes) return "0 B";

    const units = ["B", "KB", "MB", "GB", "TB"];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }

  /**
   * Check if MIME type is an image
   */
  private isImageType(mimeType?: string): boolean {
    return mimeType?.startsWith("image/") || false;
  }

  /**
   * Check if MIME type is a video
   */
  private isVideoType(mimeType?: string): boolean {
    return mimeType?.startsWith("video/") || false;
  }

  /**
   * Check if MIME type is audio
   */
  private isAudioType(mimeType?: string): boolean {
    return mimeType?.startsWith("audio/") || false;
  }

  /**
   * Check if MIME type is text
   */
  private isTextType(mimeType?: string): boolean {
    return mimeType?.startsWith("text/") || false;
  }
}

/**
 * Extended blob info for display purposes
 */
export interface BlobViewerInfo extends BlobMetadata {
  display_name: string;
  file_extension?: string;
  formatted_size: string;
  is_image: boolean;
  is_video: boolean;
  is_audio: boolean;
  is_text: boolean;
}

/**
 * Default blob client instance
 */
export const blobClient = new BlobClient();

/**
 * Utility function to create a blob URL with automatic cleanup
 * The URL will be automatically revoked after the specified time
 */
export async function createTemporaryBlobUrl(
  id: string,
  autoRevokeMs = 60_000
): Promise<string> {
  const url = await blobClient.createBlobUrl(id);

  // Auto-cleanup after specified time
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, autoRevokeMs);

  return url;
}

/**
 * Utility function to display a blob in an img element
 */
export async function displayBlobAsImage(
  id: string,
  imgElement: HTMLImageElement
): Promise<void> {
  const metadata = await blobClient.getBlobMetadata(id);

  if (!blobClient["isImageType"](metadata.mime_type)) {
    throw new BlobError(
      BlobErrorType.InvalidResponse,
      "Blob is not an image type"
    );
  }

  const url = await blobClient.createBlobUrl(id);

  imgElement.src = url;
  imgElement.onload = () => URL.revokeObjectURL(url);
  imgElement.onerror = () => URL.revokeObjectURL(url);
}
