/**
 * HTTP File Upload Handler
 *
 * Handles large file uploads (>10MB) via HTTP POST to the /api/upload endpoint.
 * This is for admin users only and stores files to disk rather than the database.
 */

import { z } from "zod";

/**
 * Upload request metadata schema
 */
export const UploadRequestSchema = z.object({
  filename: z.string().min(1),
  mime_type: z.string().optional(),
  sha256: z.string().length(64),
  size: z.number().int().positive(),
  metadata: z.record(z.any()).default({}),
});

export type UploadRequest = z.infer<typeof UploadRequestSchema>;

/**
 * Upload response schema
 */
export const UploadResponseSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{7,16}$/, "Must be a 7-16 character hex hash"),
  local_path: z.string().nullish(),
  sha256: z.string(),
  size: z.number().int().positive(),
  mime_type: z.string().optional(),
  created_at: z.string().datetime(),
});

export type UploadResponse = z.infer<typeof UploadResponseSchema>;

/**
 * Upload info schema (for GET endpoints)
 */
export const UploadInfoSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{7,16}$/, "Must be a 7-16 character hex hash"),
  local_path: z.string().nullish(),
  sha256: z.string(),
  size: z.number().int().optional(),
  mime: z.string().optional(),
  source_client_id: z.string().optional(),
  metadata: z.record(z.any()).default({}),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type UploadInfo = z.infer<typeof UploadInfoSchema>;

/**
 * Upload list response schema
 */
export const UploadListResponseSchema = z.object({
  uploads: z.array(UploadInfoSchema),
  total_count: z.number().int().min(0),
  limit: z.number().int().optional(),
  offset: z.number().int().min(0),
});

export type UploadListResponse = z.infer<typeof UploadListResponseSchema>;

/**
 * Upload error types
 */
export enum UploadErrorType {
  FileTooSmall = "FILE_TOO_SMALL",
  FileTooLarge = "FILE_TOO_LARGE",
  InvalidFile = "INVALID_FILE",
  HashCalculationFailed = "HASH_CALCULATION_FAILED",
  NetworkError = "NETWORK_ERROR",
  ServerError = "SERVER_ERROR",
  Unauthorized = "UNAUTHORIZED",
  Forbidden = "FORBIDDEN",
  Conflict = "CONFLICT",
}

export class UploadError extends Error {
  constructor(
    public type: UploadErrorType,
    message: string,
    public originalError?: Error
  ) {
    super(message);
    this.name = "UploadError";
  }
}

/**
 * Upload progress information
 */
export interface UploadProgress {
  uploadId: string;
  stage: "preparing" | "hashing" | "uploading" | "completed" | "error";
  progress: number; // 0-100
  bytesUploaded?: number;
  totalBytes?: number;
  error?: UploadError;
}

/**
 * Upload configuration
 */
export interface UploadConfig {
  /** Base URL for the API (e.g., 'http://localhost:3000') */
  baseUrl: string;
  /** Minimum file size for large uploads (default: 10MB) */
  minFileSize: number;
  /** Maximum file size allowed (default: 1GB) */
  maxFileSize: number;
  /** Timeout for upload requests in milliseconds (default: 5 minutes) */
  timeoutMs: number;
  /** Include credentials in requests (default: true) */
  credentials: boolean;
}

/**
 * HTTP File Upload Handler for large files (>10MB)
 */
export class FileUploadHandler extends EventTarget {
  private config: Required<UploadConfig>;
  private activeUploads = new Map<string, AbortController>();

  constructor(config: Partial<UploadConfig> = {}) {
    super();

    this.config = {
      baseUrl: "http://localhost:3000",
      minFileSize: 10 * 1024 * 1024, // 10MB
      maxFileSize: 1024 * 1024 * 1024, // 1GB
      timeoutMs: 5 * 60 * 1000, // 5 minutes
      credentials: true,
      ...config,
    };
  }

  /**
   * Upload a large file
   */
  async uploadFile(
    file: File,
    metadata: Record<string, any> = {}
  ): Promise<UploadResponse> {
    const uploadId = crypto.randomUUID();

    try {
      // Validate file size
      this.validateFile(file);

      // Create abort controller for this upload
      const abortController = new AbortController();
      this.activeUploads.set(uploadId, abortController);

      // Emit progress: preparing
      this.emitProgress({
        uploadId,
        stage: "preparing",
        progress: 0,
        totalBytes: file.size,
      });

      // Calculate SHA256 hash
      this.emitProgress({
        uploadId,
        stage: "hashing",
        progress: 10,
        totalBytes: file.size,
      });

      const sha256 = await this.calculateSHA256(file);

      this.emitProgress({
        uploadId,
        stage: "hashing",
        progress: 50,
        totalBytes: file.size,
      });

      // Prepare upload request
      const uploadRequest: UploadRequest = {
        filename: file.name,
        mime_type: file.type || undefined,
        sha256,
        size: file.size,
        metadata,
      };

      // Validate request
      UploadRequestSchema.parse(uploadRequest);

      this.emitProgress({
        uploadId,
        stage: "uploading",
        progress: 60,
        totalBytes: file.size,
      });

      // Create form data
      const formData = new FormData();
      formData.append("metadata", JSON.stringify(uploadRequest));
      formData.append("file", file);

      // Make upload request
      const response = await fetch(`${this.config.baseUrl}/api/upload`, {
        method: "POST",
        body: formData,
        credentials: this.config.credentials ? "include" : "omit",
        signal: abortController.signal,
      });

      this.emitProgress({
        uploadId,
        stage: "uploading",
        progress: 90,
        bytesUploaded: file.size,
        totalBytes: file.size,
      });

      if (!response.ok) {
        throw await this.handleErrorResponse(response);
      }

      const result = await response.json();
      const uploadResponse = UploadResponseSchema.parse(result);

      this.emitProgress({
        uploadId,
        stage: "completed",
        progress: 100,
        bytesUploaded: file.size,
        totalBytes: file.size,
      });

      return uploadResponse;
    } catch (error) {
      const uploadError =
        error instanceof UploadError
          ? error
          : new UploadError(
              UploadErrorType.ServerError,
              error instanceof Error ? error.message : String(error),
              error instanceof Error ? error : undefined
            );

      this.emitProgress({
        uploadId,
        stage: "error",
        progress: 0,
        error: uploadError,
      });

      throw uploadError;
    } finally {
      this.activeUploads.delete(uploadId);
    }
  }

  /**
   * Get upload information by ID
   */
  async getUploadInfo(id: string): Promise<UploadInfo> {
    const response = await fetch(`${this.config.baseUrl}/api/upload/${id}`, {
      method: "GET",
      credentials: this.config.credentials ? "include" : "omit",
    });

    if (!response.ok) {
      throw await this.handleErrorResponse(response);
    }

    const result = await response.json();
    return UploadInfoSchema.parse(result);
  }

  /**
   * List uploads with pagination
   */
  async listUploads(
    options: { limit?: number; offset?: number } = {}
  ): Promise<UploadListResponse> {
    const searchParams = new URLSearchParams();
    if (options.limit !== undefined) {
      searchParams.set("limit", options.limit.toString());
    }
    if (options.offset !== undefined) {
      searchParams.set("offset", options.offset.toString());
    }

    const url = `${this.config.baseUrl}/api/uploads${searchParams.toString() ? `?${searchParams}` : ""}`;

    const response = await fetch(url, {
      method: "GET",
      credentials: this.config.credentials ? "include" : "omit",
    });

    if (!response.ok) {
      throw await this.handleErrorResponse(response);
    }

    const result = await response.json();
    return UploadListResponseSchema.parse(result);
  }

  /**
   * Delete an upload by ID
   */
  async deleteUpload(id: string): Promise<void> {
    const response = await fetch(`${this.config.baseUrl}/api/upload/${id}`, {
      method: "DELETE",
      credentials: this.config.credentials ? "include" : "omit",
    });

    if (!response.ok) {
      throw await this.handleErrorResponse(response);
    }
  }

  /**
   * Cancel an active upload
   */
  cancelUpload(uploadId: string): boolean {
    const controller = this.activeUploads.get(uploadId);
    if (controller) {
      controller.abort();
      this.activeUploads.delete(uploadId);
      return true;
    }
    return false;
  }

  /**
   * Cancel all active uploads
   */
  cancelAllUploads(): void {
    for (const controller of this.activeUploads.values()) {
      controller.abort();
    }
    this.activeUploads.clear();
  }

  /**
   * Get the number of active uploads
   */
  getActiveUploadCount(): number {
    return this.activeUploads.size;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<UploadConfig>): void {
    this.config = { ...this.config, ...config };
  }

  private validateFile(file: File): void {
    if (file.size < this.config.minFileSize) {
      throw new UploadError(
        UploadErrorType.FileTooSmall,
        `File size ${this.formatFileSize(file.size)} is below the minimum of ${this.formatFileSize(this.config.minFileSize)}`
      );
    }

    if (file.size > this.config.maxFileSize) {
      throw new UploadError(
        UploadErrorType.FileTooLarge,
        `File size ${this.formatFileSize(file.size)} exceeds the maximum of ${this.formatFileSize(this.config.maxFileSize)}`
      );
    }

    if (file.size === 0) {
      throw new UploadError(UploadErrorType.InvalidFile, "File is empty");
    }

    // Check for dangerous filenames
    if (
      file.name.includes("..") ||
      file.name.includes("/") ||
      file.name.includes("\\")
    ) {
      throw new UploadError(UploadErrorType.InvalidFile, "Invalid filename");
    }
  }

  private async calculateSHA256(file: File): Promise<string> {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    } catch (error) {
      throw new UploadError(
        UploadErrorType.HashCalculationFailed,
        "Failed to calculate file hash",
        error instanceof Error ? error : undefined
      );
    }
  }

  private async handleErrorResponse(response: Response): Promise<UploadError> {
    let errorMessage: string;
    let errorType: UploadErrorType;

    try {
      const errorData = await response.json();
      errorMessage =
        errorData.error || errorData.message || `HTTP ${response.status}`;
    } catch {
      errorMessage = `HTTP ${response.status} ${response.statusText}`;
    }

    switch (response.status) {
      case 400:
        errorType = UploadErrorType.InvalidFile;
        break;
      case 401:
        errorType = UploadErrorType.Unauthorized;
        break;
      case 403:
        errorType = UploadErrorType.Forbidden;
        break;
      case 409:
        errorType = UploadErrorType.Conflict;
        break;
      case 413:
        errorType = UploadErrorType.FileTooLarge;
        break;
      default:
        errorType =
          response.status >= 500
            ? UploadErrorType.ServerError
            : UploadErrorType.NetworkError;
    }

    return new UploadError(errorType, errorMessage);
  }

  private emitProgress(progress: UploadProgress): void {
    this.dispatchEvent(
      new CustomEvent("upload-progress", {
        detail: progress,
      })
    );
  }

  private formatFileSize(bytes: number): string {
    if (!bytes) return "0 B";

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
   * Upload a media blob for small files (under 10MB)
   * Uses /api/upload_media_blob endpoint and stores in database
   */
  async uploadMediaBlob(
    file: File,
    metadata: Record<string, any> = {}
  ): Promise<{
    id: string;
    sha256: string;
    size: number;
    mime: string;
    created_at: string;
  }> {
    // Validate file size (must be under 10MB)
    if (file.size >= 10 * 1024 * 1024) {
      throw new UploadError(
        UploadErrorType.FileTooLarge,
        `File size ${this.formatFileSize(file.size)} exceeds maximum of 10MB for media blob upload`
      );
    }

    if (file.size === 0) {
      throw new UploadError(UploadErrorType.InvalidFile, "File is empty");
    }

    const uploadId = crypto.randomUUID();

    try {
      // Create abort controller for this upload
      const abortController = new AbortController();
      this.activeUploads.set(uploadId, abortController);

      // Emit progress: preparing
      this.emitProgress({
        uploadId,
        stage: "preparing",
        progress: 0,
        totalBytes: file.size,
      });

      // Create form data
      const formData = new FormData();
      formData.append("file", file);
      formData.append("filename", file.name);
      if (file.type) {
        formData.append("mime_type", file.type);
      }
      formData.append("metadata", JSON.stringify(metadata));

      console.log("📦 Creating multipart form data:", {
        filename: file.name,
        size: file.size,
        type: file.type,
        metadata: metadata,
      });

      this.emitProgress({
        uploadId,
        stage: "uploading",
        progress: 50,
        totalBytes: file.size,
      });

      // Make upload request
      console.log(
        "📤 Making upload request to:",
        `${this.config.baseUrl}/api/media/upload_media_blob`
      );

      const response = await fetch(
        `${this.config.baseUrl}/api/media/upload_media_blob`,
        {
          method: "POST",
          body: formData,
          credentials: this.config.credentials ? "include" : "omit",
          signal: abortController.signal,
        }
      );

      console.log(
        "📨 Upload response status:",
        response.status,
        response.statusText
      );

      this.emitProgress({
        uploadId,
        stage: "uploading",
        progress: 90,
        bytesUploaded: file.size,
        totalBytes: file.size,
      });

      if (!response.ok) {
        console.error("❌ Upload failed with status:", response.status);
        try {
          const errorText = await response.text();
          console.error("❌ Error response body:", errorText);
        } catch (e) {
          console.error("❌ Could not read error response body:", e);
        }
        throw await this.handleErrorResponse(response);
      }

      const result = await response.json();

      this.emitProgress({
        uploadId,
        stage: "completed",
        progress: 100,
        bytesUploaded: file.size,
        totalBytes: file.size,
      });

      return {
        id: result.id,
        sha256: result.sha256,
        size: result.size || file.size,
        mime: result.mime || file.type,
        created_at: result.created_at,
      };
    } catch (error) {
      const uploadError =
        error instanceof UploadError
          ? error
          : new UploadError(
              UploadErrorType.ServerError,
              error instanceof Error ? error.message : String(error),
              error instanceof Error ? error : undefined
            );

      this.emitProgress({
        uploadId,
        stage: "error",
        progress: 0,
        error: uploadError,
      });

      throw uploadError;
    } finally {
      this.activeUploads.delete(uploadId);
    }
  }

  /**
   * Static helper to check if a file should use HTTP upload
   */
  static shouldUseHttpUpload(file: File, minSize = 10 * 1024 * 1024): boolean {
    return file.size >= minSize;
  }

  /**
   * Static helper to format file sizes
   */
  static formatFileSize(bytes: number): string {
    if (!bytes) return "0 B";

    const units = ["B", "KB", "MB", "GB"];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }
}
