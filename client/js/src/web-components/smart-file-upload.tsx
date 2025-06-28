/**
 * Smart File Upload Component
 *
 * Intelligently handles file uploads by routing small files (<10MB) through
 * WebSocket and large files (≥10MB) through HTTP API. Provides unified UI
 * for both upload methods with proper progress tracking and error handling.
 */

/* @jsxImportSource solid-js */
import { customElement } from "solid-element";
import { createSignal, createEffect, For, Show, onCleanup } from "solid-js";
import {
  FileUploadHandler,
  WebSocketFileUploadHandler,
  type UploadProgress,
} from "../lib/index.js";

export interface SmartFileUploadProps {
  /** Base URL for HTTP uploads (default: current origin) */
  baseUrl?: string;
  /** WebSocket connection for small file uploads */
  websocketConnection?: any; // WebSocketClient instance
  /** Maximum file size threshold for WebSocket vs HTTP (default: 10MB) */
  sizeThreshold?: number;
  /** Show debug information */
  showDebug?: boolean;
  /** Allow multiple file selection */
  multiple?: boolean;
  /** Accept file types (MIME types or extensions) */
  accept?: string;
  /** Disabled state */
  disabled?: boolean;
}

interface UploadItem {
  id: string;
  file: File;
  method: "websocket" | "http";
  status: "pending" | "uploading" | "completed" | "error";
  progress: number;
  error?: string;
  result?: any;
}

const SmartFileUpload = (props: SmartFileUploadProps) => {
  const [uploads, setUploads] = createSignal<UploadItem[]>([]);
  const [isDragOver, setIsDragOver] = createSignal(false);
  const [httpUploader, setHttpUploader] =
    createSignal<FileUploadHandler | null>(null);
  const [websocketUploader, setWebsocketUploader] =
    createSignal<WebSocketFileUploadHandler | null>(null);

  const sizeThreshold = () => props.sizeThreshold || 10 * 1024 * 1024; // 10MB
  const baseUrl = () => props.baseUrl || window.location.origin;

  let fileInputRef: HTMLInputElement | undefined;

  // Initialize uploaders
  createEffect(() => {
    // HTTP uploader for large files
    const httpHandler = new FileUploadHandler({
      baseUrl: baseUrl(),
      minFileSize: sizeThreshold(),
      maxFileSize: 1024 * 1024 * 1024, // 1GB
    });

    httpHandler.addEventListener("upload-progress", (e: Event) => {
      const { uploadId, stage, progress, error } = (e as CustomEvent)
        .detail as UploadProgress;
      updateUploadProgress(
        uploadId,
        progress,
        stage === "error" ? "error" : "uploading",
        error?.message
      );
    });

    setHttpUploader(httpHandler);

    // WebSocket uploader for small files
    const wsHandler = new WebSocketFileUploadHandler({
      maxFileSize: sizeThreshold(),
    });

    wsHandler.addEventListener("upload-processed", (e: Event) => {
      const { uploadId, blob } = (e as CustomEvent).detail;
      // Send via WebSocket if connected
      if (props.websocketConnection) {
        const success = props.websocketConnection.uploadMediaBlob(blob);
        if (success) {
          updateUploadProgress(uploadId, 100, "completed");
        } else {
          updateUploadProgress(
            uploadId,
            0,
            "error",
            "Failed to send via WebSocket"
          );
        }
      } else {
        updateUploadProgress(uploadId, 0, "error", "WebSocket not connected");
      }
    });

    wsHandler.addEventListener("upload-error", (e: Event) => {
      const { uploadId, error } = (e as CustomEvent).detail;
      updateUploadProgress(uploadId, 0, "error", error);
    });

    setWebsocketUploader(wsHandler);

    // Cleanup
    onCleanup(() => {
      httpHandler.cancelAllUploads();
      wsHandler.destroy();
    });
  });

  const updateUploadProgress = (
    id: string,
    progress: number,
    status: UploadItem["status"],
    error?: string
  ) => {
    setUploads((prev) =>
      prev.map((upload) =>
        upload.id === id ? { ...upload, progress, status, error } : upload
      )
    );
  };

  const addFiles = async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const newUploads: UploadItem[] = [];

    for (const file of fileArray) {
      const uploadId = crypto.randomUUID();
      const method = file.size >= sizeThreshold() ? "http" : "websocket";

      newUploads.push({
        id: uploadId,
        file,
        method,
        status: "pending",
        progress: 0,
      });
    }

    setUploads((prev) => [...prev, ...newUploads]);

    // Start uploads
    for (const upload of newUploads) {
      if (upload.method === "http") {
        startHttpUpload(upload);
      } else {
        startWebSocketUpload(upload);
      }
    }
  };

  const startHttpUpload = async (upload: UploadItem) => {
    const uploader = httpUploader();
    if (!uploader) return;

    updateUploadProgress(upload.id, 0, "uploading");

    try {
      const result = await uploader.uploadFile(upload.file, {
        uploadedVia: "smart-file-upload",
        originalMethod: "http",
        originalName: upload.file.name,
      });

      updateUploadProgress(upload.id, 100, "completed");

      // Store result
      setUploads((prev) =>
        prev.map((u) => (u.id === upload.id ? { ...u, result } : u))
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      updateUploadProgress(upload.id, 0, "error", errorMessage);
    }
  };

  const startWebSocketUpload = async (upload: UploadItem) => {
    const uploader = websocketUploader();
    if (!uploader) return;

    updateUploadProgress(upload.id, 0, "uploading");

    try {
      await uploader.addFiles([upload.file]);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      updateUploadProgress(upload.id, 0, "error", errorMessage);
    }
  };

  const removeUpload = (id: string) => {
    setUploads((prev) => prev.filter((u) => u.id !== id));
  };

  const clearCompleted = () => {
    setUploads((prev) => prev.filter((u) => u.status !== "completed"));
  };

  const retryUpload = (upload: UploadItem) => {
    if (upload.method === "http") {
      startHttpUpload(upload);
    } else {
      startWebSocketUpload(upload);
    }
  };

  const handleFileSelect = (event: Event) => {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      addFiles(input.files);
      input.value = ""; // Reset input
    }
  };

  const handleDragOver = (event: DragEvent) => {
    event.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (event: DragEvent) => {
    event.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    setIsDragOver(false);

    if (event.dataTransfer?.files) {
      addFiles(event.dataTransfer.files);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  };

  const getMethodLabel = (method: "websocket" | "http"): string => {
    return method === "websocket" ? "WebSocket" : "HTTP API";
  };

  return (
    <div class="smart-file-upload">
      <style>{`
        .smart-file-upload {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          max-width: 600px;
        }

        .upload-zone {
          border: 2px dashed #d1d5db;
          border-radius: 8px;
          padding: 2rem;
          text-align: center;
          cursor: pointer;
          transition: all 0.2s ease;
          background: #fafafa;
        }

        .upload-zone:hover,
        .upload-zone.drag-over {
          border-color: #3b82f6;
          background: #eff6ff;
        }

        .upload-zone.disabled {
          opacity: 0.5;
          cursor: not-allowed;
          pointer-events: none;
        }

        .upload-button {
          background: #3b82f6;
          color: white;
          border: none;
          padding: 0.75rem 1.5rem;
          border-radius: 6px;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.2s ease;
        }

        .upload-button:hover:not(:disabled) {
          background: #2563eb;
        }

        .upload-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .upload-list {
          margin-top: 1.5rem;
        }

        .upload-item {
          border: 1px solid #e5e7eb;
          border-radius: 6px;
          padding: 1rem;
          margin-bottom: 0.75rem;
          background: white;
        }

        .upload-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 0.5rem;
        }

        .upload-info {
          flex: 1;
        }

        .upload-filename {
          font-weight: 500;
          color: #374151;
          margin-bottom: 0.25rem;
        }

        .upload-details {
          font-size: 0.875rem;
          color: #6b7280;
          display: flex;
          gap: 1rem;
          flex-wrap: wrap;
        }

        .upload-method {
          background: #f3f4f6;
          padding: 0.125rem 0.5rem;
          border-radius: 4px;
          font-size: 0.75rem;
          font-weight: 500;
        }

        .upload-method.websocket {
          background: #dbeafe;
          color: #1e40af;
        }

        .upload-method.http {
          background: #d1fae5;
          color: #065f46;
        }

        .upload-progress {
          margin-top: 0.75rem;
        }

        .progress-bar {
          width: 100%;
          height: 6px;
          background: #f3f4f6;
          border-radius: 3px;
          overflow: hidden;
        }

        .progress-fill {
          height: 100%;
          background: #3b82f6;
          transition: width 0.3s ease;
        }

        .progress-fill.completed {
          background: #10b981;
        }

        .progress-fill.error {
          background: #ef4444;
        }

        .upload-status {
          margin-top: 0.5rem;
          font-size: 0.875rem;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .status-text {
          font-weight: 500;
        }

        .status-text.completed {
          color: #059669;
        }

        .status-text.error {
          color: #dc2626;
        }

        .status-text.uploading {
          color: #2563eb;
        }

        .upload-actions {
          display: flex;
          gap: 0.5rem;
        }

        .action-button {
          background: none;
          border: 1px solid #d1d5db;
          padding: 0.25rem 0.5rem;
          border-radius: 4px;
          font-size: 0.75rem;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .action-button:hover {
          background: #f9fafb;
        }

        .action-button.retry {
          border-color: #3b82f6;
          color: #3b82f6;
        }

        .action-button.remove {
          border-color: #ef4444;
          color: #ef4444;
        }

        .controls {
          margin-top: 1rem;
          display: flex;
          gap: 0.75rem;
          flex-wrap: wrap;
        }

        .control-button {
          background: #f9fafb;
          border: 1px solid #d1d5db;
          padding: 0.5rem 1rem;
          border-radius: 4px;
          font-size: 0.875rem;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .control-button:hover {
          background: #f3f4f6;
        }

        .threshold-info {
          margin-top: 1rem;
          padding: 0.75rem;
          background: #f8fafc;
          border-radius: 6px;
          font-size: 0.875rem;
          color: #64748b;
        }

        .hidden {
          display: none;
        }
      `}</style>

      {/* Upload Zone */}
      <div
        class={`upload-zone ${isDragOver() ? "drag-over" : ""} ${props.disabled ? "disabled" : ""}`}
        onClick={() => !props.disabled && fileInputRef?.click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div style={{ "margin-bottom": "1rem", "font-size": "2rem" }}>📁</div>
        <div
          style={{
            "margin-bottom": "0.5rem",
            "font-weight": "500",
            color: "#374151",
          }}
        >
          Drop files here or click to browse
        </div>
        <div
          style={{
            "font-size": "0.875rem",
            color: "#6b7280",
            "margin-bottom": "1rem",
          }}
        >
          Small files (&lt;{formatFileSize(sizeThreshold())}) use WebSocket,
          large files use HTTP API
        </div>
        <button
          class="upload-button"
          disabled={props.disabled}
          onClick={(e) => {
            e.stopPropagation();
            fileInputRef?.click();
          }}
        >
          Select Files
        </button>
      </div>

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        class="hidden"
        multiple={props.multiple !== false}
        accept={props.accept}
        onChange={handleFileSelect}
        disabled={props.disabled}
      />

      {/* Upload List */}
      <Show when={uploads().length > 0}>
        <div class="upload-list">
          <For each={uploads()}>
            {(upload) => (
              <div class="upload-item">
                <div class="upload-header">
                  <div class="upload-info">
                    <div class="upload-filename">{upload.file.name}</div>
                    <div class="upload-details">
                      <span>{formatFileSize(upload.file.size)}</span>
                      <span>{upload.file.type || "Unknown type"}</span>
                      <span class={`upload-method ${upload.method}`}>
                        {getMethodLabel(upload.method)}
                      </span>
                    </div>
                  </div>
                </div>

                <Show when={upload.status !== "pending"}>
                  <div class="upload-progress">
                    <div class="progress-bar">
                      <div
                        class={`progress-fill ${upload.status}`}
                        style={{ width: `${upload.progress}%` }}
                      />
                    </div>
                    <div class="upload-status">
                      <span class={`status-text ${upload.status}`}>
                        {upload.status === "uploading" &&
                          `Uploading... ${upload.progress}%`}
                        {upload.status === "completed" && "✅ Upload completed"}
                        {upload.status === "error" &&
                          `❌ ${upload.error || "Upload failed"}`}
                      </span>
                      <div class="upload-actions">
                        <Show when={upload.status === "error"}>
                          <button
                            class="action-button retry"
                            onClick={() => retryUpload(upload)}
                          >
                            Retry
                          </button>
                        </Show>
                        <button
                          class="action-button remove"
                          onClick={() => removeUpload(upload.id)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </div>

        {/* Controls */}
        <div class="controls">
          <button class="control-button" onClick={clearCompleted}>
            Clear Completed
          </button>
          <span
            style={{
              "font-size": "0.875rem",
              color: "#6b7280",
              "align-self": "center",
            }}
          >
            {uploads().length} total,{" "}
            {uploads().filter((u) => u.status === "completed").length} completed
          </span>
        </div>
      </Show>

      {/* Threshold Info */}
      <Show when={props.showDebug}>
        <div class="threshold-info">
          <strong>Upload Routing:</strong>
          <br />• Files &lt; {formatFileSize(sizeThreshold())}: WebSocket
          (stored in database)
          <br />• Files ≥ {formatFileSize(sizeThreshold())}: HTTP API (stored on
          disk, admin only)
        </div>
      </Show>
    </div>
  );
};

// Register as custom element
customElement(
  "smart-file-upload",
  {
    baseUrl: undefined,
    websocketConnection: undefined,
    sizeThreshold: 10 * 1024 * 1024,
    showDebug: false,
    multiple: true,
    accept: undefined,
    disabled: false,
  },
  SmartFileUpload
);

export { SmartFileUpload };

/* eslint-disable @typescript-eslint/no-namespace */
declare global {
  namespace JSX {
    interface IntrinsicElements {
      "smart-file-upload": {
        baseUrl?: string;
        websocketConnection?: any;
        sizeThreshold?: number;
        showDebug?: boolean;
        multiple?: boolean;
        accept?: string;
        disabled?: boolean;
      };
    }
  }
}
/* eslint-enable @typescript-eslint/no-namespace */
