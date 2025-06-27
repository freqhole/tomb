/**
 * WebSocket Feed Demo - Clean Architecture
 *
 * A complete demo component that showcases real-time media blob feed updates
 * using clean architecture principles:
 * - Business logic in hooks (useWebSocketFeed)
 * - Presentation logic in domain components (websocket/, feed/, common/)
 * - Web component as simple composition layer
 */

/* @jsxImportSource solid-js */
import { customElement } from "solid-element";
import { createSignal, onMount, onCleanup, Show } from "solid-js";
import { useWebSocketFeed } from "../hooks/useWebSocketFeed.js";
import ConnectionStatusComponent from "../components/websocket/ConnectionStatus.js";
import ConnectionControlsComponent from "../components/websocket/ConnectionControls.js";
import MediaBlobFeedListComponent from "../components/feed/MediaBlobFeedList.js";
import FeedControlsComponent from "../components/feed/FeedControls.js";
import type { NotificationChannel } from "../lib/websocket-types.js";

export interface WebSocketFeedDemoProps {
  /** WebSocket URL (defaults to ws://localhost:8080/ws) */
  wsUrl?: string;
  /** Notification channels to subscribe to */
  channels?: NotificationChannel[];
  /** Enable debug logging */
  debug?: boolean;
  /** Auto-connect on mount */
  autoConnect?: boolean;
  /** Feed item display mode */
  itemMode?: "default" | "compact" | "detailed";
  /** Maximum height for the feed list */
  maxHeight?: string;
  /** Show connection controls */
  showControls?: boolean;
  /** Show feed statistics */
  showStats?: boolean;
  /** Custom CSS class */
  className?: string;
  /** Feed refresh interval in seconds (0 = disabled) */
  refreshInterval?: number;
  /** Enable demo mode with mock data when server is unavailable */
  demoMode?: boolean;
}

function WebSocketFeedDemoComponent(props: WebSocketFeedDemoProps) {
  // Local UI state
  const [displayMode, setDisplayMode] = createSignal<
    "default" | "compact" | "detailed"
  >(props.itemMode || "default");
  const [logs, setLogs] = createSignal<string[]>([]);

  // Business logic via hook
  const feed = useWebSocketFeed({
    wsUrl: props.wsUrl || "ws://localhost:8080/ws",
    channels: props.channels || ["MediaBlobs"],
    debug: props.debug || false,
    autoConnect: props.autoConnect !== false,
  });

  const addLog = (message: string) => {
    if (props.debug) {
      const timestamp = new Date().toLocaleTimeString();
      setLogs((prev) => [...prev.slice(-19), `[${timestamp}] ${message}`]);
    }
  };

  // Log important state changes
  onMount(() => {
    addLog("🚀 WebSocket Feed Demo mounted");
  });

  onCleanup(() => {
    addLog("🧹 WebSocket Feed Demo cleanup");
  });

  const handleItemClick = (item: any) => {
    addLog(`🖱️ Clicked item: ${item.filename || item.id.slice(0, 8)}`);
  };

  const handleModeChange = (mode: "default" | "compact" | "detailed") => {
    setDisplayMode(mode);
    addLog(`🎨 Display mode changed to: ${mode}`);
  };

  const handleRefresh = () => {
    addLog("🔄 Manual refresh triggered");
    feed.actions.refresh();
  };

  const handleConnect = () => {
    addLog("🔌 Connect button clicked");
    feed.actions.connect();
  };

  const handleDisconnect = () => {
    addLog("🔌 Disconnect button clicked");
    feed.actions.disconnect();
  };

  const containerStyles = () => ({
    "font-family": "system-ui, -apple-system, sans-serif",
    "max-width": "800px",
    margin: "0 auto",
    padding: "16px",
    display: "flex",
    "flex-direction": "column" as const,
    gap: "16px",
    "background-color": "#ffffff",
    border: "1px solid #e2e8f0",
    "border-radius": "12px",
    "box-shadow": "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
  });

  const headerStyles = () => ({
    display: "flex",
    "align-items": "center",
    "justify-content": "space-between",
    padding: "0 4px",
    gap: "16px",
    "flex-wrap": "wrap" as const,
  });

  const titleStyles = () => ({
    "font-size": "20px",
    "font-weight": "600",
    color: "#1e293b",
    margin: "0",
  });

  const statusSectionStyles = () => ({
    display: "flex",
    "align-items": "center",
    gap: "12px",
    "flex-wrap": "wrap" as const,
  });

  const debugLogStyles = () => ({
    "font-size": "11px",
    "font-family": "monospace",
    "background-color": "#f1f5f9",
    border: "1px solid #e2e8f0",
    "border-radius": "6px",
    padding: "8px",
    "max-height": "120px",
    "overflow-y": "auto" as const,
    color: "#475569",
  });

  return (
    <div class={props.className} style={containerStyles()}>
      {/* Header Section */}
      <div style={headerStyles()}>
        <h2 style={titleStyles()}>Real-time Media Feed</h2>

        <div style={statusSectionStyles()}>
          <ConnectionStatusComponent
            status={feed.state().connectionStatus}
            showText={true}
            compact={false}
          />

          <Show when={props.showControls !== false}>
            <ConnectionControlsComponent
              status={feed.state().connectionStatus}
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
              onRefresh={handleRefresh}
              showRefresh={true}
              compact={false}
            />
          </Show>
        </div>
      </div>

      {/* Feed Controls */}
      <Show when={props.showStats !== false}>
        <FeedControlsComponent
          totalCount={feed.state().totalCount}
          subscribedChannels={feed.state().subscribedChannels}
          lastUpdated={feed.state().lastUpdated}
          isLoading={feed.state().isLoading}
          mode={displayMode()}
          onModeChange={handleModeChange}
          onRefresh={handleRefresh}
          showStats={true}
          showModeToggle={true}
        />
      </Show>

      {/* Error Display */}
      <Show when={feed.state().error}>
        <div
          style={{
            padding: "12px",
            "background-color": "#fef2f2",
            border: "1px solid #fecaca",
            "border-radius": "6px",
            color: "#dc2626",
            "font-size": "14px",
            display: "flex",
            "align-items": "center",
            gap: "8px",
          }}
        >
          <span>❌</span>
          <span>{feed.state().error}</span>
        </div>
      </Show>

      {/* Feed List */}
      <MediaBlobFeedListComponent
        items={feed.state().items}
        isLoading={feed.state().isLoading}
        error={feed.state().error}
        mode={displayMode()}
        maxHeight={props.maxHeight || "400px"}
        showPreview={true}
        showMetadata={true}
        onItemClick={handleItemClick}
      />

      {/* Debug Logs */}
      <Show when={props.debug && logs().length > 0}>
        <div>
          <div
            style={{
              "font-size": "12px",
              "font-weight": "500",
              "margin-bottom": "4px",
              color: "#64748b",
            }}
          >
            Debug Logs:
          </div>
          <div style={debugLogStyles()}>
            {logs().map((log) => (
              <div>{log}</div>
            ))}
          </div>
        </div>
      </Show>

      {/* Demo Info */}
      <Show when={props.demoMode}>
        <div
          style={{
            "font-size": "12px",
            color: "#64748b",
            "text-align": "center",
            padding: "8px",
            "background-color": "#f8fafc",
            border: "1px solid #e2e8f0",
            "border-radius": "6px",
          }}
        >
          🎯 Real-time WebSocket feed with clean architecture - no more polling!
        </div>
      </Show>
    </div>
  );
}

// Register the custom element
customElement(
  "websocket-feed-demo",
  {
    wsUrl: undefined,
    channels: undefined,
    debug: false,
    autoConnect: true,
    itemMode: "default",
    maxHeight: "400px",
    showControls: true,
    showStats: true,
    className: undefined,
    refreshInterval: 0,
    demoMode: false,
  },
  WebSocketFeedDemoComponent
);

export default WebSocketFeedDemoComponent;
