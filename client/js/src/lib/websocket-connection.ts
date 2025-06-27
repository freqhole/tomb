/**
 * WebSocket Connection Manager
 *
 * Provides a clean, event-driven interface for WebSocket connections
 * with automatic reconnection, status tracking, and message handling.
 * Uses Zod schemas for type-safe message validation.
 */

import type { MediaBlob } from "./websocket-types.js";
import {
  WebSocketMessage,
  validateIncomingMessage,
  validateOutgoingMessage,
  createMessage,
} from "./websocket-types.js";
import { ManagedEventTarget } from "./event-utils.js";

export type WebSocketConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface ConnectionStatusEvent {
  status: WebSocketConnectionStatus;
  userCount?: number;
  connectionId?: string;
  timestamp: number;
}

export interface WebSocketConnectionOptions {
  url: string;
  autoReconnect?: boolean;
  reconnectDelay?: number;
  maxReconnectAttempts?: number;
  pingInterval?: number;
  debug?: boolean;
}

export class WebSocketConnection extends ManagedEventTarget {
  private socket: WebSocket | null = null;
  private status: WebSocketConnectionStatus = "disconnected";
  private options: Required<WebSocketConnectionOptions>;
  private reconnectAttempts = 0;
  private reconnectTimer?: number;
  private pingTimer?: number;
  private connectionId = "";
  private userCount = 0;

  constructor(options: WebSocketConnectionOptions) {
    super();

    this.options = {
      autoReconnect: true,
      reconnectDelay: 3000,
      maxReconnectAttempts: 5,
      pingInterval: 30000,
      debug: false,
      ...options,
    };
  }

  /**
   * Connect to the WebSocket server
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      this.setStatus("connecting");

      try {
        this.socket = new WebSocket(this.options.url);
        this.setupSocketListeners(resolve, reject);
      } catch (error) {
        this.setStatus("error");
        reject(error);
      }
    });
  }

  /**
   * Disconnect from the WebSocket server
   */
  disconnect(): void {
    this.clearTimers();
    this.options.autoReconnect = false; // Disable auto-reconnect for manual disconnect

    if (this.socket) {
      this.socket.close(1000, "Manual disconnect");
    }
  }

  /**
   * Send a message to the server with validation
   */
  send(message: WebSocketMessage): boolean {
    if (!this.isConnected()) {
      this.dispatchEvent(
        new CustomEvent("error", {
          detail: { error: "Cannot send message: not connected" },
        })
      );
      return false;
    }

    // Validate outgoing message
    const validation = validateOutgoingMessage(message);
    if (!validation.success) {
      const error = `Message validation failed: ${validation.error}`;
      this.log("error", error, validation.details);
      this.dispatchEvent(
        new CustomEvent("validation-error", {
          detail: { error, details: validation.details, message },
        })
      );
      return false;
    }

    try {
      const json = JSON.stringify(validation.data);
      this.socket!.send(json);

      this.log("debug", "Message sent", validation.data);
      this.dispatchEvent(
        new CustomEvent("message-sent", {
          detail: { message: validation.data },
        })
      );

      return true;
    } catch (error) {
      const errorMessage = `Send error: ${error}`;
      this.log("error", errorMessage);
      this.dispatchTypedEvent("error", {
        error: errorMessage,
      });
      return false;
    }
  }

  /**
   * Send a ping message
   */
  ping(): void {
    this.send(createMessage.ping());
  }

  /**
   * Check if currently connected
   */
  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  /**
   * Get current connection status
   */
  getStatus(): WebSocketConnectionStatus {
    return this.status;
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

  private setStatus(status: WebSocketConnectionStatus): void {
    if (this.status === status) return;

    this.status = status;

    const event: ConnectionStatusEvent = {
      status,
      userCount: this.userCount,
      connectionId: this.connectionId,
      timestamp: Date.now(),
    };

    this.dispatchEvent(
      new CustomEvent("status-change", {
        detail: event,
      })
    );
  }

  private setupSocketListeners(
    resolve: () => void,
    reject: (error: unknown) => void
  ): void {
    if (!this.socket) return;

    this.socket.onopen = () => {
      this.setStatus("connected");
      this.reconnectAttempts = 0;
      this.setupPingTimer();
      resolve();
    };

    this.socket.onclose = (event) => {
      this.clearTimers();
      this.setStatus("disconnected");
      this.socket = null;

      this.dispatchTypedEvent("connection-closed", {
        code: event.code,
        reason: event.reason,
      });

      // Attempt reconnection if enabled
      if (
        this.options.autoReconnect &&
        this.reconnectAttempts < this.options.maxReconnectAttempts
      ) {
        this.scheduleReconnect();
      }
    };

    this.socket.onerror = (error) => {
      this.setStatus("error");

      this.dispatchEvent(
        new CustomEvent("connection-error", {
          detail: { error },
        })
      );

      if (this.reconnectAttempts === 0) {
        reject(error);
      }
    };

    this.socket.onmessage = (event) => {
      this.handleMessage(event.data);
    };
  }

  private handleMessage(rawMessage: string): void {
    this.log("debug", "Raw message received", { length: rawMessage.length });

    // Validate and parse incoming message
    const validation = validateIncomingMessage(rawMessage);

    if (!validation.success) {
      const error = `Message validation failed: ${validation.error}`;
      this.log("error", error, validation.details);
      this.dispatchEvent(
        new CustomEvent("validation-error", {
          detail: {
            error,
            details: validation.details,
            rawMessage,
            messageLength: rawMessage.length,
          },
        })
      );
      return;
    }

    const response = validation.data;
    this.log("debug", "Message parsed successfully", response);

    // Handle built-in message types
    switch (response.type) {
      case "Welcome": {
        this.connectionId = response.data.connection_id;
        this.log("info", "Welcome received", {
          connectionId: this.connectionId,
        });
        break;
      }

      case "ConnectionStatus": {
        this.userCount = response.data.user_count;
        this.log("info", "Connection status updated", {
          userCount: this.userCount,
        });
        // Re-emit status change with updated user count
        this.setStatus(this.status);
        break;
      }

      case "Pong": {
        this.log("debug", "Pong received");
        this.dispatchTypedEvent("pong", {
          timestamp: Date.now(),
        });
        break;
      }

      case "Error": {
        const errorMessage = response.data.message;
        this.log("error", "Server error received", { error: errorMessage });
        this.dispatchEvent(
          new CustomEvent("server-error", {
            detail: { error: errorMessage, code: response.data.code },
          })
        );
        break;
      }

      case "MediaBlobs": {
        this.log("info", "Media blobs received", {
          count: response.data.blobs.length,
        });
        break;
      }

      case "MediaBlob": {
        this.log("info", "Media blob received", { id: response.data.blob.id });
        break;
      }

      case "MediaBlobData": {
        this.log("info", "Media blob data received", { id: response.data.id });
        break;
      }
    }

    // Always emit the validated message for custom handling
    this.dispatchEvent(
      new CustomEvent("message", {
        detail: { message: response, raw: rawMessage },
      })
    );
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts++;

    this.dispatchEvent(
      new CustomEvent("reconnecting", {
        detail: {
          attempt: this.reconnectAttempts,
          maxAttempts: this.options.maxReconnectAttempts,
          delay: this.options.reconnectDelay,
        },
      })
    );

    this.reconnectTimer = window.setTimeout(() => {
      this.connect().catch(() => {
        // Connection will be retried automatically if still under max attempts
      });
    }, this.options.reconnectDelay);
  }

  private setupPingTimer(): void {
    if (this.options.pingInterval > 0) {
      this.pingTimer = window.setInterval(() => {
        if (this.isConnected()) {
          this.ping();
        }
      }, this.options.pingInterval);
    }
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = undefined;
    }
  }

  /**
   * Send typed messages with helper methods
   */
  getMediaBlobs(limit?: number, offset?: number): boolean {
    return this.send(createMessage.getMediaBlobs(limit, offset));
  }

  getMediaBlob(id: string): boolean {
    return this.send(createMessage.getMediaBlob(id));
  }

  getMediaBlobData(id: string): boolean {
    return this.send(createMessage.getMediaBlobData(id));
  }

  uploadMediaBlob(blob: MediaBlob): boolean {
    return this.send(createMessage.uploadMediaBlob(blob));
  }

  private log(
    level: "debug" | "info" | "warn" | "error",
    message: string,
    data?: unknown
  ): void {
    if (!this.options.debug && level === "debug") return;

    const timestamp = new Date().toISOString();
    const logMessage = data
      ? `[${timestamp}] [WebSocketConnection] ${message}: ${JSON.stringify(data)}`
      : `[${timestamp}] [WebSocketConnection] ${message}`;

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

  /**
   * Clean up all event listeners and close connection
   */
  destroy(): void {
    this.disconnect();
    this.cleanup(); // Use ManagedEventTarget cleanup
  }
}
