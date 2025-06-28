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
  // Auto-refresh state
  autoRefresh: boolean;
  pendingUpdates: MediaBlob[];
  hasPendingUpdates: boolean;
  // Pagination state
  currentPage: number;
  pageSize: number;
  hasMore: boolean;
  isLoadingMore: boolean;
  targetPage?: number; // Track the page we're loading to
}

export interface FeedConfig {
  wsUrl?: string;
  channels?: NotificationChannel[];
  debug?: boolean;
  autoConnect?: boolean;
  pageSize?: number;
  autoRefresh?: boolean;
}

export interface FeedActions {
  connect: () => void;
  disconnect: () => void;
  refresh: () => void;
  subscribe: (channel: NotificationChannel) => void;
  unsubscribe: (channel: NotificationChannel) => void;
  getThumbnails: (mediaBlobId: string) => void;
  // Auto-refresh actions
  toggleAutoRefresh: () => void;
  applyPendingUpdates: () => void;
  clearPendingUpdates: () => void;
  // Pagination actions
  loadMore: () => void;
  loadPage: (page: number) => void;
  setPageSize: (size: number) => void;
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
    autoRefresh = false,
  } = config;

  // Helper function to check if a blob is a thumbnail
  const isThumbnailBlob = (item: MediaBlob): boolean => {
    // Check if this blob has a parent (indicating it's derived from another blob)
    if (item.parent_blob_id) {
      log(
        `🔍 Filtering derived blob: ${item.id.slice(0, 8)} (type: ${item.blob_type}, parent: ${item.parent_blob_id.slice(0, 8)})`
      );
      return true;
    }

    return false;
  };

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
    // Auto-refresh state
    autoRefresh: autoRefresh,
    pendingUpdates: [],
    hasPendingUpdates: false,
    // Pagination state
    currentPage: 0,
    pageSize: pageSize,
    hasMore: true,
    isLoadingMore: false,
    targetPage: undefined,
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
    // Filter out thumbnail blobs
    if (isThumbnailBlob(item)) {
      log("Filtered out thumbnail blob:", item.id);
      return;
    }

    setFeedState((prev) => {
      if (prev.autoRefresh) {
        // Auto-refresh is on, add immediately
        log("Auto-refresh: Added new feed item:", item.id);
        return {
          ...prev,
          items: [item, ...prev.items],
          totalCount: prev.totalCount + 1,
          lastUpdated: new Date(),
        };
      } else {
        // Auto-refresh is off, add to pending updates
        log("Auto-refresh off: Added to pending updates:", item.id);
        return {
          ...prev,
          pendingUpdates: [item, ...prev.pendingUpdates],
          hasPendingUpdates: true,
        };
      }
    });
  };

  const updateFeedItem = (updatedItem: MediaBlob) => {
    setFeedState((prev) => {
      if (prev.autoRefresh) {
        // Auto-refresh is on, update immediately
        return {
          ...prev,
          items: prev.items.map((item) =>
            item.id === updatedItem.id ? updatedItem : item
          ),
          lastUpdated: new Date(),
        };
      } else {
        // Auto-refresh is off, update in pending updates if it exists there
        const pendingIndex = prev.pendingUpdates.findIndex(
          (item) => item.id === updatedItem.id
        );
        if (pendingIndex !== -1) {
          const newPendingUpdates = [...prev.pendingUpdates];
          newPendingUpdates[pendingIndex] = updatedItem;
          return {
            ...prev,
            pendingUpdates: newPendingUpdates,
          };
        }
        // Also update in current items if it exists there
        return {
          ...prev,
          items: prev.items.map((item) =>
            item.id === updatedItem.id ? updatedItem : item
          ),
          lastUpdated: new Date(),
        };
      }
    });
    log("Updated feed item:", updatedItem.id);
  };

  const removeFeedItem = (itemId: string) => {
    setFeedState((prev) => ({
      ...prev,
      items: prev.items.filter((item) => item.id !== itemId),
      pendingUpdates: prev.pendingUpdates.filter((item) => item.id !== itemId),
      totalCount: Math.max(0, prev.totalCount - 1),
      lastUpdated: new Date(),
      hasPendingUpdates:
        prev.pendingUpdates.filter((item) => item.id !== itemId).length > 0,
    }));
    log("Removed feed item:", itemId);
  };

  const loadInitialFeed = () => {
    const wsClient = client();
    if (!wsClient) return;

    updateFeedState({
      isLoading: true,
      error: null,
      currentPage: 0,
      items: [], // Clear existing items for fresh load
      targetPage: 0,
    });
    log("Loading initial feed...");

    if (!wsClient.getMediaBlobs(feedState().pageSize, 0)) {
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
    // Media blobs response
    wsClient.on("mediaBlobs", (data) => {
      log("Loaded", data.blobs.length, "media blobs");
      const state = feedState();
      const isLoadingMore = state.isLoadingMore;
      const targetPage = state.targetPage;

      // Filter out thumbnail blobs from the loaded data
      const filteredBlobs = data.blobs.filter((blob) => {
        const isThumb = isThumbnailBlob(blob);
        if (isThumb) {
          log(
            `🖼️ Filtering thumbnail: ${blob.id.slice(0, 8)} (type: ${blob.blob_type}, parent: ${blob.parent_blob_id?.slice(0, 8) || "none"})`
          );
        }
        return !isThumb;
      });
      log(
        "✅ Filtered out",
        data.blobs.length - filteredBlobs.length,
        "thumbnail blobs, kept",
        filteredBlobs.length,
        "parent blobs"
      );

      const newItems = isLoadingMore
        ? [...state.items, ...filteredBlobs]
        : filteredBlobs;

      // Determine the correct page number
      let newPage: number;
      if (isLoadingMore) {
        newPage = state.currentPage + 1;
      } else if (targetPage !== undefined) {
        newPage = targetPage;
      } else {
        newPage = 0; // Initial load
      }

      const hasMore = newItems.length < data.total_count;

      updateFeedState({
        items: newItems,
        totalCount: data.total_count,
        isLoading: false,
        isLoadingMore: false,
        error: null,
        lastUpdated: new Date(),
        currentPage: newPage,
        hasMore: hasMore,
        targetPage: undefined, // Clear target page after loading
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
      log("🔔 Received notification:", {
        id: data.id,
        channel: data.channel,
        event_type: data.event_type,
        priority: data.priority,
        timestamp: data.timestamp,
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
          ...Array.from(prev.requestedThumbnails),
          mediaBlobId,
        ]),
      }));

      wsClient.getThumbnails(mediaBlobId);
    }
  };

  const loadMore = () => {
    const wsClient = client();
    const state = feedState();

    if (
      !wsClient ||
      !state.isConnected ||
      state.isLoadingMore ||
      !state.hasMore
    ) {
      return;
    }

    const nextOffset = (state.currentPage + 1) * state.pageSize;
    log("Loading more items, offset:", nextOffset);

    updateFeedState({
      isLoadingMore: true,
      error: null,
      targetPage: undefined, // Clear any target page for load more
    });

    if (!wsClient.getMediaBlobs(state.pageSize, nextOffset)) {
      updateFeedState({
        isLoadingMore: false,
        error: "Failed to load more items",
      });
    }
  };

  const loadPage = (page: number) => {
    const wsClient = client();
    const state = feedState();

    if (!wsClient || !state.isConnected || state.isLoading || page < 0) {
      return;
    }

    const offset = page * state.pageSize;
    log("Loading page", page, "offset:", offset);

    updateFeedState({
      isLoading: true,
      error: null,
      items: [], // Clear items for page load
      targetPage: page, // Track which page we're loading
    });

    if (!wsClient.getMediaBlobs(state.pageSize, offset)) {
      updateFeedState({
        isLoading: false,
        error: "Failed to load page",
      });
    }
  };

  const setPageSize = (size: number) => {
    if (size <= 0 || size > 100) return; // Reasonable limits

    log("Setting page size to:", size);
    updateFeedState({ pageSize: size });

    // Reload current page with new page size
    loadPage(0);
  };

  const toggleAutoRefresh = () => {
    setFeedState((prev) => {
      const newAutoRefresh = !prev.autoRefresh;
      log("Auto-refresh toggled:", newAutoRefresh);

      // If turning auto-refresh back on, apply pending updates
      if (newAutoRefresh && prev.hasPendingUpdates) {
        log("Applying pending updates after enabling auto-refresh");
        return {
          ...prev,
          autoRefresh: newAutoRefresh,
          items: [...prev.pendingUpdates, ...prev.items],
          pendingUpdates: [],
          hasPendingUpdates: false,
          lastUpdated: new Date(),
        };
      }

      return {
        ...prev,
        autoRefresh: newAutoRefresh,
      };
    });
  };

  const applyPendingUpdates = () => {
    setFeedState((prev) => {
      if (!prev.hasPendingUpdates) return prev;

      log("Applying", prev.pendingUpdates.length, "pending updates");
      return {
        ...prev,
        items: [...prev.pendingUpdates, ...prev.items],
        pendingUpdates: [],
        hasPendingUpdates: false,
        lastUpdated: new Date(),
      };
    });
  };

  const clearPendingUpdates = () => {
    setFeedState((prev) => ({
      ...prev,
      pendingUpdates: [],
      hasPendingUpdates: false,
    }));
    log("Cleared pending updates");
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
    toggleAutoRefresh,
    applyPendingUpdates,
    clearPendingUpdates,
    loadMore,
    loadPage,
    setPageSize,
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
