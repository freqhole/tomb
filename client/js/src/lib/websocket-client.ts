/**
 * WebSocket client for real-time communication with the server
 *
 * Provides type-safe WebSocket communication with automatic reconnection,
 * message parsing, and connection status tracking.
 */

import {
  WebSocketMessage,
  ConnectionStatus,
  safeParseWebSocketResponse,
  createMessage,
  MediaBlob,
  NotificationChannel,
} from "./websocket-types.js";

// Re-export types for convenience
export { ConnectionStatus } from "./websocket-types.js";

export interface WebSocketClientConfig {
  /** WebSocket URL (e.g., 'ws://localhost:3000/ws') */
  url: string;
  /** Automatic reconnection enabled */
  autoReconnect?: boolean;
  /** Reconnection delay in milliseconds */
  reconnectDelay?: number;
  /** Maximum reconnection attempts (0 = infinite) */
  maxReconnectAttempts?: number;
  /** Enable debug logging */
  debug?: boolean;
}

export interface WebSocketClientEvents {
  /** Connection status changed */
  statusChange: (status: ConnectionStatus) => void;
  /** Received welcome message */
  welcome: (data: {
    message: string;
    user_id?: string;
    connection_id: string;
  }) => void;
  /** Received media blobs */
  mediaBlobs: (data: { blobs: MediaBlob[]; total_count: number }) => void;
  /** Received single media blob */
  mediaBlob: (data: { blob: MediaBlob }) => void;
  /** Received media blob data */
  mediaBlobData: (data: { id: string; data: number[]; mime?: string }) => void;
  /** Received error message */
  error: (data: { message: string; code?: string }) => void;
  /** Connection status update from server */
  connectionStatus: (data: { connected: boolean; user_count: number }) => void;
  /** Received notification */
  notification: (data: {
    id: string;
    channel: NotificationChannel;
    event_type: string;
    payload?: any;
    priority: string;
    timestamp: string;
  }) => void;
  /** Notification subscription confirmed */
  notificationSubscribed: (data: { channel: NotificationChannel }) => void;
  /** Notification unsubscription confirmed */
  notificationUnsubscribed: (data: { channel: NotificationChannel }) => void;
  /** Notification status received */
  notificationStatus: (data: {
    subscribed_channels: NotificationChannel[];
    connection_id: string;
    is_authenticated: boolean;
  }) => void;
  /** Raw message received (for debugging) */
  rawMessage: (message: string) => void;
  /** Message parse error */
  parseError: (error: Error, rawMessage: string) => void;
}

export class WebSocketClient {
  private socket: WebSocket | null = null;
  private config: Required<WebSocketClientConfig>;
  private status: ConnectionStatus = ConnectionStatus.Disconnected;
  private listeners: Partial<WebSocketClientEvents> = {};
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private pingInterval: number | null = null;

  constructor(config: WebSocketClientConfig) {
    this.config = {
      autoReconnect: true,
      reconnectDelay: 3000,
      maxReconnectAttempts: 0,
      debug: false,
      ...config,
    };
  }

  /**
   * Add event listener
   */
  on<K extends keyof WebSocketClientEvents>(
    event: K,
    listener: WebSocketClientEvents[K]
  ): void {
    this.listeners[event] = listener;
  }

  /**
   * Remove event listener
   */
  off<K extends keyof WebSocketClientEvents>(event: K): void {
    delete this.listeners[event];
  }

  /**
   * Get current connection status
   */
  getStatus(): ConnectionStatus {
    return this.status;
  }

  /**
   * Connect to WebSocket server
   */
  connect(): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.log("Already connected");
      return;
    }

    this.setStatus(ConnectionStatus.Connecting);
    this.log(`Connecting to ${this.config.url}`);

    try {
      this.socket = new WebSocket(this.config.url);
      this.setupSocketListeners();
    } catch (error) {
      this.log("Connection error:", error);
      this.setStatus(ConnectionStatus.Error);
      this.scheduleReconnect();
    }
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    this.log("Disconnecting...");
    this.clearReconnectTimer();
    this.clearPingInterval();

    if (this.socket) {
      this.socket.close(1000, "Client disconnect");
      this.socket = null;
    }

    this.setStatus(ConnectionStatus.Disconnected);
  }

  /**
   * Send a message to the server
   */
  send(message: WebSocketMessage): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.log("Cannot send message: not connected");
      return false;
    }

    try {
      const json = JSON.stringify(message);
      this.socket.send(json);
      this.log("Sent message:", message);
      return true;
    } catch (error) {
      this.log("Send error:", error);
      return false;
    }
  }

  /**
   * Send ping message
   */
  ping(): boolean {
    return this.send(createMessage.ping());
  }

  /**
   * Request media blobs list
   */
  getMediaBlobs(limit?: number, offset?: number): boolean {
    return this.send(createMessage.getMediaBlobs(limit, offset));
  }

  /**
   * Request specific media blob
   */
  getMediaBlob(id: string): boolean {
    return this.send(createMessage.getMediaBlob(id));
  }

  /**
   * Request media blob data (binary content)
   */
  getMediaBlobData(id: string): boolean {
    return this.send(createMessage.getMediaBlobData(id));
  }

  /**
   * Upload media blob
   */
  uploadMediaBlob(blob: MediaBlob): boolean {
    return this.send(createMessage.uploadMediaBlob(blob));
  }

  /**
   * Subscribe to notification channel
   */
  subscribeToNotifications(channel: NotificationChannel): boolean {
    return this.send(createMessage.subscribeToNotifications(channel));
  }

  /**
   * Unsubscribe from notification channel
   */
  unsubscribeFromNotifications(channel: NotificationChannel): boolean {
    return this.send(createMessage.unsubscribeFromNotifications(channel));
  }

  /**
   * Get notification status
   */
  getNotificationStatus(): boolean {
    return this.send(createMessage.getNotificationStatus());
  }

  private setupSocketListeners(): void {
    if (!this.socket) return;

    this.socket.onopen = () => {
      this.log("Connected");
      this.setStatus(ConnectionStatus.Connected);
      this.reconnectAttempts = 0;
      this.startPing();
    };

    this.socket.onclose = (event) => {
      this.log(`Connection closed: ${event.code} ${event.reason}`);
      this.clearPingInterval();
      this.setStatus(ConnectionStatus.Disconnected);

      if (this.config.autoReconnect && event.code !== 1000) {
        this.scheduleReconnect();
      }
    };

    this.socket.onerror = (error) => {
      this.log("Socket error:", error);
      this.setStatus(ConnectionStatus.Error);
    };

    this.socket.onmessage = (event) => {
      this.handleMessage(event.data);
    };
  }

  private handleMessage(rawMessage: string): void {
    this.log("Received raw message:", rawMessage);
    this.listeners.rawMessage?.(rawMessage);

    try {
      const data = JSON.parse(rawMessage);
      const parseResult = safeParseWebSocketResponse(data);

      if (!parseResult.success) {
        const error = new Error(
          `Message parse error: ${parseResult.error.message}`
        );
        this.log("Parse error:", error);
        this.listeners.parseError?.(error, rawMessage);
        return;
      }

      const response = parseResult.data;
      this.log("Parsed message:", response);

      // Dispatch to specific handlers
      switch (response.type) {
        case "Welcome":
          this.listeners.welcome?.(response.data);
          break;
        case "Pong":
          this.log("Received pong");
          break;
        case "MediaBlobs":
          this.listeners.mediaBlobs?.(response.data);
          break;
        case "MediaBlob":
          this.listeners.mediaBlob?.(response.data);
          break;
        case "MediaBlobData":
          this.listeners.mediaBlobData?.(response.data);
          break;
        case "Error":
          this.listeners.error?.(response.data);
          break;
        case "ConnectionStatus":
          this.listeners.connectionStatus?.(response.data);
          break;
        case "Notification":
          this.listeners.notification?.(response.data);
          break;
        case "NotificationSubscribed":
          this.listeners.notificationSubscribed?.(response.data);
          break;
        case "NotificationUnsubscribed":
          this.listeners.notificationUnsubscribed?.(response.data);
          break;
        case "NotificationStatus":
          this.listeners.notificationStatus?.(response.data);
          break;
        default:
          this.log("Unknown message type:", response);
      }
    } catch (error) {
      const parseError = new Error(`JSON parse error: ${error}`);
      this.log("JSON parse error:", parseError);
      this.listeners.parseError?.(parseError, rawMessage);
    }
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.log(`Status changed to: ${status}`);
      this.listeners.statusChange?.(status);
    }
  }

  private scheduleReconnect(): void {
    if (!this.config.autoReconnect) return;

    if (
      this.config.maxReconnectAttempts > 0 &&
      this.reconnectAttempts >= this.config.maxReconnectAttempts
    ) {
      this.log("Max reconnection attempts reached");
      return;
    }

    this.clearReconnectTimer();
    this.reconnectAttempts++;

    this.log(
      `Scheduling reconnect attempt ${this.reconnectAttempts} in ${this.config.reconnectDelay}ms`
    );

    this.reconnectTimer = window.setTimeout(() => {
      this.connect();
    }, this.config.reconnectDelay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startPing(): void {
    this.clearPingInterval();
    // Send ping every 30 seconds to keep connection alive
    this.pingInterval = window.setInterval(() => {
      this.ping();
    }, 30000);
  }

  private clearPingInterval(): void {
    if (this.pingInterval !== null) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private log(...args: unknown[]): void {
    if (this.config.debug) {
      console.log("[WebSocketClient]", ...args);
    }
  }
}
