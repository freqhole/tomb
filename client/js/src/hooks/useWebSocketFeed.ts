/**
 * WebSocket Feed Hook
 *
 * Provides reusable business logic for WebSocket-based feed management.
 * Handles connection, subscription, and real-time updates for media blob feeds.
 */

import {
  createSignal,
  createEffect,
  onCleanup,
  createContext,
  useContext,
} from "solid-js";
import { WebSocketClient, ConnectionStatus } from "../lib/websocket-client.js";
import type { MediaBlob, NotificationChannel } from "../lib/websocket-types.js";

export interface FeedState {
  items: MediaBlob[];
  isLoading: boolean;
  isConnected: boolean;
  connectionStatus: ConnectionStatus;
  subscribedChannels: NotificationChannel[];
  totalCount: number;
  lastUpdated: Date | null;
  error: string | null;
  requestedThumbnails: Set<string>;
}

export interface FeedConfig {
  wsUrl?: string;
  channels?: NotificationChannel[];
  debug?: boolean;
  autoConnect?: boolean;
  pageSize?: number;
}

export interface FeedActions {
  connect: () => void;
  disconnect: () => void;
  refresh: () => void;
  subscribe: (channel: NotificationChannel) => void;
  unsubscribe: (channel: NotificationChannel) => void;
  getThumbnails: (mediaBlobId: string) => void;
}

export interface WebSocketFeedHook {
  state: () => FeedState;
  actions: FeedActions;
  client: () => WebSocketClient | null;
}

/**
 * WebSocket Feed Hook
 *
 * @param config - Configuration for the WebSocket feed
 * @returns Feed state, actions, and client access
 */
export function useWebSocketFeed(config: FeedConfig = {}): WebSocketFeedHook {
  const {
    wsUrl = "ws://localhost:8080/ws",
    channels = ["MediaBlobs"],
    debug = false,
    autoConnect = true,
    pageSize = 20,
  } = config;

  const [client, setClient] = createSignal<WebSocketClient | null>(null);
  const [feedState, setFeedState] = createSignal<FeedState>({
    items: [],
    isLoading: false,
    isConnected: false,
    connectionStatus: ConnectionStatus.Disconnected,
    subscribedChannels: [],
    totalCount: 0,
    lastUpdated: null,
    error: null,
    requestedThumbnails: new Set<string>(),
  });

  const log = (...args: unknown[]) => {
    if (debug) {
      console.log("[useWebSocketFeed]", ...args);
    }
  };

  const updateFeedState = (partial: Partial<FeedState>) => {
    setFeedState((prev) => ({ ...prev, ...partial }));
  };

  const addFeedItem = (item: MediaBlob) => {
    setFeedState((prev) => ({
      ...prev,
      items: [item, ...prev.items],
      totalCount: prev.totalCount + 1,
      lastUpdated: new Date(),
    }));
    log("Added new feed item:", item.id);
  };

  const updateFeedItem = (updatedItem: MediaBlob) => {
    setFeedState((prev) => ({
      ...prev,
      items: prev.items.map((item) =>
        item.id === updatedItem.id ? updatedItem : item
      ),
      lastUpdated: new Date(),
    }));
    log("Updated feed item:", updatedItem.id);
  };

  const removeFeedItem = (itemId: string) => {
    setFeedState((prev) => ({
      ...prev,
      items: prev.items.filter((item) => item.id !== itemId),
      totalCount: Math.max(0, prev.totalCount - 1),
      lastUpdated: new Date(),
    }));
    log("Removed feed item:", itemId);
  };

  const loadInitialFeed = () => {
    const wsClient = client();
    if (!wsClient) return;

    updateFeedState({ isLoading: true, error: null });
    log("Loading initial feed...");

    if (!wsClient.getMediaBlobs(pageSize, 0)) {
      updateFeedState({
        isLoading: false,
        error: "Failed to request initial feed data",
      });
    }
  };

  const subscribeToChannels = (channelsToSubscribe: NotificationChannel[]) => {
    const wsClient = client();
    if (!wsClient) return;

    log("Subscribing to channels:", channelsToSubscribe);
    channelsToSubscribe.forEach((channel) => {
      wsClient.subscribeToNotifications(channel);
    });
  };

  const unsubscribeFromChannels = (
    channelsToUnsubscribe: NotificationChannel[]
  ) => {
    const wsClient = client();
    if (!wsClient) return;

    log("Unsubscribing from channels:", channelsToUnsubscribe);
    channelsToUnsubscribe.forEach((channel) => {
      wsClient.unsubscribeFromNotifications(channel);
    });
  };

  const initializeWebSocket = () => {
    const wsClient = new WebSocketClient({
      url: wsUrl,
      autoReconnect: true,
      reconnectDelay: 3000,
      maxReconnectAttempts: 5,
      debug,
    });

    // Connection status updates
    wsClient.on("statusChange", (status) => {
      log("Connection status changed:", status);
      updateFeedState({
        connectionStatus: status,
        isConnected: status === ConnectionStatus.Connected,
      });

      if (status === ConnectionStatus.Connected) {
        loadInitialFeed();

        // Subscribe to channels, avoiding duplicates
        const currentSubscribed = feedState().subscribedChannels;
        const toSubscribe = channels.filter(
          (channel) => !currentSubscribed.includes(channel)
        );
        if (toSubscribe.length > 0) {
          subscribeToChannels(toSubscribe);
        }
      } else if (status === ConnectionStatus.Disconnected) {
        updateFeedState({ subscribedChannels: [] });
      }
    });

    // Welcome message
    wsClient.on("welcome", (data) => {
      log("Connected to WebSocket:", data);
      updateFeedState({ error: null });
    });

    // Initial media blobs response
    wsClient.on("mediaBlobs", (data) => {
      log("Loaded", data.blobs.length, "media blobs");
      updateFeedState({
        items: data.blobs,
        totalCount: data.total_count,
        isLoading: false,
        lastUpdated: new Date(),
        error: null,
      });
    });

    // Single media blob response
    wsClient.on("mediaBlob", (data) => {
      log("Received single media blob:", data.blob.id);
      updateFeedItem(data.blob);
    });

    // Thumbnails response
    wsClient.on("thumbnails", (data) => {
      log(
        "Received thumbnails for blob:",
        data.media_blob_id,
        "count:",
        data.thumbnails.length
      );
      // Update the original blob's metadata to include thumbnail info
      setFeedState((prev) => ({
        ...prev,
        items: prev.items.map((item) => {
          if (item.id === data.media_blob_id) {
            return {
              ...item,
              metadata: {
                ...item.metadata,
                thumbnails: data.thumbnails,
                has_thumbnails: data.thumbnails.length > 0,
                thumbnails_requested: true,
              },
            };
          }
          return item;
        }),
        lastUpdated: new Date(),
      }));
    });

    // Real-time notifications
    wsClient.on("notification", (data) => {
      log("🔔 Received notification:", data);
      log("📊 Notification details:", {
        channel: data.channel,
        event_type: data.event_type,
        has_payload: !!data.payload,
        payload_keys: data.payload ? Object.keys(data.payload) : [],
      });

      if (data.channel === "MediaBlobs") {
        log(`✅ MediaBlobs notification: ${data.event_type}`);
        switch (data.event_type) {
          case "media_blob.created":
            if (data.payload && data.payload.media_blob) {
              log(
                "📦 Adding new media blob:",
                data.payload.media_blob.id.slice(0, 8)
              );
              addFeedItem(data.payload.media_blob);
            } else {
              log(
                "❌ media_blob.created notification missing payload or media_blob"
              );
            }
            break;
          case "thumbnail.created":
            if (data.payload && data.payload.media_blob_id) {
              log(
                "🖼️ Thumbnail created for blob:",
                data.payload.media_blob_id.slice(0, 8)
              );
              // Automatically fetch updated thumbnails for the blob
              const wsClient = client();
              if (wsClient) {
                wsClient.getThumbnails(data.payload.media_blob_id);
              }
            } else {
              log(
                "❌ thumbnail.created notification missing payload or media_blob_id"
              );
            }
            break;
          case "media_blob.updated":
            if (data.payload && data.payload.media_blob) {
              log(
                "📝 Updating media blob:",
                data.payload.media_blob.id.slice(0, 8)
              );
              updateFeedItem(data.payload.media_blob);
            } else {
              log(
                "❌ media_blob.updated notification missing payload or media_blob"
              );
            }
            break;
          case "media_blob.deleted":
            if (data.payload && data.payload.media_blob_id) {
              log(
                "🗑️ Removing media blob:",
                data.payload.media_blob_id.slice(0, 8)
              );
              removeFeedItem(data.payload.media_blob_id);
            } else {
              log(
                "❌ media_blob.deleted notification missing payload or media_blob_id"
              );
            }
            break;
          default:
            log("⚠️ Unknown MediaBlobs event type:", data.event_type);
        }
      } else {
        log(
          `📡 Non-MediaBlobs notification (${data.channel}):`,
          data.event_type
        );
      }
    });

    // Subscription confirmations
    wsClient.on("notificationSubscribed", (data) => {
      log("✅ Successfully subscribed to channel:", data.channel);
      setFeedState((prev) => ({
        ...prev,
        subscribedChannels: prev.subscribedChannels.includes(data.channel)
          ? prev.subscribedChannels
          : [...prev.subscribedChannels, data.channel],
      }));
    });

    wsClient.on("notificationUnsubscribed", (data) => {
      log("❌ Unsubscribed from channel:", data.channel);
      setFeedState((prev) => ({
        ...prev,
        subscribedChannels: prev.subscribedChannels.filter(
          (c) => c !== data.channel
        ),
      }));
    });

    // Notification status
    wsClient.on("notificationStatus", (data) => {
      log("📊 Notification status received:", {
        subscribed_channels: data.subscribed_channels,
        is_authenticated: data.is_authenticated,
      });
      updateFeedState({ subscribedChannels: data.subscribed_channels });
    });

    // Error handling
    wsClient.on("error", (data) => {
      log("❌ WebSocket error:", data.message);
      updateFeedState({ error: data.message });
    });

    wsClient.on("parseError", (error) => {
      log("❌ Parse error:", error.message);
      updateFeedState({ error: `Parse error: ${error.message}` });
    });

    return wsClient;
  };

  // Actions
  const connect = () => {
    let wsClient = client();
    if (!wsClient) {
      wsClient = initializeWebSocket();
      setClient(wsClient);
    }
    if (wsClient && wsClient.getStatus() === ConnectionStatus.Disconnected) {
      wsClient.connect();
    }
  };

  const disconnect = () => {
    const wsClient = client();
    if (wsClient) {
      unsubscribeFromChannels(feedState().subscribedChannels);
      wsClient.disconnect();
    }
  };

  const refresh = () => {
    const wsClient = client();
    if (wsClient && feedState().isConnected) {
      loadInitialFeed();
    }
  };

  const subscribe = (channel: NotificationChannel) => {
    const wsClient = client();
    if (wsClient && feedState().isConnected) {
      if (!feedState().subscribedChannels.includes(channel)) {
        wsClient.subscribeToNotifications(channel);
      }
    }
  };

  const unsubscribe = (channel: NotificationChannel) => {
    const wsClient = client();
    if (wsClient && feedState().isConnected) {
      if (feedState().subscribedChannels.includes(channel)) {
        wsClient.unsubscribeFromNotifications(channel);
      }
    }
  };

  const getThumbnails = (mediaBlobId: string) => {
    const wsClient = client();
    if (wsClient && feedState().isConnected) {
      // Check if we've already requested thumbnails for this blob
      if (feedState().requestedThumbnails.has(mediaBlobId)) {
        log("Thumbnails already requested for blob:", mediaBlobId.slice(0, 8));
        return;
      }

      log("Requesting thumbnails for blob:", mediaBlobId.slice(0, 8));

      // Mark as requested
      setFeedState((prev) => ({
        ...prev,
        requestedThumbnails: new Set([
          ...prev.requestedThumbnails,
          mediaBlobId,
        ]),
      }));

      wsClient.getThumbnails(mediaBlobId);
    }
  };

  // Initialize WebSocket client only once
  createEffect(() => {
    if (!client()) {
      const wsClient = initializeWebSocket();
      setClient(wsClient);

      if (autoConnect) {
        wsClient.connect();
      }
    }
  });

  // Cleanup
  onCleanup(() => {
    log("Cleaning up WebSocket feed hook");
    const wsClient = client();
    if (wsClient) {
      unsubscribeFromChannels(feedState().subscribedChannels);
      wsClient.disconnect();
    }
  });

  const actions: FeedActions = {
    connect,
    disconnect,
    refresh,
    subscribe,
    unsubscribe,
    getThumbnails,
  };

  return {
    state: feedState,
    actions,
    client,
  };
}

/**
 * WebSocket Feed Context
 *
 * Provides feed state and actions to child components via context
 */
export interface WebSocketFeedContextValue extends WebSocketFeedHook {
  config: FeedConfig;
}

export const WebSocketFeedContext = createContext<WebSocketFeedContextValue>();

/**
 * Use WebSocket Feed Context
 *
 * Hook to access feed state and actions from context
 */
export function useWebSocketFeedContext(): WebSocketFeedContextValue {
  const context = useContext(WebSocketFeedContext);
  if (!context) {
    throw new Error(
      "useWebSocketFeedContext must be used within a WebSocketFeedProvider"
    );
  }
  return context;
}
