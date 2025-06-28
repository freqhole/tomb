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
import {
  createSignal,
  onMount,
  onCleanup,
  Show,
  createMemo,
  For,
} from "solid-js";
import { useWebSocketFeed } from "../hooks/useWebSocketFeed.js";
import ConnectionStatusComponent from "../components/websocket/ConnectionStatus.js";
import ConnectionControlsComponent from "../components/websocket/ConnectionControls.js";
import MediaBlobFeedListComponent from "../components/feed/MediaBlobFeedList.js";
import FeedControlsComponent from "../components/feed/FeedControls.js";
import FeedPaginationComponent from "../components/feed/FeedPagination.js";
import type { NotificationChannel } from "../lib/websocket-types.js";

// Helper function to parse URL parameters
function getUrlParams(): Record<string, string> {
  const params = new URLSearchParams(window.location.search);
  const result: Record<string, string> = {};
  for (const [key, value] of params) {
    result[key] = value;
  }
  return result;
}

// Helper function to convert string to boolean
function stringToBoolean(
  value: string | undefined,
  defaultValue: boolean
): boolean {
  if (!value) return defaultValue;
  return value.toLowerCase() === "true" || value === "1";
}

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
  /** Enable auto-refresh of feed (defaults to true) */
  autoRefresh?: boolean;
}

function WebSocketFeedDemoComponent(props: WebSocketFeedDemoProps) {
  // Parse URL parameters to override props
  const urlParams = getUrlParams();

  // Override props with URL parameters if provided (using createMemo for reactivity)
  const resolvedProps = createMemo(() => ({
    ...props,
    debug: stringToBoolean(urlParams.debug, props.debug || false),
    autoConnect: stringToBoolean(
      urlParams.autoConnect,
      props.autoConnect !== false
    ),
    showControls: stringToBoolean(
      urlParams.showControls,
      props.showControls !== false
    ),
    showStats: stringToBoolean(urlParams.showStats, props.showStats !== false),
    wsUrl: urlParams.wsUrl || props.wsUrl || "ws://localhost:8080/ws",
    itemMode:
      (urlParams.itemMode as "default" | "compact" | "detailed") ||
      props.itemMode ||
      "default",
    maxHeight: urlParams.maxHeight || props.maxHeight || "400px",
    className: urlParams.className || props.className,
    demoMode: stringToBoolean(urlParams.demoMode, props.demoMode || false),
    autoRefresh: stringToBoolean(
      urlParams.autoRefresh,
      props.autoRefresh !== false
    ),
  }));

  // Local UI state
  const [displayMode, setDisplayMode] = createSignal<
    "default" | "compact" | "detailed"
  >(resolvedProps().itemMode);
  const [logs, setLogs] = createSignal<string[]>([]);

  // Business logic via hook
  const feed = useWebSocketFeed({
    wsUrl: resolvedProps().wsUrl,
    channels: props.channels || ["MediaBlobs"],
    debug: resolvedProps().debug,
    autoConnect: resolvedProps().autoConnect,
    autoRefresh: resolvedProps().autoRefresh,
  });

  const addLog = (message: string) => {
    if (resolvedProps().debug) {
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

  const handleToggleAutoRefresh = () => {
    const newState = !feed.state().autoRefresh;
    addLog(`🔄 Auto-refresh ${newState ? "enabled" : "disabled"}`);
    feed.actions.toggleAutoRefresh();
  };

  const handleApplyPendingUpdates = () => {
    addLog("📥 Applying pending updates");
    feed.actions.applyPendingUpdates();
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
    <div
      class={resolvedProps().className || props.className}
      style={containerStyles()}
    >
      {/* Header Section */}
      <div style={headerStyles()}>
        <h2 style={titleStyles()}>Real-time Media Feed</h2>

        <div style={statusSectionStyles()}>
          <ConnectionStatusComponent
            status={feed.state().connectionStatus}
            showText={true}
            compact={false}
          />

          <Show when={resolvedProps().showControls}>
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
      <Show when={resolvedProps().showStats}>
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

      {/* Auto-refresh Controls */}
      <div
        style={{
          display: "flex",
          "align-items": "center",
          "justify-content": "space-between",
          padding: "12px",
          "background-color": "#f8fafc",
          border: "1px solid #e2e8f0",
          "border-radius": "6px",
          "font-size": "14px",
          gap: "12px",
        }}
      >
        <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
          <span>🔄</span>
          <span>Auto-refresh:</span>
          <button
            onClick={handleToggleAutoRefresh}
            style={{
              padding: "4px 12px",
              "border-radius": "4px",
              border: "1px solid #d1d5db",
              "background-color": feed.state().autoRefresh
                ? "#10b981"
                : "#6b7280",
              color: "white",
              "font-size": "12px",
              cursor: "pointer",
              "font-weight": "500",
            }}
          >
            {feed.state().autoRefresh ? "ON" : "OFF"}
          </button>
        </div>

        <Show
          when={feed.state().hasPendingUpdates && !feed.state().autoRefresh}
        >
          <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
            <span
              style={{
                "background-color": "#f59e0b",
                color: "white",
                padding: "2px 6px",
                "border-radius": "10px",
                "font-size": "11px",
                "font-weight": "600",
              }}
            >
              {feed.state().pendingUpdates.length}
            </span>
            <button
              onClick={handleApplyPendingUpdates}
              style={{
                padding: "6px 12px",
                "border-radius": "4px",
                border: "1px solid #f59e0b",
                "background-color": "#fbbf24",
                color: "#92400e",
                "font-size": "12px",
                cursor: "pointer",
                "font-weight": "500",
                display: "flex",
                "align-items": "center",
                gap: "4px",
              }}
            >
              <span>📬</span>
              <span>New content available - Click to refresh!</span>
            </button>
          </div>
        </Show>
      </div>

      {/* Feed List */}
      <MediaBlobFeedListComponent
        items={feed.state().items}
        isLoading={feed.state().isLoading}
        error={feed.state().error}
        mode={displayMode()}
        maxHeight={resolvedProps().maxHeight}
        showPreview={true}
        showMetadata={true}
        showThumbnails={true}
        onItemClick={handleItemClick}
        onGetThumbnails={feed.actions.getThumbnails}
        requestedThumbnails={feed.state().requestedThumbnails}
        enableInlineViewer={true}
        baseUrl={resolvedProps()
          .wsUrl?.replace(/^ws/, "http")
          .replace(/\/ws$/, "")}
      />

      {/* Pagination */}
      <FeedPaginationComponent
        currentPage={feed.state().currentPage}
        pageSize={feed.state().pageSize}
        totalCount={feed.state().totalCount}
        hasMore={feed.state().hasMore}
        isLoading={feed.state().isLoading}
        isLoadingMore={feed.state().isLoadingMore}
        mode="both"
        onLoadMore={feed.actions.loadMore}
        onLoadPage={feed.actions.loadPage}
        onPageSizeChange={feed.actions.setPageSize}
        showPageSizeSelector={true}
        showStats={true}
      />

      {/* Debug Logs */}
      <Show when={resolvedProps().debug && logs().length > 0}>
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
            <For each={logs()}>{(log) => <div>{log}</div>}</For>
          </div>
        </div>
      </Show>

      {/* Demo Info */}
      <Show when={resolvedProps().demoMode}>
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
    autoRefresh: false,
  },
  WebSocketFeedDemoComponent
);

export default WebSocketFeedDemoComponent;
