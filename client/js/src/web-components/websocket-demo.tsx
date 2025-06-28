/**
 * WebSocket Demo Component
 *
 * A simple demo that showcases the modular WebSocket client library
 * components without heavy styling or complex UI logic.
 */

/* @jsxImportSource solid-js */
import { customElement } from "solid-element";
import { createSignal, createEffect, For, Show, onCleanup } from "solid-js";
import { WebSocketDemoClient } from "../lib/websocket-demo-client.js";
import { FileUploadHandler } from "../lib/file-upload.js";
import type { MediaBlob } from "../lib/websocket-types.js";
import type { UploadProgress } from "../lib/file-upload.js";

export interface WebSocketDemoProps {
  websocketUrl?: string;
  autoConnect?: boolean;
  showDebugLog?: boolean;
}

const WebSocketDemo = (props: WebSocketDemoProps) => {
  const [client, setClient] = createSignal<WebSocketDemoClient | null>(null);
  const [status, setStatus] = createSignal("disconnected");
  const [userCount, setUserCount] = createSignal(0);
  const [blobs, setBlobs] = createSignal<MediaBlob[]>([]);
  const [logs, setLogs] = createSignal<string[]>([]);
  const [thumbnailRefresh, setThumbnailRefresh] = createSignal(0);
  const [url, setUrl] = createSignal("ws://localhost:8080/ws");
  const [baseUrl] = createSignal("http://localhost:8080");
  const [isAdmin, setIsAdmin] = createSignal(false);
  const [uploadProgress, setUploadProgress] = createSignal<
    Map<string, UploadProgress>
  >(new Map());
  const [httpUploader, setHttpUploader] =
    createSignal<FileUploadHandler | null>(null);

  // Initialize URL from props
  createEffect(() => {
    const initialUrl = props.websocketUrl;
    if (initialUrl) {
      setUrl(initialUrl);
    }
  });

  // File upload refs
  let smartFileInputRef: HTMLInputElement | undefined;

  // Global function for loading blob data (called from thumbnail onclick)

  (
    window as unknown as { loadBlobData: (blobId: string) => void }
  ).loadBlobData = // eslint-disable-next-line solid/reactivity
    (blobId: string) => {
      client()?.loadBlobData(blobId);
    };

  // Initialize client and HTTP uploader
  createEffect(() => {
    const currentUrl = url();

    const wsClient = new WebSocketDemoClient(currentUrl, {
      logLevel: "info",
      autoGetMediaBlobs: true,
    });

    // Initialize HTTP uploader for large files
    const httpHandler = new FileUploadHandler({
      baseUrl: baseUrl(),
      minFileSize: 10 * 1024 * 1024, // 10MB
      maxFileSize: 1024 * 1024 * 1024, // 1GB
    });

    httpHandler.addEventListener("upload-progress", (e: Event) => {
      const progress = (e as CustomEvent).detail as UploadProgress;
      setUploadProgress((prev) => {
        const newMap = new Map(prev);
        newMap.set(progress.uploadId, progress);
        return newMap;
      });
    });

    setHttpUploader(httpHandler);

    // Set up WebSocket event listeners
    wsClient.addEventListener("status-change", (e: Event) => {
      const { status: newStatus, userCount: newUserCount } = (e as CustomEvent)
        .detail;
      setStatus(newStatus);
      setUserCount(newUserCount || 0);
    });

    wsClient.addEventListener("blobs-updated", (e: Event) => {
      const blobsData = (e as CustomEvent).detail.blobs;
      setBlobs(blobsData);
      // Update MediaBlobManager with current base URL
      wsClient.mediaManager?.updateBaseUrl(baseUrl());
    });

    wsClient.addEventListener("blob-data-cached", () => {
      // Trigger thumbnail refresh
      setThumbnailRefresh((prev) => prev + 1);
    });

    wsClient.addEventListener("log", (e: Event) => {
      const { message, data } = (e as CustomEvent).detail.data;
      const logEntry = data ? `${message}: ${JSON.stringify(data)}` : message;

      setLogs((prev) => [...prev.slice(-49), logEntry]); // Keep last 50 entries
    });

    setClient(wsClient);

    // Check admin status
    fetch("/api/whoami", { credentials: "include" })
      .then((response) => response.json())
      .then((data) => {
        setIsAdmin(data.role === "admin");
      })
      .catch(() => {
        setIsAdmin(false);
      });

    // Auto-connect if requested
    if (props.autoConnect) {
      wsClient.connect().catch(console.error);
    }

    // Cleanup on component unmount
    onCleanup(() => {
      wsClient.destroy();
      httpHandler.cancelAllUploads();
    });
  });

  const handleConnect = () => {
    client()?.connect().catch(console.error);
  };

  const handleDisconnect = () => {
    client()?.disconnect();
  };

  const handlePing = () => {
    client()?.ping();
  };

  const handleGetBlobs = () => {
    client()?.getMediaBlobs();
  };

  const handleFileUpload = (event: Event) => {
    const target = event.target as HTMLInputElement;
    const files = target.files;
    if (files && files.length > 0) {
      handleSmartUpload(Array.from(files));
      target.value = ""; // Reset input
    }
  };

  const handleUploadClick = () => {
    smartFileInputRef?.click();
  };

  const handleSmartUpload = async (files: File[]) => {
    const currentClient = client();
    const currentHttpUploader = httpUploader();

    if (!currentClient || status() !== "connected") {
      console.error("WebSocket not connected");
      return;
    }

    for (const file of files) {
      const fileSize = file.size;
      const is10MBOrLarger = fileSize >= 10 * 1024 * 1024;

      if (is10MBOrLarger) {
        // Large file - use HTTP API (admin only)
        if (!isAdmin()) {
          console.error(
            `File "${file.name}" is ${formatFileSize(fileSize)} which requires admin access`
          );
          continue;
        }

        if (!currentHttpUploader) {
          console.error("HTTP uploader not available");
          continue;
        }

        try {
          const result = await currentHttpUploader.uploadFile(file, {
            uploadedVia: "websocket-demo",
            originalMethod: "http",
            originalName: file.name,
          });
          console.log(`Large file uploaded successfully: ${file.name}`, result);
          // Refresh media blobs to show the new upload
          handleGetBlobs();
          // Clear this upload from progress after success
          setTimeout(() => {
            setUploadProgress((prev) => {
              const newMap = new Map(prev);
              for (const [id, progress] of newMap.entries()) {
                if (progress.stage === "completed") {
                  newMap.delete(id);
                }
              }
              return newMap;
            });
          }, 3000);
        } catch (error) {
          console.error(`Failed to upload large file "${file.name}":`, error);
        }
      } else {
        // Small file - use WebSocket
        try {
          await currentClient.uploadFiles([file]);
          console.log(`Small file uploaded successfully: ${file.name}`);
        } catch (error) {
          console.error(`Failed to upload small file "${file.name}":`, error);
        }
      }
    }
  };

  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    if (event.dataTransfer?.files) {
      handleSmartUpload(Array.from(event.dataTransfer.files));
    }
  };

  const handleDragOver = (event: DragEvent) => {
    event.preventDefault();
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

  const handleDownload = (blobId: string, filename?: string) => {
    client()?.downloadBlob(blobId, filename);
  };

  const handleView = (blobId: string) => {
    client()?.viewBlob(blobId);
  };

  const handleLoadData = (blobId: string) => {
    client()?.loadBlobData(blobId);
  };

  const clearLogs = () => {
    setLogs([]);
    client()?.clearEventLog();
  };

  const getStatusColor = () => {
    switch (status()) {
      case "connected":
        return "#10b981";
      case "connecting":
        return "#f59e0b";
      case "error":
        return "#ef4444";
      default:
        return "#6b7280";
    }
  };

  return (
    <div style={{ padding: "1rem", "font-family": "sans-serif" }}>
      <style>{`
        .demo-section { margin-bottom: 2rem; }
        .controls { display: flex; gap: 0.75rem; margin-bottom: 1rem; flex-wrap: wrap; align-items: center; }
        button {
          padding: 0.5rem 1rem;
          border: 1px solid #ccc;
          background: white;
          color: black;
          cursor: pointer;
          border-radius: 4px;
          font-size: 0.875rem;
          font-weight: 500;
        }
        button:hover:not(:disabled) { background: #f0f0f0; }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
        button.primary { background: #3b82f6; color: white; border-color: #3b82f6; }
        button.primary:hover:not(:disabled) { background: #2563eb; }
        input[type="text"] {
          padding: 0.5rem;
          border: 1px solid #ccc;
          border-radius: 4px;
          min-width: 300px;
          font-size: 0.875rem;
        }
        .status-indicator {
          display: inline-block;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          margin-right: 0.5rem;
        }
        .log-container {
          background: #f8f9fa;
          color: black;
          border: 1px solid #e9ecef;
          border-radius: 4px;
          padding: 1rem;
          max-height: 300px;
          overflow-y: auto;
          font-family: monospace;
          font-size: 0.875rem;
          white-space: pre-wrap;
        }
        .blob-list { display: grid; gap: 1rem; }
        .blob-item {
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 1rem;
          background: white;
          color: black;
        }
        .blob-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 0.5rem;
        }
        .blob-actions { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
        .blob-actions button {
          font-size: 0.75rem;
          padding: 0.25rem 0.5rem;
          font-weight: normal;
        }
        .blob-actions a {
          color: #3b82f6;
          text-decoration: none;
          font-size: 0.75rem;
        }
        .blob-actions a:hover {
          text-decoration: underline;
        }
        .section-title {
          margin: 0 0 1rem 0;
          color: #374151;
          font-weight: 600;
        }
        .empty-state {
          text-align: center;
          padding: 2rem;
          color: #6b7280;
          font-style: italic;
        }
        .smart-upload-zone {
          border: 2px dashed #d1d5db;
          border-radius: 8px;
          padding: 2rem;
          text-align: center;
          margin: 1rem 0;
          background: #fafafa;
          color: black;
          transition: all 0.2s ease;
          cursor: pointer;
        }
        .smart-upload-zone:hover {
          border-color: #3b82f6;
          background: #eff6ff;
        }
        .smart-upload-zone.disabled {
          opacity: 0.5;
          cursor: not-allowed;
          pointer-events: none;
        }
        .upload-status {
          background: #f3f4f6;
          color: black;
          border-radius: 6px;
          padding: 0.75rem;
          margin: 0.5rem 0;
          font-size: 0.875rem;
        }
        .upload-status.success {
          background: #d1fae5;
          color: #065f46;
        }
        .upload-status.error {
          background: #fee2e2;
          color: #991b1b;
        }
        .user-role {
          display: inline-block;
          padding: 0.25rem 0.5rem;
          border-radius: 4px;
          font-size: 0.75rem;
          font-weight: 500;
          margin-left: 0.5rem;
        }
        .user-role.admin {
          background: #d1fae5;
          color: #065f46;
        }
        .user-role.member {
          background: #dbeafe;
          color: #1e40af;
        }
      `}</style>

      <h1>WebSocket Demo (Modular Components)</h1>

      <div class="demo-section">
        <h2 class="section-title">Connection</h2>
        <div class="controls">
          <input
            type="text"
            value={url()}
            onInput={(e) => setUrl(e.target.value)}
            placeholder="WebSocket URL"
            disabled={status() === "connected" || status() === "connecting"}
          />
          <button
            class="primary"
            onClick={handleConnect}
            disabled={status() === "connected" || status() === "connecting"}
          >
            Connect
          </button>
          <button
            onClick={handleDisconnect}
            disabled={status() === "disconnected"}
          >
            Disconnect
          </button>
        </div>

        <div style={{ "margin-bottom": "1rem" }}>
          <span
            class="status-indicator"
            style={{ "background-color": getStatusColor() }}
          />
          Status: {status()}
          <Show when={userCount() > 0}>
            {" "}
            ({userCount()} user{userCount() !== 1 ? "s" : ""} online)
          </Show>
          <span class={`user-role ${isAdmin() ? "admin" : "member"}`}>
            {isAdmin() ? "Admin" : "Member"}
          </span>
        </div>
      </div>

      <div class="demo-section">
        <h2 class="section-title">Smart File Upload</h2>
        <p
          style={{
            color: "#6b7280",
            "margin-bottom": "1rem",
            "font-size": "0.875rem",
          }}
        >
          Drag & drop files or click to select. Files are automatically routed:
          <br />
          • &lt;10MB: WebSocket → Database (any user)
          <br />• ≥10MB: HTTP API → Disk (admin only)
        </p>

        <div
          class={`smart-upload-zone ${status() !== "connected" ? "disabled" : ""}`}
          onClick={handleUploadClick}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
        >
          <div style={{ "font-size": "2rem", "margin-bottom": "0.5rem" }}>
            📁
          </div>
          <div style={{ "font-weight": "500", "margin-bottom": "0.5rem" }}>
            Drop files here or click to upload
          </div>
          <div style={{ "font-size": "0.875rem", color: "#6b7280" }}>
            Smart routing: Small files via WebSocket, large files via HTTP
          </div>
          <Show when={!isAdmin()}>
            <div
              style={{
                "font-size": "0.75rem",
                color: "#dc2626",
                "margin-top": "0.5rem",
              }}
            >
              ⚠️ Large file uploads (≥10MB) require admin privileges
            </div>
          </Show>
        </div>

        <input
          ref={smartFileInputRef}
          type="file"
          multiple
          onChange={handleFileUpload}
          disabled={status() !== "connected"}
          style={{ display: "none" }}
        />

        <div class="controls" style={{ "margin-top": "1rem" }}>
          <button onClick={handlePing} disabled={status() !== "connected"}>
            Ping
          </button>
          <button onClick={handleGetBlobs} disabled={status() !== "connected"}>
            Refresh Media Blobs
          </button>
          <button onClick={clearLogs}>Clear Log</button>
        </div>

        <Show when={uploadProgress().size > 0}>
          <div style={{ "margin-top": "1rem" }}>
            <h3 style={{ "margin-bottom": "0.5rem", "font-size": "1rem" }}>
              Upload Progress ({uploadProgress().size} active)
            </h3>
            <For each={Array.from(uploadProgress().values())}>
              {(progress) => (
                <div
                  class={`upload-status ${progress.stage === "completed" ? "success" : progress.stage === "error" ? "error" : ""}`}
                >
                  {progress.stage === "completed" && "✅ "}
                  {progress.stage === "error" && "❌ "}
                  {progress.stage === "uploading" && "📤 "}
                  {progress.stage}: {progress.progress}%
                  {progress.bytesUploaded && progress.totalBytes && (
                    <span style={{ color: "#6b7280" }}>
                      {" "}
                      ({formatFileSize(progress.bytesUploaded)} /{" "}
                      {formatFileSize(progress.totalBytes)})
                    </span>
                  )}
                  {progress.error && ` - ${progress.error.message}`}
                </div>
              )}
            </For>
            <button
              onClick={() => setUploadProgress(new Map())}
              style={{
                "margin-top": "0.5rem",
                padding: "0.25rem 0.5rem",
                "font-size": "0.75rem",
                background: "#f3f4f6",
                border: "1px solid #d1d5db",
                "border-radius": "4px",
                cursor: "pointer",
              }}
            >
              Clear Progress
            </button>
          </div>
        </Show>
      </div>

      <div class="demo-section">
        <h2 class="section-title">Upload Capabilities</h2>
        <div
          style={{
            display: "grid",
            "grid-template-columns": "1fr 1fr",
            gap: "1rem",
            "margin-bottom": "1rem",
          }}
        >
          <div
            style={{
              background: "#dbeafe",
              padding: "1rem",
              "border-radius": "6px",
              border: "1px solid #93c5fd",
            }}
          >
            <div
              style={{
                "font-weight": "500",
                color: "#1e40af",
                "margin-bottom": "0.5rem",
              }}
            >
              💾 Small Files (&lt;10MB)
            </div>
            <div style={{ "font-size": "0.875rem", color: "#1e40af" }}>
              • Method: WebSocket
              <br />• Storage: Database (BYTEA)
              <br />• Access: Any authenticated user
              <br />• Status:{" "}
              {status() === "connected"
                ? "✅ Available"
                : "❌ Requires connection"}
            </div>
          </div>
          <div
            style={{
              background: isAdmin() ? "#d1fae5" : "#fee2e2",
              padding: "1rem",
              "border-radius": "6px",
              border: isAdmin() ? "1px solid #86efac" : "1px solid #fca5a5",
            }}
          >
            <div
              style={{
                "font-weight": "500",
                color: isAdmin() ? "#065f46" : "#991b1b",
                "margin-bottom": "0.5rem",
              }}
            >
              🗄️ Large Files (≥10MB)
            </div>
            <div
              style={{
                "font-size": "0.875rem",
                color: isAdmin() ? "#065f46" : "#991b1b",
              }}
            >
              • Method: HTTP API
              <br />• Storage: Disk files
              <br />• Access: Admin users only
              <br />• Status: {isAdmin() ? "✅ Available" : "❌ Admin required"}
            </div>
          </div>
        </div>
      </div>

      <div class="demo-section">
        <h2 class="section-title">
          Media Library ({blobs().length} files)
          <span
            style={{
              "font-size": "0.875rem",
              "font-weight": "normal",
              color: "#6b7280",
              "margin-left": "0.5rem",
            }}
          >
            {blobs().filter((b) => b.local_path).length} disk,{" "}
            {blobs().filter((b) => !b.local_path).length} database
          </span>
        </h2>
        <Show
          when={blobs().length > 0}
          fallback={
            <div class="empty-state">
              No media blobs yet. Upload a file or get blobs from server.
            </div>
          }
        >
          <div class="blob-list">
            <For each={blobs()}>
              {(blob) => {
                const displayInfo = () => {
                  // Include refresh signal to make this reactive
                  thumbnailRefresh();
                  return client()?.getBlobDisplayInfo(blob);
                };
                return (
                  <div class="blob-item">
                    <div class="blob-header">
                      <div>
                        <strong>{blob.id}</strong>
                        <br />
                        <small>
                          {displayInfo()?.mime} • {displayInfo()?.size}
                          {/* Show compatibility warning for .mov files */}
                          {blob.mime === "video/quicktime" ||
                          blob.local_path?.toLowerCase().endsWith(".mov") ? (
                            <span
                              style={{
                                background: "#fef3c7",
                                color: "#92400e",
                                padding: "0.125rem 0.5rem",
                                "border-radius": "4px",
                                "font-size": "0.7rem",
                                "font-weight": "500",
                                "margin-left": "0.5rem",
                              }}
                              title="This video format may not play in all browsers (Chrome/Firefox). Works best in Safari."
                            >
                              ⚠️ Limited browser support
                            </span>
                          ) : blob.mime?.startsWith("video/") ? (
                            <span
                              style={{
                                background: "#d1fae5",
                                color: "#065f46",
                                padding: "0.125rem 0.5rem",
                                "border-radius": "4px",
                                "font-size": "0.7rem",
                                "font-weight": "500",
                                "margin-left": "0.5rem",
                              }}
                            >
                              ✅ Web compatible
                            </span>
                          ) : null}
                        </small>
                        <br />
                        <small style={{ color: "#6b7280" }}>
                          {displayInfo()?.storageType === "disk" ? (
                            <span
                              style={{
                                background: "#d1fae5",
                                color: "#065f46",
                                padding: "0.125rem 0.5rem",
                                "border-radius": "4px",
                                "font-size": "0.75rem",
                                "font-weight": "500",
                              }}
                            >
                              🗄️ Disk (Large file)
                            </span>
                          ) : (
                            <span
                              style={{
                                background: "#dbeafe",
                                color: "#1e40af",
                                padding: "0.125rem 0.5rem",
                                "border-radius": "4px",
                                "font-size": "0.75rem",
                                "font-weight": "500",
                              }}
                            >
                              💾 Database (Small file)
                            </span>
                          )}
                        </small>
                      </div>
                      {/* eslint-disable-next-line solid/no-innerhtml */}
                      <div innerHTML={displayInfo()?.thumbnailHtml} />
                    </div>
                    <div>
                      <small style={{ color: "#6b7280" }}>
                        {blob.local_path ? (
                          <>
                            Path: {blob.local_path}
                            <br />
                            <a
                              href={displayInfo()?.fileUrl}
                              target="_blank"
                              rel="noopener"
                              style={{
                                color: "#3b82f6",
                                "text-decoration": "none",
                              }}
                            >
                              🔗 Direct file access
                            </a>
                          </>
                        ) : (
                          "Stored in database"
                        )}
                        <br />
                        Created: {new Date(blob.created_at).toLocaleString()}
                        <br />
                        Source: {blob.source_client_id || "Unknown"}
                      </small>
                    </div>
                    <div class="blob-actions">
                      <Show when={displayInfo()?.storageType === "disk"}>
                        <button
                          onClick={() =>
                            window.open(displayInfo()?.fileUrl, "_blank")
                          }
                          style={{
                            background: "#10b981",
                            color: "white",
                            border: "none",
                          }}
                        >
                          🚀 Open File
                        </button>
                      </Show>
                      <button
                        onClick={() =>
                          handleDownload(blob.id, blob.local_path || undefined)
                        }
                      >
                        📥 Download
                      </button>
                      <Show when={displayInfo()?.storageType === "database"}>
                        <button onClick={() => handleView(blob.id)}>
                          👁️ Preview
                        </button>
                        <button onClick={() => handleLoadData(blob.id)}>
                          📊 Load Data
                        </button>
                      </Show>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
      </div>

      <Show when={props.showDebugLog}>
        <div class="demo-section">
          <h2 class="section-title">Debug Log</h2>
          <div class="controls">
            <button onClick={clearLogs}>Clear Log</button>
          </div>
          <div class="log-container">
            <For each={logs()}>{(log) => <div>{log}</div>}</For>
            <Show when={logs().length === 0}>
              <div style={{ color: "#6b7280", "font-style": "italic" }}>
                No log entries yet...
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
};

// Register as custom element
customElement(
  "websocket-demo",
  {
    websocketUrl: "ws://localhost:8080/ws",
    autoConnect: false,
    showDebugLog: true,
  },
  WebSocketDemo
);

export { WebSocketDemo };

/* eslint-disable @typescript-eslint/no-namespace */
declare global {
  namespace JSX {
    interface IntrinsicElements {
      "websocket-demo": {
        websocketUrl?: string;
        autoConnect?: boolean;
        showDebugLog?: boolean;
      };
    }
  }
}
/* eslint-enable @typescript-eslint/no-namespace */
