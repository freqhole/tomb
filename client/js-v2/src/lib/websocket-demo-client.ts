/**
 * WebSocket Demo Client
 *
 * A unified client that orchestrates WebSocket connection, media blob management,
 * and file uploads. This provides a high-level interface that combines all the
 * modular components into a cohesive demo client.
 */

import {
  WebSocketClient,
  type WebSocketClientConfig,
} from "./websocket-client.js";
import { ConnectionStatus } from "./websocket-types.js";
import { MediaBlobManager, type MediaBlobData } from "./media-blob-manager.js";
import type { MediaBlob } from "./websocket-types.js";
import {
  WebSocketFileUploadHandler,
  type WebSocketFileUploadOptions,
} from "./websocket-file-upload.js";

export interface WebSocketDemoClientOptions {
  websocket?: WebSocketClientConfig;
  fileUpload?: WebSocketFileUploadOptions;
  autoGetMediaBlobs?: boolean;
  logLevel?: "none" | "error" | "warn" | "info" | "debug";
}

export interface DemoClientEvent {
  type: string;
  timestamp: number;
  data?: unknown;
}

export class WebSocketDemoClient extends EventTarget {
  private client: WebSocketClient;
  private blobManager: MediaBlobManager;
  private uploadHandler: WebSocketFileUploadHandler;
  private eventLog: DemoClientEvent[] = [];
  private options: WebSocketDemoClientOptions;
  private connectionId: string = "";
  private userCount: number = 0;

  constructor(websocketUrl: string, options: WebSocketDemoClientOptions = {}) {
    super();

    this.options = {
      autoGetMediaBlobs: true,
      logLevel: "info",
      ...options,
    };

    // Initialize components
    this.client = new WebSocketClient({
      url: websocketUrl,
      debug: this.options.logLevel === "debug",
      ...this.options.websocket,
    });

    this.blobManager = new MediaBlobManager();

    this.uploadHandler = new WebSocketFileUploadHandler({
      clientId: "demo-client",
      ...this.options.fileUpload,
    });

    this.setupEventHandlers();
  }

  /**
   * Connect to WebSocket server
   */
  async connect(): Promise<void> {
    this.log("info", "Connecting to WebSocket server");
    this.client.connect();
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    this.log("info", "Disconnecting from WebSocket server");
    this.client.disconnect();
  }

  /**
   * Send a ping message
   */
  ping(): void {
    this.log("debug", "Sending ping");
    this.client.ping();
  }

  /**
   * Request media blobs from server
   */
  getMediaBlobs(limit = 10, offset = 0): void {
    this.log(
      "debug",
      `Requesting media blobs (limit: ${limit}, offset: ${offset})`
    );
    this.client.getMediaBlobs(limit, offset);
  }

  /**
   * Upload files
   */
  async uploadFiles(files: FileList | File[]): Promise<string[]> {
    this.log("info", `Starting upload of ${files.length} file(s)`);
    return this.uploadHandler.addFiles(files);
  }

  /**
   * Download a media blob
   */
  downloadBlob(blobId: string, filename?: string): boolean {
    this.log("debug", `Downloading blob: ${blobId}`);
    return this.blobManager.downloadBlob(blobId, filename);
  }

  /**
   * View a media blob in new tab
   */
  viewBlob(blobId: string): boolean {
    this.log("debug", `Viewing blob: ${blobId}`);
    return this.blobManager.viewBlob(blobId);
  }

  /**
   * Load blob data from server
   */
  loadBlobData(blobId: string): void {
    this.log("debug", `Loading blob data: ${blobId}`);
    this.client.getMediaBlobData(blobId);
  }

  /**
   * Get current connection status
   */
  getConnectionStatus(): ConnectionStatus {
    return this.client.getStatus();
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.client.getStatus() === ConnectionStatus.Connected;
  }

  /**
   * Get current user count
   */
  getUserCount(): number {
    return this.userCount;
  }

  /**
   * Get connection ID
   */
  getConnectionId(): string {
    return this.connectionId;
  }

  /**
   * Get all media blobs
   */
  getBlobs(): MediaBlob[] {
    return this.blobManager.getBlobs();
  }

  /**
   * Get blob display info
   */
  getBlobDisplayInfo(blob: MediaBlob) {
    return this.blobManager.getBlobDisplayInfo(blob);
  }

  /**
   * Get the blob manager instance
   */
  get mediaManager(): MediaBlobManager {
    return this.blobManager;
  }

  /**
   * Get upload statistics
   */
  getUploadStats() {
    return this.uploadHandler.getStats();
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return this.blobManager.getCacheStats();
  }

  /**
   * Clear completed uploads
   */
  clearCompletedUploads(): void {
    this.uploadHandler.clearCompleted();
  }

  /**
   * Clear blob cache
   */
  clearBlobCache(): void {
    this.blobManager.clearCache();
  }

  /**
   * Get event log
   */
  getEventLog(): DemoClientEvent[] {
    return [...this.eventLog];
  }

  /**
   * Clear event log
   */
  clearEventLog(): void {
    this.eventLog = [];
    this.dispatchEvent(
      new CustomEvent("log-cleared", {
        detail: { timestamp: Date.now() },
      })
    );
  }

  private setupEventHandlers(): void {
    // WebSocket client events
    this.client.on("statusChange", (status) => {
      this.log("info", `Connection status changed: ${status}`);

      this.dispatchEvent(
        new CustomEvent("status-change", {
          detail: { status },
        })
      );

      // Auto-request media blobs when connected
      if (
        status === ConnectionStatus.Connected &&
        this.options.autoGetMediaBlobs
      ) {
        setTimeout(() => this.getMediaBlobs(), 100);
      }
    });

    this.client.on("welcome", (data) => {
      this.log("info", "Welcome received", data);
      // Extract connection ID from welcome message
      if (data && typeof data === "object" && "connection_id" in data) {
        this.connectionId = String(data.connection_id);
      }
      this.dispatchEvent(new CustomEvent("welcome", { detail: data }));
    });

    this.client.on("error", (data) => {
      this.log("error", "Server error", data);
      this.dispatchEvent(new CustomEvent("server-error", { detail: data }));
    });

    this.client.on("parseError", (error, rawMessage) => {
      this.log("error", "Parse error", { error: error.message, rawMessage });
      this.dispatchEvent(
        new CustomEvent("parse-error", {
          detail: { error: error.message, rawMessage },
        })
      );
    });

    this.client.on("mediaBlobs", (data) => {
      this.handleServerMessage({ type: "MediaBlobs", data });
    });

    this.client.on("mediaBlob", (data) => {
      this.handleServerMessage({ type: "MediaBlob", data });
    });

    this.client.on("mediaBlobData", (data) => {
      this.handleServerMessage({ type: "MediaBlobData", data });
    });

    this.client.on("connectionStatus", (data) => {
      this.handleServerMessage({ type: "ConnectionStatus", data });
      // Extract user count from connection status
      if (data && typeof data === "object" && "user_count" in data) {
        this.userCount = Number(data.user_count) || 0;
      }
    });

    // Media blob manager events
    this.blobManager.addEventListener("blobs-updated", (e: Event) => {
      const detail = (e as CustomEvent).detail;
      this.log("info", `Media blobs updated: ${detail.count} blobs`);
      this.dispatchEvent(new CustomEvent("blobs-updated", { detail }));
    });

    this.blobManager.addEventListener("blob-data-requested", (e: Event) => {
      const { id } = (e as CustomEvent).detail;
      this.client.getMediaBlobData(id);
    });

    this.blobManager.addEventListener("blob-data-cached", (e: Event) => {
      const detail = (e as CustomEvent).detail;
      this.log("debug", `Blob data cached: ${detail.id}`);
      this.dispatchEvent(new CustomEvent("blob-data-cached", { detail }));
    });

    // File upload events
    this.uploadHandler.addEventListener("upload-started", (e: Event) => {
      const { file } = (e as CustomEvent).detail;
      this.log("info", `Upload started: ${file.name}`);
      this.dispatchEvent(
        new CustomEvent("upload-started", { detail: (e as CustomEvent).detail })
      );
    });

    this.uploadHandler.addEventListener("upload-completed", (e: Event) => {
      const { file, blob } = (e as CustomEvent).detail;
      this.log("info", `Upload completed: ${file.name}`);

      // Send the blob to the server
      this.client.uploadMediaBlob(blob);

      this.dispatchEvent(
        new CustomEvent("upload-completed", {
          detail: (e as CustomEvent).detail,
        })
      );
    });

    this.uploadHandler.addEventListener("upload-error", (e: Event) => {
      const { file, error } = (e as CustomEvent).detail;
      this.log("error", `Upload failed: ${file.name}`, { error });
      this.dispatchEvent(
        new CustomEvent("upload-error", { detail: (e as CustomEvent).detail })
      );
    });
  }

  private handleServerMessage(message: { type: string; data?: unknown }): void {
    switch (message.type) {
      case "MediaBlobs": {
        const blobsData = message.data as {
          blobs?: MediaBlob[];
          total_count?: number;
        };
        this.log(
          "info",
          `Received ${blobsData?.blobs?.length || 0} media blobs`
        );
        this.blobManager.updateBlobs(blobsData?.blobs || []);
        break;
      }

      case "MediaBlob": {
        const blobData = message.data as { blob?: MediaBlob };
        const blob = blobData?.blob;
        this.log("info", `Received single media blob: ${blob?.id}`);
        break;
      }

      case "MediaBlobData": {
        const blobData = message.data as MediaBlobData;
        this.log("debug", `Received blob data: ${blobData?.id}`);
        if (blobData) {
          this.blobManager.cacheBlobData(blobData);
        }
        break;
      }

      case "Error": {
        const errorData = message.data as { message?: string };
        const error = errorData?.message || "Server error";
        this.log("error", `Server error: ${error}`);
        this.dispatchEvent(
          new CustomEvent("server-error", {
            detail: { error },
          })
        );
        break;
      }

      default:
        this.log("debug", `Unknown message type: ${message.type}`);
    }

    // Always emit the raw message
    this.dispatchEvent(
      new CustomEvent("message", {
        detail: { message },
      })
    );
  }

  private log(level: string, message: string, data?: unknown): void {
    if (!this.shouldLog(level)) return;

    const event: DemoClientEvent = {
      type: level,
      timestamp: Date.now(),
      data: { message, data },
    };

    this.eventLog.push(event);

    // Keep last 100 entries
    if (this.eventLog.length > 100) {
      this.eventLog = this.eventLog.slice(-100);
    }

    // Emit log event
    this.dispatchEvent(new CustomEvent("log", { detail: event }));

    // Console log
    const timestamp = new Date().toLocaleTimeString();
    const logMessage = data
      ? `[${timestamp}] [WebSocketDemo] ${message}: ${JSON.stringify(data, null, 2)}`
      : `[${timestamp}] [WebSocketDemo] ${message}`;

    switch (level) {
      case "error":
        console.error(logMessage);
        break;
      case "warn":
        console.warn(logMessage);
        break;
      case "debug":
        console.debug(logMessage);
        break;
      default:
        console.log(logMessage);
    }
  }

  private shouldLog(level: string): boolean {
    const levels = ["none", "error", "warn", "info", "debug"];
    const currentLevel = levels.indexOf(this.options.logLevel || "info");
    const messageLevel = levels.indexOf(level);
    return messageLevel <= currentLevel;
  }

  /**
   * Destroy and clean up all resources
   */
  destroy(): void {
    this.log("info", "Destroying WebSocket demo client");

    this.client.disconnect();
    this.blobManager.destroy();
    this.uploadHandler.destroy();

    this.eventLog = [];

    // Remove all event listeners
    const events = [
      "status-change",
      "welcome",
      "blobs-updated",
      "blob-data-cached",
      "upload-started",
      "upload-completed",
      "upload-error",
      "server-error",
      "parse-error",
      "message",
      "log",
      "log-cleared",
    ];
    events.forEach((event) => {
      const listeners =
        (this as unknown as { _listeners?: Record<string, unknown[]> })
          ._listeners?.[event] || [];
      listeners.forEach((listener: unknown) => {
        this.removeEventListener(event, listener as EventListener);
      });
    });
  }
}
