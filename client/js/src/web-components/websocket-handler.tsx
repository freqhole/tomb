/**
 * WebSocket Message Handler Web Component
 *
 * A web component that manages WebSocket connections, handles incoming messages,
 * and provides methods for sending messages. Integrates with the WebSocket client
 * and provides a simple interface for media blob handling.
 */

/* @jsxImportSource solid-js */
import { customElement } from "solid-element";
import { createSignal, createEffect, Show, For } from "solid-js";
import { ConnectionStatus, WebSocketStatus } from "./websocket-status";
import "./websocket-status";

// Import types from the client library
import { MediaBlob } from "../lib/websocket-types.js";
import { WebSocketClient } from "../lib/websocket-client.js";

export interface WebSocketHandlerProps {
  websocketUrl?: string;
  autoConnect?: boolean;
  showDebugLog?: boolean;
}

const WebSocketHandler = (props: WebSocketHandlerProps) => {
  const websocketUrl = () => props.websocketUrl || "ws://localhost:3000/ws";
  const autoConnect = () => props.autoConnect !== false;
  const showDebugLog = () => props.showDebugLog || false;

  // State
  const [client, setClient] = createSignal<WebSocketClient | null>(null);
  const [status, setStatus] = createSignal<ConnectionStatus>(
    ConnectionStatus.Disconnected
  );

  const [debugLog, setDebugLog] = createSignal<string[]>([]);
  const [mediaBlobs, setMediaBlobs] = createSignal<MediaBlob[]>([]);
  const [errorMessage, setErrorMessage] = createSignal<string>("");
  const [userCount, setUserCount] = createSignal<number>(0);
  const [isDragOver, setIsDragOver] = createSignal<boolean>(false);
  const [isUploading, setIsUploading] = createSignal<boolean>(false);
  const [uploadProgress, setUploadProgress] = createSignal<string>("");

  // Auto connect effect
  createEffect(() => {
    const shouldAutoConnect = autoConnect();
    const url = websocketUrl();
    if (shouldAutoConnect && url) {
      connect();
    }
  });

  const log = (message: string, ...args: unknown[]) => {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry =
      args.length > 0
        ? `[${timestamp}] ${message}: ${JSON.stringify(args, null, 2)}`
        : `[${timestamp}] ${message}`;

    setDebugLog((prev) => [...prev.slice(-99), logEntry]); // Keep last 100 entries
    console.log("[WebSocketHandler]", message, ...args);
  };

  const updateStatus = (newStatus: ConnectionStatus) => {
    if (status() !== newStatus) {
      setStatus(newStatus);
      log(`Status changed to: ${newStatus}`);

      // Dispatch status change event
      const event = new CustomEvent("status-change", {
        detail: { status: newStatus },
        bubbles: true,
      });

      setTimeout(() => {
        const host = document.querySelector("websocket-handler");
        if (host) {
          host.dispatchEvent(event);
        }
      }, 0);
    }
  };

  const setError = (message: string) => {
    setErrorMessage(message);
    log(`Error: ${message}`);
  };

  const clearError = () => {
    setErrorMessage("");
  };

  const connect = () => {
    if (!websocketUrl()) {
      setError("WebSocket URL not provided");
      return;
    }

    const currentClient = client();
    if (
      currentClient &&
      currentClient.getStatus() === ConnectionStatus.Connected
    ) {
      log("Already connected");
      return;
    }

    clearError();
    updateStatus(ConnectionStatus.Connecting);
    log(`Connecting to ${websocketUrl()}`);

    try {
      const newClient = new WebSocketClient({
        url: websocketUrl(),
        autoReconnect: true,
        debug: props.showDebugLog || false,
      });

      setClient(newClient);
      setupClientListeners(newClient);
      newClient.connect();
    } catch (error) {
      setError(`Connection failed: ${error}`);
      updateStatus(ConnectionStatus.Error);
    }
  };

  const disconnect = () => {
    log("Disconnecting...");

    const currentClient = client();
    if (currentClient) {
      currentClient.disconnect();
      setClient(null);
    }

    updateStatus(ConnectionStatus.Disconnected);
  };

  const setupClientListeners = (wsClient: WebSocketClient) => {
    // eslint-disable-next-line solid/reactivity
    wsClient.on("statusChange", (newStatus) => {
      log("Status changed to:", newStatus);
      updateStatus(newStatus);
      if (newStatus === ConnectionStatus.Connected) {
        clearError();
      }
    });

    wsClient.on("welcome", (data) => {
      log("Welcome received", data);
    });

    wsClient.on("mediaBlobs", (data) => {
      log("Media blobs received:", {
        count: data.blobs.length,
        total_count: data.total_count,
      });
      setMediaBlobs(data.blobs);

      // Dispatch event
      const blobsEvent = new CustomEvent("media-blobs-received", {
        detail: {
          blobs: data.blobs,
          totalCount: data.total_count,
        },
        bubbles: true,
      });
      setTimeout(() => {
        const host = document.querySelector("websocket-handler");
        if (host) {
          host.dispatchEvent(blobsEvent);
        }
      }, 0);
    });

    wsClient.on("mediaBlob", (data) => {
      log("Single media blob received:", data.blob.id);
    });

    wsClient.on("error", (data) => {
      log("Server error:", data.message);
      setError(`Server error: ${data.message}`);
    });

    wsClient.on("connectionStatus", (data) => {
      log("Connection status update:", data);
      setUserCount(data.user_count);
    });

    wsClient.on("parseError", (error) => {
      log("Parse error:", error.message);
      setError(`Message parse error: ${error.message}`);
    });

    // eslint-disable-next-line solid/reactivity
    wsClient.on("rawMessage", () => {
      if (showDebugLog()) {
        log("Raw message received");
      }
    });
  };

  // Public API methods using WebSocketClient
  const ping = () => {
    const currentClient = client();
    if (currentClient) {
      const success = currentClient.ping();
      if (!success) {
        setError("Failed to send ping");
      }
      return success;
    }
    setError("Cannot ping: not connected");
    return false;
  };

  const getMediaBlobs = (limit?: number, offset?: number) => {
    const currentClient = client();
    if (currentClient) {
      const success = currentClient.getMediaBlobs(limit, offset);
      if (!success) {
        setError("Failed to request media blobs");
      }
      return success;
    }
    setError("Cannot get media blobs: not connected");
    return false;
  };

  const getMediaBlob = (id: string) => {
    const currentClient = client();
    if (currentClient) {
      const success = currentClient.getMediaBlob(id);
      if (!success) {
        setError("Failed to request media blob");
      }
      return success;
    }
    setError("Cannot get media blob: not connected");
    return false;
  };

  const uploadMediaBlob = (blob: MediaBlob) => {
    const currentClient = client();
    if (currentClient) {
      const success = currentClient.uploadMediaBlob(blob);
      if (success) {
        log("Sent UploadMediaBlob message", {
          blob_id: blob.id,
          blob_size: blob.size,
          blob_mime: blob.mime,
          blob_sha256: blob.sha256.substring(0, 8) + "...",
        });
      } else {
        setError("Failed to upload media blob");
      }
      return success;
    }
    setError("Cannot upload media blob: not connected");
    return false;
  };

  // File upload helpers
  const calculateSHA256 = async (file: File): Promise<string> => {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  };

  const fileToBlob = async (file: File): Promise<MediaBlob> => {
    const sha256 = await calculateSHA256(file);
    const arrayBuffer = await file.arrayBuffer();
    const data = Array.from(new Uint8Array(arrayBuffer));

    return {
      id: crypto.randomUUID(),
      data,
      sha256,
      size: file.size,
      mime: file.type || "application/octet-stream",
      source_client_id: "web-component",
      local_path: file.name,
      blob_type: "original" as const,
      metadata: {
        originalName: file.name,
        lastModified: file.lastModified,
        uploadedAt: new Date().toISOString(),
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  };

  const uploadFile = async (file: File) => {
    if (!file) return;

    setIsUploading(true);
    setUploadProgress(`Preparing ${file.name}...`);

    try {
      log(`Starting upload for file: ${file.name} (${file.size} bytes)`);

      setUploadProgress("Calculating SHA256...");
      const blob = await fileToBlob(file);

      setUploadProgress("Uploading to server...");
      log("Uploading blob:", {
        id: blob.id,
        size: blob.size,
        mime: blob.mime,
        sha256: blob.sha256.substring(0, 8) + "...",
      });
      const success = uploadMediaBlob(blob);

      if (success) {
        setUploadProgress(`✅ ${file.name} uploaded successfully!`);
        log(`File upload successful: ${file.name}`);
        setTimeout(() => setUploadProgress(""), 3000);
      } else {
        throw new Error("Failed to send upload message");
      }
    } catch (error) {
      const errorMsg = `Upload failed: ${error instanceof Error ? error.message : String(error)}`;
      setUploadProgress(`❌ ${errorMsg}`);
      setError(errorMsg);
      log("Upload error", error);
      setTimeout(() => setUploadProgress(""), 5000);
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileSelect = (event: Event) => {
    const input = event.target as HTMLInputElement;
    const files = input.files;
    if (files && files.length > 0) {
      Array.from(files).forEach(uploadFile);
    }
    // Reset input
    input.value = "";
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

    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      Array.from(files).forEach(uploadFile);
    }
  };

  // Expose methods for external use
  const exposeMethods = () => {
    const element = document.querySelector("websocket-handler");
    if (element) {
      Object.assign(element, {
        ping,
        getMediaBlobs,
        getMediaBlob,
        uploadMediaBlob,
        uploadFile,
        connect,
        disconnect,
      });
    }
  };

  // Expose methods after mount
  createEffect(() => {
    setTimeout(exposeMethods, 0);
  });

  const formatFileSize = (bytes?: number): string => {
    if (!bytes) return "Unknown size";
    const units = ["B", "KB", "MB", "GB"];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
  };

  // Cleanup on unmount
  createEffect(() => {
    return disconnect;
  });

  return (
    <div
      style={{
        display: "block",
        "font-family":
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <style>{`
        .container {
          padding: 16px;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          background: #f9fafb;
        }

        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 16px;
        }

        .title {
          font-size: 18px;
          font-weight: 600;
          color: #111827;
        }

        .controls {
          display: flex;
          gap: 8px;
        }

        button {
          padding: 6px 12px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          background: white;
          color: #374151;
          font-size: 14px;
          cursor: pointer;
          transition: all 0.2s;
        }

        button:hover {
          background: #f3f4f6;
          border-color: #9ca3af;
        }

        button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        button.primary {
          background: #3b82f6;
          color: white;
          border-color: #3b82f6;
        }

        button.primary:hover {
          background: #2563eb;
          border-color: #2563eb;
        }

        .status-section {
          margin-bottom: 16px;
        }

        .debug-log {
          background: #1f2937;
          color: #f3f4f6;
          padding: 12px;
          border-radius: 6px;
          font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
          font-size: 12px;
          max-height: 300px;
          overflow-y: auto;
          white-space: pre-wrap;
          word-break: break-all;
        }

        .media-blobs {
          margin-top: 16px;
        }

        .media-blob {
          padding: 12px;
          border: 1px solid #e5e7eb;
          border-radius: 6px;
          margin-bottom: 8px;
          background: white;
        }

        .media-blob-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }

        .media-blob-id {
          font-family: monospace;
          font-size: 12px;
          color: #6b7280;
        }

        .media-blob-info {
          font-size: 14px;
          color: #374151;
        }

        .media-blob-meta {
          font-size: 12px;
          color: #6b7280;
          margin-top: 4px;
        }

        .empty-state {
          text-align: center;
          color: #6b7280;
          font-style: italic;
          padding: 32px;
        }

        .error-message {
          background: #fef2f2;
          border: 1px solid #fecaca;
          color: #dc2626;
          padding: 12px;
          border-radius: 6px;
          margin-bottom: 16px;
        }

        .file-upload-section {
          margin-top: 16px;
          padding: 16px;
          border: 2px dashed #d1d5db;
          border-radius: 8px;
          background: #f9fafb;
          transition: all 0.2s;
        }

        .file-upload-section.drag-over {
          border-color: #3b82f6;
          background: #eff6ff;
        }

        .file-upload-section.uploading {
          border-color: #10b981;
          background: #ecfdf5;
        }

        .upload-controls {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
        }

        .file-input-wrapper {
          position: relative;
          overflow: hidden;
          display: inline-block;
        }

        .file-input {
          position: absolute;
          left: -9999px;
          opacity: 0;
        }

        .file-input-label {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 10px 20px;
          background: #3b82f6;
          color: white;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
          transition: background 0.2s;
        }

        .file-input-label:hover {
          background: #2563eb;
        }

        .file-input-label:disabled {
          background: #9ca3af;
          cursor: not-allowed;
        }

        .upload-hint {
          color: #6b7280;
          font-size: 14px;
          text-align: center;
          margin: 8px 0;
        }

        .upload-progress {
          color: #374151;
          font-size: 14px;
          font-weight: 500;
          text-align: center;
          padding: 8px;
          background: #f3f4f6;
          border-radius: 4px;
          margin-top: 8px;
        }

        .upload-icon {
          display: inline-block;
          width: 16px;
          height: 16px;
        }
      `}</style>

      <div class="container">
        <div class="header">
          <h2 class="title">WebSocket Handler</h2>
          <div class="controls">
            <button
              onClick={ping}
              disabled={status() !== ConnectionStatus.Connected}
            >
              Ping
            </button>
            <button
              onClick={() => getMediaBlobs()}
              disabled={status() !== ConnectionStatus.Connected}
            >
              Get Media Blobs
            </button>
            <Show
              when={status() === ConnectionStatus.Connected}
              fallback={
                <button onClick={connect} class="primary">
                  Connect
                </button>
              }
            >
              <button onClick={disconnect}>Disconnect</button>
            </Show>
          </div>
        </div>

        <div class="status-section">
          {WebSocketStatus({
            status: status(),
            userCount: userCount(),
            showUserCount: true,
            showText: true,
            compact: false,
          })}
        </div>

        <Show when={errorMessage()}>
          <div class="error-message">{errorMessage()}</div>
        </Show>

        <Show when={showDebugLog()}>
          <div class="debug-log">{debugLog().join("\n")}</div>
        </Show>

        <Show when={status() === ConnectionStatus.Connected}>
          <div
            class={`file-upload-section ${isDragOver() ? "drag-over" : ""} ${isUploading() ? "uploading" : ""}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div class="upload-controls">
              <div class="file-input-wrapper">
                <input
                  type="file"
                  id="file-input"
                  class="file-input"
                  multiple
                  onChange={handleFileSelect}
                  disabled={isUploading()}
                />
                <label
                  for="file-input"
                  class={`file-input-label ${isUploading() ? "disabled" : ""}`}
                >
                  <svg
                    class="upload-icon"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                    />
                  </svg>
                  {isUploading() ? "Uploading..." : "Choose Files"}
                </label>
              </div>

              <div class="upload-hint">
                {isDragOver()
                  ? "Drop files here to upload"
                  : "Drag & drop files here or click to select"}
              </div>

              <Show when={uploadProgress()}>
                <div class="upload-progress">{uploadProgress()}</div>
              </Show>
            </div>
          </div>
        </Show>

        <div class="media-blobs">
          <h3>Media Blobs ({mediaBlobs().length})</h3>
          <Show
            when={mediaBlobs().length > 0}
            fallback={
              <div class="empty-state">
                No media blobs received yet. Click "Get Media Blobs" to fetch
                from server.
              </div>
            }
          >
            <For each={mediaBlobs()}>
              {(blob) => (
                <div class="media-blob">
                  <div class="media-blob-header">
                    <div class="media-blob-id">{blob.id}</div>
                    <div class="media-blob-info">
                      {blob.mime || "Unknown type"} •{" "}
                      {formatFileSize(blob.size)}
                    </div>
                  </div>
                  <div class="media-blob-meta">
                    SHA256: {blob.sha256}
                    <br />
                    Client: {blob.source_client_id || "Unknown"}
                    <br />
                    Path: {blob.local_path || "None"}
                    <br />
                    Created: {new Date(blob.created_at).toLocaleString()}
                    <Show when={Object.keys(blob.metadata).length > 0}>
                      <br />
                      Metadata: {JSON.stringify(blob.metadata)}
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </Show>
        </div>
      </div>
    </div>
  );
};

// Register as custom element
customElement(
  "websocket-handler",
  {
    websocketUrl: "",
    autoConnect: true,
    showDebugLog: true,
  },
  WebSocketHandler
);

export { WebSocketHandler };

/* eslint-disable @typescript-eslint/no-namespace */
declare global {
  namespace JSX {
    interface IntrinsicElements {
      "websocket-handler": {
        websocketUrl?: string;
        autoConnect?: boolean;
        showDebugLog?: boolean;
      };
    }
  }
}
/* eslint-enable @typescript-eslint/no-namespace */
