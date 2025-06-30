/* @jsxImportSource solid-js */
import { Show, For } from "solid-js";
import { ResizeHandle } from "../ResizeHandle";
import { useResize } from "../hooks/useResize";
import { useFreqholeStateContext } from "../context/FreqholeStateContext";
import { useWebSocketFeed } from "../../../hooks/useWebSocketFeed";
import { useFreqholeData } from "../hooks/useFreqholeData";
import type { NotificationChannel } from "../../../lib/websocket-types";

export function SettingsPanel() {
  const state = useFreqholeStateContext();

  // Set up the same hooks that the main component uses
  const feed = useWebSocketFeed({
    wsUrl: state.wsUrl(),
    channels: ["MediaBlobs"] as NotificationChannel[],
    debug: state.debug(),
    autoConnect: state.autoConnect(),
    autoRefresh: state.autoRefresh() ?? true,
    pageSize: 50,
  });

  const data = useFreqholeData({
    items: () => feed.state().items,
    filterConfig: state.filterConfig,
    sortConfig: state.sortConfig,
  });

  // Helper function for logging
  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    const currentLogs = state.logs();
    state.setLogs([`${timestamp}: ${message}`, ...currentLogs.slice(0, 49)]);
  };

  // Computed values from feed
  const connectionStatus = () => feed.state().connectionStatus;
  const hasPendingUpdates = () => feed.state().hasPendingUpdates;
  const lastUpdated = () => feed.state().lastUpdated;

  // Event handlers that work with context and hooks
  const handleConnect = () => {
    feed.actions.connect();
    addLog("🔌 Connecting to WebSocket...");
  };

  const handleDisconnect = () => {
    feed.actions.disconnect();
    addLog("🔌 Disconnecting from WebSocket...");
  };

  const handleRefresh = () => {
    addLog("🔄 Refreshing data...");
    feed.actions.refresh();
  };

  const handleApplyPendingUpdates = () => {
    feed.actions.applyPendingUpdates();
    addLog("✅ Applied pending updates");
  };

  const handleToggleAutoConnect = () => {
    state.setAutoConnect(!state.autoConnect());
    addLog(`🔧 Auto-connect: ${state.autoConnect() ? "ON" : "OFF"}`);
  };

  const handleToggleAutoRefresh = () => {
    state.setAutoRefresh(!state.autoRefresh());
    addLog(`🔧 Auto-refresh: ${state.autoRefresh() ? "ON" : "OFF"}`);
  };

  const handleToggleDebug = () => {
    state.setDebug(!state.debug());
    addLog(`🐛 Debug: ${state.debug() ? "ON" : "OFF"}`);
  };

  const handleReset = () => {
    if (
      confirm(
        "Reset all settings and data? This will clear all stored preferences."
      )
    ) {
      localStorage.removeItem("freqhole-demo-state");
      location.reload();
    }
  };

  const resize = useResize({
    initialWidth: state.settingsPanelWidth(),
    minWidth: 250,
    maxWidth: 600,
    closeThreshold: 100,
    onWidthChange: (width) => state.setSettingsPanelWidth(width),
    onClose: () => state.toggleSettingsPanel(),
  });

  return (
    <div
      class={`settings-panel ${!state.isSettingsPanelOpen() ? "collapsed" : ""} ${
        resize.isDragging() ? "resizing" : ""
      }`}
      style={`
        width: ${state.isSettingsPanelOpen() ? resize.width() + "px" : "0"};
        flex-shrink: 0;
        background: #1a1a1a;
        border-left: 1px solid #3a3a3a;
        padding: ${state.isSettingsPanelOpen() ? "20px" : "0"};
        overflow-x: hidden;
        transition: width 0.3s ease, padding 0.3s ease;
        position: relative;
        min-width: 0;
        order: 3;
      `}
    >
      {/* Sticky Header Bar */}
      <div
        style={`
          position: sticky;
          top: 0;
          background: #1a1a1a;
          border-bottom: 1px solid #3a3a3a;
          padding: 8px 16px;
          margin: -20px -20px 20px -20px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          z-index: 10;
        `}
      >
        <h3 style="margin: 0; font-size: 14px; color: #ffffff; font-weight: 600;">
          ⚙️ Settings & Debug
        </h3>
        <button
          onClick={() => state.toggleSettingsPanel()}
          title="Close panel"
          style={`
            background: transparent;
            border: none;
            color: #888;
            cursor: pointer;
            font-size: 16px;
            padding: 4px;
            border-radius: 4px;
            transition: all 0.2s;
            line-height: 1;
          `}
        >
          ×
        </button>
      </div>

      {state.isSettingsPanelOpen() && (
        <div style="overflow-y: auto; min-width: 0;">
          {/* WebSocket Settings */}
          <div class="settings-section" style="margin-bottom: 24px;">
            <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #ffffff;">
              🔌 WebSocket Connection
            </h3>

            {/* Connection Status */}
            <div style="margin-bottom: 12px; padding: 8px; background: #252525; border-radius: 4px; border: 1px solid #444;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <span style="font-size: 12px; color: #888;">Status:</span>
                <span
                  style={`
                  font-size: 12px;
                  font-weight: 600;
                  color: ${
                    connectionStatus() === "connected"
                      ? "#00ff00"
                      : connectionStatus() === "connecting"
                        ? "#ffaa00"
                        : "#ff4444"
                  };
                `}
                >
                  {connectionStatus().toUpperCase()}
                </span>
              </div>
              <Show when={lastUpdated()}>
                <div style="font-size: 11px; color: #666;">
                  Last update: {lastUpdated()?.toLocaleTimeString()}
                </div>
              </Show>
            </div>

            {/* WebSocket URL */}
            <input
              type="text"
              placeholder="WebSocket URL"
              value={state.wsUrl()}
              onInput={(e) => state.setWsUrl(e.currentTarget.value)}
              style={`
                width: 100%;
                padding: 8px;
                background: #000000;
                border: 1px solid #3a3a3a;
                border-radius: 4px;
                color: #ffffff;
                font-size: 14px;
                margin-bottom: 12px;
                box-sizing: border-box;
              `}
            />

            {/* Connection Controls */}
            <div style="display: flex; gap: 8px; margin-bottom: 12px;">
              <button
                onClick={handleConnect}
                disabled={connectionStatus() === "connected"}
                style={`
                  flex: 1;
                  padding: 8px;
                  background: ${connectionStatus() === "connected" ? "#333" : "#00aa00"};
                  border: 1px solid ${connectionStatus() === "connected" ? "#555" : "#00dd00"};
                  border-radius: 4px;
                  color: ${connectionStatus() === "connected" ? "#888" : "#ffffff"};
                  font-size: 14px;
                  cursor: ${connectionStatus() === "connected" ? "not-allowed" : "pointer"};
                  transition: all 0.2s;
                `}
              >
                Connect
              </button>
              <button
                onClick={handleDisconnect}
                disabled={connectionStatus() === "disconnected"}
                style={`
                  flex: 1;
                  padding: 8px;
                  background: ${connectionStatus() === "disconnected" ? "#333" : "#aa0000"};
                  border: 1px solid ${connectionStatus() === "disconnected" ? "#555" : "#dd0000"};
                  border-radius: 4px;
                  color: ${connectionStatus() === "disconnected" ? "#888" : "#ffffff"};
                  font-size: 14px;
                  cursor: ${connectionStatus() === "disconnected" ? "not-allowed" : "pointer"};
                  transition: all 0.2s;
                `}
              >
                Disconnect
              </button>
            </div>

            <button
              onClick={handleRefresh}
              style={`
                width: 100%;
                padding: 8px;
                background: #0066cc;
                border: 1px solid #0088ff;
                border-radius: 4px;
                color: #ffffff;
                font-size: 14px;
                cursor: pointer;
                transition: all 0.2s;
              `}
            >
              🔄 Refresh Data
            </button>
          </div>

          {/* Auto Settings */}
          <div class="settings-section" style="margin-bottom: 24px;">
            <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #ffffff;">
              🤖 Automatic Settings
            </h3>

            <div style="display: flex; flex-direction: column; gap: 8px;">
              <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                <input
                  type="checkbox"
                  checked={state.autoConnect()}
                  onChange={handleToggleAutoConnect}
                  style="transform: scale(1.2);"
                />
                <span style="color: #ffffff; font-size: 14px;">
                  Auto-connect on load
                </span>
              </label>

              <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                <input
                  type="checkbox"
                  checked={state.autoRefresh()}
                  onChange={handleToggleAutoRefresh}
                  style="transform: scale(1.2);"
                />
                <span style="color: #ffffff; font-size: 14px;">
                  Auto-refresh data
                </span>
              </label>

              <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                <input
                  type="checkbox"
                  checked={state.debug()}
                  onChange={handleToggleDebug}
                  style="transform: scale(1.2);"
                />
                <span style="color: #ffffff; font-size: 14px;">
                  Enable debug mode
                </span>
              </label>
            </div>
          </div>

          {/* Pending Updates */}
          <Show when={hasPendingUpdates()}>
            <div class="settings-section" style="margin-bottom: 24px;">
              <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #ffffff;">
                ⏳ Pending Updates
              </h3>
              <div style="padding: 12px; background: #2a1a00; border: 1px solid #5a3400; border-radius: 4px; margin-bottom: 12px;">
                <p style="margin: 0 0 8px 0; font-size: 14px; color: #ffaa00;">
                  {feed.state().pendingUpdates.length} updates waiting
                </p>
                <p style="margin: 0; font-size: 12px; color: #cc8800;">
                  Click below to apply pending changes
                </p>
              </div>
              <button
                onClick={handleApplyPendingUpdates}
                style={`
                  width: 100%;
                  padding: 10px;
                  background: #aa6600;
                  border: 1px solid #cc8800;
                  border-radius: 4px;
                  color: #ffffff;
                  font-size: 14px;
                  font-weight: 600;
                  cursor: pointer;
                  transition: all 0.2s;
                `}
              >
                ✅ Apply Updates ({feed.state().pendingUpdates.length})
              </button>
            </div>
          </Show>

          {/* Data Statistics */}
          <div class="settings-section" style="margin-bottom: 24px;">
            <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #ffffff;">
              📊 Data Statistics
            </h3>
            <div style="padding: 12px; background: #252525; border-radius: 6px; border: 1px solid #444;">
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 14px;">
                <div>
                  <div style="color: #888; font-size: 12px;">Total Files</div>
                  <div style="color: #ffffff; font-weight: 600;">
                    {feed.state().items.length}
                  </div>
                </div>
                <div>
                  <div style="color: #888; font-size: 12px;">Filtered</div>
                  <div style="color: #00ff00; font-weight: 600;">
                    {data.filteredData().length}
                  </div>
                </div>
                <div>
                  <div style="color: #888; font-size: 12px;">Hidden</div>
                  <div style="color: #ff9900; font-weight: 600;">
                    {feed.state().items.length - data.filteredData().length}
                  </div>
                </div>
                <div>
                  <div style="color: #888; font-size: 12px;">Memory</div>
                  <div style="color: #888; font-weight: 600; font-size: 12px;">
                    ~{Math.round(feed.state().items.length * 0.5)}KB
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Activity Log */}
          <div class="settings-section" style="margin-bottom: 24px;">
            <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #ffffff;">
              📜 Activity Log
            </h3>
            <div
              style={`
                max-height: 200px;
                overflow-y: auto;
                background: #0a0a0a;
                border: 1px solid #333;
                border-radius: 4px;
                padding: 8px;
                font-family: monospace;
                font-size: 11px;
                line-height: 1.3;
              `}
            >
              <Show when={state.logs().length === 0}>
                <div style="color: #666; font-style: italic;">
                  No activity yet...
                </div>
              </Show>
              <For each={state.logs()}>
                {(log) => (
                  <div style="color: #ccc; margin-bottom: 2px; word-break: break-all;">
                    {log}
                  </div>
                )}
              </For>
            </div>
            <Show when={state.logs().length > 0}>
              <button
                onClick={() => state.setLogs([])}
                style={`
                  width: 100%;
                  padding: 6px;
                  background: #333;
                  border: 1px solid #555;
                  border-radius: 4px;
                  color: #888;
                  font-size: 12px;
                  cursor: pointer;
                  margin-top: 8px;
                  transition: all 0.2s;
                `}
              >
                Clear Log
              </button>
            </Show>
          </div>

          {/* Danger Zone */}
          <div class="settings-section" style="margin-bottom: 24px;">
            <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #ff4444;">
              ⚠️ Danger Zone
            </h3>
            <div style="padding: 12px; background: #2a0000; border: 1px solid #5a0000; border-radius: 4px; margin-bottom: 12px;">
              <p style="margin: 0; font-size: 12px; color: #ff8888;">
                This will clear all settings, filters, and cached data. The page
                will reload.
              </p>
            </div>
            <button
              onClick={handleReset}
              style={`
                width: 100%;
                padding: 10px;
                background: #aa0000;
                border: 1px solid #dd0000;
                border-radius: 4px;
                color: #ffffff;
                font-size: 14px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s;
              `}
            >
              🗑️ Reset All Data
            </button>
          </div>
        </div>
      )}

      <ResizeHandle
        position="left"
        isDragging={resize.isDragging()}
        onMouseDown={(e) => resize.handleMouseDown(e, "right")}
      />

      <style>{`
        .settings-panel input:focus {
          outline: none;
          border-color: #ff00ff !important;
        }

        .settings-panel button:hover:not(:disabled) {
          filter: brightness(1.1) !important;
        }

        .settings-panel button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .settings-panel button[title="Close panel"]:hover {
          background: rgba(255, 255, 255, 0.1) !important;
          color: #ff4444 !important;
        }

        /* Custom scrollbar for activity log */
        .settings-section div::-webkit-scrollbar {
          width: 6px;
        }

        .settings-section div::-webkit-scrollbar-track {
          background: #1a1a1a;
        }

        .settings-section div::-webkit-scrollbar-thumb {
          background: #444;
          border-radius: 3px;
        }

        .settings-section div::-webkit-scrollbar-thumb:hover {
          background: #555;
        }

        /* Global resizing behavior */
        body.resizing {
          cursor: col-resize !important;
          user-select: none !important;
        }

        body.resizing * {
          cursor: col-resize !important;
          user-select: none !important;
        }
      `}</style>
    </div>
  );
}
