/**
 * WebSocket File Upload Handler
 *
 * Handles file upload processing, validation, SHA256 calculation,
 * and conversion to the blob format expected by the WebSocket server.
 * This is for small files (<10MB) that are sent via WebSocket.
 */

export interface WebSocketUploadFile {
  file: File;
  id: string;
  progress: number;
  status: "pending" | "processing" | "uploading" | "completed" | "error";
  error?: string;
}

export interface WebSocketProcessedBlob {
  data: number[];
  sha256: string;
  size: number;
  mime: string;
  source_client_id: string;
  local_path?: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface WebSocketFileUploadOptions {
  maxFileSize?: number; // in bytes, default 10MB
  allowedMimeTypes?: string[]; // if provided, only these types are allowed
  clientId?: string;
  chunkSize?: number; // for future chunked uploads
}

export class WebSocketFileUploadHandler extends EventTarget {
  private uploads = new Map<string, WebSocketUploadFile>();
  private options: Required<WebSocketFileUploadOptions>;

  constructor(options: WebSocketFileUploadOptions = {}) {
    super();

    this.options = {
      maxFileSize: 10 * 1024 * 1024, // 10MB default
      allowedMimeTypes: [],
      clientId: "web-client",
      chunkSize: 64 * 1024, // 64KB chunks for future use
      ...options,
    };
  }

  /**
   * Add files for upload processing
   */
  async addFiles(files: FileList | File[]): Promise<string[]> {
    const fileArray = Array.from(files);
    const uploadIds: string[] = [];

    for (const file of fileArray) {
      const uploadId = crypto.randomUUID();
      uploadIds.push(uploadId);

      const upload: WebSocketUploadFile = {
        file,
        id: uploadId,
        progress: 0,
        status: "pending",
      };

      this.uploads.set(uploadId, upload);

      // Start processing immediately
      this.processFile(uploadId);
    }

    return uploadIds;
  }

  /**
   * Get upload status
   */
  getUpload(uploadId: string): WebSocketUploadFile | undefined {
    return this.uploads.get(uploadId);
  }

  /**
   * Get all uploads
   */
  getAllUploads(): WebSocketUploadFile[] {
    return Array.from(this.uploads.values());
  }

  /**
   * Remove completed or failed uploads
   */
  clearCompleted(): void {
    for (const [id, upload] of this.uploads.entries()) {
      if (upload.status === "completed" || upload.status === "error") {
        this.uploads.delete(id);
      }
    }

    this.dispatchEvent(
      new CustomEvent("uploads-cleared", {
        detail: { timestamp: Date.now() },
      })
    );
  }

  /**
   * Cancel an upload
   */
  cancelUpload(uploadId: string): void {
    const upload = this.uploads.get(uploadId);
    if (upload && upload.status !== "completed") {
      upload.status = "error";
      upload.error = "Cancelled by user";

      this.dispatchEvent(
        new CustomEvent("upload-cancelled", {
          detail: { uploadId, file: upload.file },
        })
      );
    }
  }

  private async processFile(uploadId: string): Promise<void> {
    const upload = this.uploads.get(uploadId);
    if (!upload) return;

    try {
      upload.status = "processing";
      upload.progress = 0;

      this.dispatchEvent(
        new CustomEvent("upload-started", {
          detail: { uploadId, file: upload.file },
        })
      );

      // Validate file
      this.validateFile(upload.file);
      upload.progress = 10;

      // Read file data
      const arrayBuffer = await this.readFile(upload.file);
      upload.progress = 30;

      // Calculate SHA256
      const sha256 = await this.calculateSHA256(arrayBuffer);
      upload.progress = 60;

      // Convert to processed blob format
      const processedBlob = this.createProcessedBlob(
        upload.file,
        arrayBuffer,
        sha256
      );
      upload.progress = 90;

      upload.status = "uploading";
      upload.progress = 100;

      this.dispatchEvent(
        new CustomEvent("upload-processed", {
          detail: { uploadId, file: upload.file, blob: processedBlob },
        })
      );

      // Mark as completed (actual upload handled externally)
      upload.status = "completed";

      this.dispatchEvent(
        new CustomEvent("upload-completed", {
          detail: { uploadId, file: upload.file, blob: processedBlob },
        })
      );
    } catch (error) {
      upload.status = "error";
      upload.error = error instanceof Error ? error.message : String(error);

      this.dispatchEvent(
        new CustomEvent("upload-error", {
          detail: { uploadId, file: upload.file, error: upload.error },
        })
      );
    }
  }

  private validateFile(file: File): void {
    // Check file size
    if (file.size > this.options.maxFileSize) {
      throw new Error(
        `File "${file.name}" is too large (${this.formatFileSize(file.size)}). Maximum size is ${this.formatFileSize(this.options.maxFileSize)}.`
      );
    }

    // Check MIME type if restrictions are set
    if (this.options.allowedMimeTypes.length > 0) {
      const mimeType = file.type || "application/octet-stream";
      if (!this.options.allowedMimeTypes.includes(mimeType)) {
        throw new Error(
          `File type "${mimeType}" is not allowed. Allowed types: ${this.options.allowedMimeTypes.join(", ")}`
        );
      }
    }

    // Check for empty file
    if (file.size === 0) {
      throw new Error(`File "${file.name}" is empty.`);
    }
  }

  private readFile(file: File): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) {
          resolve(reader.result);
        } else {
          reject(new Error("Failed to read file as ArrayBuffer"));
        }
      };

      reader.onerror = () => {
        reject(
          new Error(
            `Failed to read file: ${reader.error?.message || "Unknown error"}`
          )
        );
      };

      reader.readAsArrayBuffer(file);
    });
  }

  private async calculateSHA256(arrayBuffer: ArrayBuffer): Promise<string> {
    const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  private createProcessedBlob(
    file: File,
    arrayBuffer: ArrayBuffer,
    sha256: string
  ): WebSocketProcessedBlob {
    const data = Array.from(new Uint8Array(arrayBuffer));
    const now = new Date().toISOString();

    return {
      data,
      sha256,
      size: file.size,
      mime: file.type || "application/octet-stream",
      source_client_id: this.options.clientId,
      metadata: {
        originalName: file.name,
        lastModified: file.lastModified,
        uploadedAt: now,
        userAgent: navigator.userAgent,
      },
      created_at: now,
      updated_at: now,
    };
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
   * Get upload statistics
   */
  getStats(): {
    total: number;
    pending: number;
    processing: number;
    uploading: number;
    completed: number;
    errors: number;
  } {
    const uploads = Array.from(this.uploads.values());

    return {
      total: uploads.length,
      pending: uploads.filter((u) => u.status === "pending").length,
      processing: uploads.filter((u) => u.status === "processing").length,
      uploading: uploads.filter((u) => u.status === "uploading").length,
      completed: uploads.filter((u) => u.status === "completed").length,
      errors: uploads.filter((u) => u.status === "error").length,
    };
  }

  /**
   * Update options
   */
  updateOptions(options: Partial<WebSocketFileUploadOptions>): void {
    this.options = { ...this.options, ...options };

    this.dispatchEvent(
      new CustomEvent("options-updated", {
        detail: { options: this.options },
      })
    );
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.uploads.clear();

    // Remove all event listeners
    const events = [
      "upload-started",
      "upload-processed",
      "upload-completed",
      "upload-error",
      "upload-cancelled",
      "uploads-cleared",
      "options-updated",
    ];
    events.forEach((event) => {
      // Remove all listeners for each event type
      const listeners =
        (this as unknown as { _listeners?: Record<string, unknown[]> })
          ._listeners?.[event] || [];
      listeners.forEach((listener: unknown) => {
        this.removeEventListener(event, listener as EventListener);
      });
    });
  }
}
