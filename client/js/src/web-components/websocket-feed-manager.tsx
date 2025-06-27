/**
 * WebSocket Feed Manager Component
 *
 * Manages real-time media blob feed updates via WebSocket notifications.
 * Handles subscription to media blob events, maintains feed state, and provides
 * a clean interface for feed updates without polling.
 */

/* @jsxImportSource solid-js */
import { customElement } from "solid-element";
import { createSignal, onMount, onCleanup, createEffect } from "solid-js";
import { WebSocketClient, ConnectionStatus } from "../lib/websocket-client.js";
import type { MediaBlob, NotificationChannel } from "../lib/websocket-types.js";

export interface WebSocketFeedManagerProps {
  /** WebSocket URL (defaults to ws://localhost:8080/ws) */
  wsUrl?: string;
  /** Notification channels to subscribe to */
  channels?: NotificationChannel[];
  /** Enable debug logging */
  debug?: boolean;
  /** Auto-connect on mount */
  autoConnect?: boolean;
  /** Initial page size for media blobs */
  pageSize?: number;
  /** Class name for styling */
  className?: string;
}

export interface FeedState {
  items: MediaBlob[];
  isLoading: boolean;
  isConnected: boolean;
  connectionStatus: ConnectionStatus;
  subscribedChannels: NotificationChannel[];
  totalCount: number;
  lastUpdated: Date | null;
  error: string | null;
}

function WebSocketFeedManagerComponent(props: WebSocketFeedManagerProps) {
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
  });

  const wsUrl = () => props.wsUrl || "ws://localhost:8080/ws";

  // Memoize channels to prevent excessive re-renders
  const [parsedChannels, setParsedChannels] = createSignal<
    NotificationChannel[]
  >(["MediaBlobs"]);

  // Parse channels once on mount or when prop changes
  createEffect(() => {
    const channelsStr = props.channels;

    // If no channels prop or empty, use default
    if (
      !channelsStr ||
      (Array.isArray(channelsStr) && channelsStr.length === 0)
    ) {
      setParsedChannels(["MediaBlobs"]);
      return;
    }

    // If already an array, use it
    if (Array.isArray(channelsStr)) {
      setParsedChannels(channelsStr);
      return;
    }

    // If it's a string, try to parse as JSON
    if (typeof channelsStr === "string") {
      try {
        const parsed = JSON.parse(channelsStr);
        if (Array.isArray(parsed)) {
          setParsedChannels(parsed);
        } else {
          setParsedChannels(["MediaBlobs"]);
        }
      } catch (error) {
        log("Failed to parse channels prop, using default:", error);
        setParsedChannels(["MediaBlobs"]);
      }
    } else {
      setParsedChannels(["MediaBlobs"]);
    }
  });

  const channels = () => parsedChannels();
  const debug = () => props.debug || false;
  const pageSize = () => props.pageSize || 20;

  const log = (...args: unknown[]) => {
    if (debug()) {
      console.log("[WebSocketFeedManager]", ...args);
    }
  };

  const verboseLog = (...args: unknown[]) => {
    if (debug()) {
      // Can be disabled by changing this to false
      const verboseEnabled = false;
      if (verboseEnabled) {
        console.log("[WebSocketFeedManager:VERBOSE]", ...args);
      }
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
    verboseLog("Added new feed item:", item.id);
  };

  const updateFeedItem = (updatedItem: MediaBlob) => {
    setFeedState((prev) => ({
      ...prev,
      items: prev.items.map((item) =>
        item.id === updatedItem.id ? updatedItem : item
      ),
      lastUpdated: new Date(),
    }));
    verboseLog("Updated feed item:", updatedItem.id);
  };

  const removeFeedItem = (itemId: string) => {
    setFeedState((prev) => ({
      ...prev,
      items: prev.items.filter((item) => item.id !== itemId),
      totalCount: Math.max(0, prev.totalCount - 1),
      lastUpdated: new Date(),
    }));
    verboseLog("Removed feed item:", itemId);
  };

  const loadInitialFeed = () => {
    const wsClient = client();
    if (!wsClient) return;

    updateFeedState({ isLoading: true, error: null });
    verboseLog("Loading initial feed...");

    // Request initial media blobs
    if (!wsClient.getMediaBlobs(pageSize(), 0)) {
      updateFeedState({
        isLoading: false,
        error: "Failed to request initial feed data",
      });
    }
  };

  const unsubscribeFromChannels = () => {
    const wsClient = client();
    if (!wsClient) return;

    const currentState = feedState();
    verboseLog("Unsubscribing from channels:", currentState.subscribedChannels);

    currentState.subscribedChannels.forEach((channel) => {
      if (!wsClient.unsubscribeFromNotifications(channel)) {
        verboseLog("Failed to unsubscribe from channel:", channel);
      }
    });
  };

  const initializeWebSocket = () => {
    const wsClient = new WebSocketClient({
      url: wsUrl(),
      autoReconnect: true,
      reconnectDelay: 3000,
      maxReconnectAttempts: 0,
      debug: debug(),
    });

    // Connection status updates
    wsClient.on("statusChange", (status) => {
      log("Connection status changed:", status);
      updateFeedState({
        connectionStatus: status,
        isConnected: status === ConnectionStatus.Connected,
      });

      if (status === ConnectionStatus.Connected) {
        // Load initial data and subscribe to notifications once
        loadInitialFeed();
        // Only subscribe if not already subscribed
        const currentSubscribed = feedState().subscribedChannels;
        const channelsToSubscribe = channels().filter(
          (channel) => !currentSubscribed.includes(channel)
        );
        if (channelsToSubscribe.length > 0) {
          channelsToSubscribe.forEach((channel) => {
            wsClient.subscribeToNotifications(channel);
          });
        }
      } else if (status === ConnectionStatus.Disconnected) {
        updateFeedState({ subscribedChannels: [] });
      }
    });

    // Welcome message
    wsClient.on("welcome", (data) => {
      verboseLog("Connected to WebSocket:", data);
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
      verboseLog("Received single media blob:", data.blob.id);
      updateFeedItem(data.blob);
    });

    // Real-time notifications
    wsClient.on("notification", (data) => {
      verboseLog("Received notification:", data);

      if (data.channel === "MediaBlobs") {
        switch (data.event_type) {
          case "media_blob.created":
            if (data.payload && data.payload.media_blob) {
              log("📦 New media blob:", data.payload.media_blob.id.slice(0, 8));
              addFeedItem(data.payload.media_blob);
            }
            break;
          case "media_blob.updated":
            if (data.payload && data.payload.media_blob) {
              verboseLog("Updated media blob:", data.payload.media_blob.id);
              updateFeedItem(data.payload.media_blob);
            }
            break;
          case "media_blob.deleted":
            if (data.payload && data.payload.media_blob_id) {
              log(
                "🗑️ Deleted media blob:",
                data.payload.media_blob_id.slice(0, 8)
              );
              removeFeedItem(data.payload.media_blob_id);
            }
            break;
          default:
            verboseLog("Unknown media blob event:", data.event_type);
        }
      }
    });

    // Subscription confirmations
    wsClient.on("notificationSubscribed", (data) => {
      verboseLog("Subscribed to channel:", data.channel);
      setFeedState((prev) => ({
        ...prev,
        subscribedChannels: prev.subscribedChannels.includes(data.channel)
          ? prev.subscribedChannels
          : [...prev.subscribedChannels, data.channel],
      }));
    });

    wsClient.on("notificationUnsubscribed", (data) => {
      verboseLog("Unsubscribed from channel:", data.channel);
      setFeedState((prev) => ({
        ...prev,
        subscribedChannels: prev.subscribedChannels.filter(
          (c) => c !== data.channel
        ),
      }));
    });

    // Notification status
    wsClient.on("notificationStatus", (data) => {
      verboseLog("Notification status:", data);
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

    setClient(wsClient);
    return wsClient;
  };

  const connect = () => {
    const wsClient = client();
    if (wsClient) {
      wsClient.connect();
    }
  };

  const disconnect = () => {
    const wsClient = client();
    if (wsClient) {
      unsubscribeFromChannels();
      wsClient.disconnect();
    }
  };

  const refresh = () => {
    const wsClient = client();
    if (wsClient && feedState().isConnected) {
      loadInitialFeed();
    }
  };

  // Expose methods to parent components via ref - defined early to ensure availability
  const componentMethods = {
    connect,
    disconnect,
    refresh,
    getFeedState: () => feedState(),
    getClient: () => client(),
  };

  // Methods will be exposed via ref callback

  onMount(() => {
    log("Initializing WebSocket feed manager");
    const wsClient = initializeWebSocket();

    if (props.autoConnect !== false) {
      wsClient.connect();
    }
  });

  onCleanup(() => {
    log("Cleaning up WebSocket feed manager");
    disconnect();
  });

  // Create effect to handle channel subscription changes (avoid duplicates)
  createEffect(() => {
    const currentChannels = channels();
    const currentSubscribed = feedState().subscribedChannels;

    // Only update if there's a real difference and we're connected
    const wsClient = client();
    if (wsClient && feedState().isConnected) {
      // Find channels to unsubscribe from
      const toUnsubscribe = currentSubscribed.filter(
        (channel) => !currentChannels.includes(channel)
      );

      // Find channels to subscribe to
      const toSubscribe = currentChannels.filter(
        (channel) => !currentSubscribed.includes(channel)
      );

      // Only make changes if needed
      if (toUnsubscribe.length > 0 || toSubscribe.length > 0) {
        toUnsubscribe.forEach((channel) => {
          wsClient.unsubscribeFromNotifications(channel);
        });

        toSubscribe.forEach((channel) => {
          wsClient.subscribeToNotifications(channel);
        });
      }
    }
  });

  return (
    <div
      class={`websocket-feed-manager ${props.className || ""}`}
      style={{
        display: "none", // Hidden manager component
      }}
      ref={(el: HTMLDivElement) => {
        // Find the custom element parent and expose methods
        const customElement = el.closest("websocket-feed-manager");
        if (customElement) {
          (customElement as any).feedManager = componentMethods;
          verboseLog("Feed manager methods exposed on custom element");
        } else {
          verboseLog("Could not find custom element parent");
        }
      }}
    >
      {/* Hidden component - all functionality is exposed via ref */}
    </div>
  );
}

customElement(
  "websocket-feed-manager",
  {
    wsUrl: "ws://localhost:8080/ws",
    channels: ["MediaBlobs"],
    debug: false,
    autoConnect: true,
    pageSize: 20,
    className: "",
  },
  WebSocketFeedManagerComponent
);

export default WebSocketFeedManagerComponent;
