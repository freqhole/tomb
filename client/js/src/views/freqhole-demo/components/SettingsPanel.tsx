/* @jsxImportSource solid-js */
import { Show, For } from "solid-js";
import { ResizeHandle } from "../ResizeHandle";
import { useResize } from "../hooks/useResize";

export interface SettingsPanelProps {
  isOpen: boolean;
  wsUrl: string;
  autoConnect: boolean;
  autoRefresh: boolean;
  debug: boolean;
  connectionStatus: string;
  hasPendingUpdates: boolean;
  pendingUpdatesCount: number;
  filteredCount: number;
  totalCount: number;
  lastUpdated: Date | null;
  logs: string[];
  onTogglePanel: () => void;
  onWsUrlChange: (url: string) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onRefresh: () => void;
  onApplyPendingUpdates: () => void;
  onToggleAutoConnect: () => void;
  onToggleAutoRefresh: () => void;
  onToggleDebug: () => void;
  onReset: () => void;
  onWidthChange: (width: number) => void;
  initialWidth: number;
}

export function SettingsPanel(props: SettingsPanelProps) {
  const resize = useResize({
    initialWidth: props.initialWidth,
    minWidth: 250,
    maxWidth: 600,
    closeThreshold: 100,
    onWidthChange: props.onWidthChange,
    onClose: props.onTogglePanel,
  });

  return (
    <div
      class={`settings-panel ${!props.isOpen ? "collapsed" : ""} ${
        resize.isDragging() ? "resizing" : ""
      }`}
      style={`
        width: ${props.isOpen ? resize.width() + "px" : "0"};
        flex-shrink: 0;
        background: #1a1a1a;
        border-right: 1px solid #3a3a3a;
        padding: ${props.isOpen ? "20px" : "0"};
        overflow: hidden;
        transition: width 0.3s ease, padding 0.3s ease;
        position: relative;
        min-width: 0;
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
          ⚙️ Settings
        </h3>
        <button
          onClick={props.onTogglePanel}
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

      {props.isOpen && (
        <div style="overflow-y: auto; height: calc(100vh - 120px); min-width: 0; overflow-x: hidden;">
          {/* WebSocket Connection */}
          <div class="settings-section" style="margin-bottom: 24px;">
            <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #e0e0e0;">
              🔌 WebSocket Connection
            </h3>
            <input
              class="settings-input"
              type="text"
              placeholder="WebSocket URL"
              value={props.wsUrl}
              onInput={(e) => props.onWsUrlChange(e.currentTarget.value)}
              style={`
                width: 100%;
                padding: 8px;
                background: #000000;
                border: 1px solid #3a3a3a;
                border-radius: 4px;
                color: #ffffff;
                font-size: 14px;
                box-sizing: border-box;
                min-width: 0;
              `}
            />

            <div style="display: flex; gap: 8px; margin-top: 12px;">
              <button
                class="connect-button"
                onClick={props.onConnect}
                disabled={props.connectionStatus === "connected"}
                style={`
                  flex: 1;
                  padding: 8px;
                  background: ${
                    props.connectionStatus === "connected"
                      ? "#666666"
                      : "#00aa00"
                  };
                  border: 1px solid ${
                    props.connectionStatus === "connected"
                      ? "#666666"
                      : "#00aa00"
                  };
                  color: #ffffff;
                  border-radius: 4px;
                  cursor: ${
                    props.connectionStatus === "connected"
                      ? "not-allowed"
                      : "pointer"
                  };
                  font-size: 12px;
                  transition: all 0.2s;
                `}
              >
                Connect
              </button>
              <button
                class="disconnect-button"
                onClick={props.onDisconnect}
                disabled={props.connectionStatus !== "connected"}
                style={`
                  flex: 1;
                  padding: 8px;
                  background: ${
                    props.connectionStatus !== "connected"
                      ? "#666666"
                      : "#aa0000"
                  };
                  border: 1px solid ${
                    props.connectionStatus !== "connected"
                      ? "#666666"
                      : "#aa0000"
                  };
                  color: #ffffff;
                  border-radius: 4px;
                  cursor: ${
                    props.connectionStatus !== "connected"
                      ? "not-allowed"
                      : "pointer"
                  };
                  font-size: 12px;
                  transition: all 0.2s;
                `}
              >
                Disconnect
              </button>
            </div>

            <p style="font-size: 12px; color: #888; margin: 8px 0 0 0;">
              Status: <span style={`color: ${
                props.connectionStatus === "connected"
                  ? "#00ff00"
                  : props.connectionStatus === "connecting"
                  ? "#ffff00"
                  : "#ff4444"
              }`}>
                {props.connectionStatus}
              </span>
            </p>

            <div style="margin-top: 12px; font-size: 12px; display: flex; align-items: center; gap: 8px;">
              Auto-connect:
              <button
                class={`toggle-button ${props.autoConnect ? "active" : ""}`}
                onClick={props.onToggleAutoConnect}
                style={`
                  background: ${props.autoConnect ? "#ff00ff" : "#333333"};
                  border: 1px solid ${props.autoConnect ? "#ff00ff" : "#666666"};
                  color: ${props.autoConnect ? "#000000" : "#ffffff"};
                  padding: 4px 8px;
                  border-radius: 4px;
                  font-size: 12px;
                  cursor: pointer;
                  transition: all 0.2s;
                `}
              >
                {props.autoConnect ? "ON" : "OFF"}
              </button>
            </div>

            <div style="margin-top: 12px; font-size: 12px; display: flex; align-items: center; gap: 8px;">
              Auto-refresh:
              <button
                class={`toggle-button ${props.autoRefresh ? "active" : ""}`}
                onClick={props.onToggleAutoRefresh}
                style={`
                  background: ${props.autoRefresh ? "#ff00ff" : "#333333"};
                  border: 1px solid ${props.autoRefresh ? "#ff00ff" : "#666666"};
                  color: ${props.autoRefresh ? "#000000" : "#ffffff"};
                  padding: 4px 8px;
                  border-radius: 4px;
                  font-size: 12px;
                  cursor: pointer;
                  transition: all 0.2s;
                `}
              >
                {props.autoRefresh ? "ON" : "OFF"}
              </button>
              <button
                class="refresh-button"
                onClick={props.onRefresh}
                style={`
                  background: #0066cc;
                  border: 1px solid #0066cc;
                  color: #ffffff;
                  padding: 4px 8px;
                  border-radius: 4px;
                  cursor: pointer;
                  font-size: 12px;
                  transition: all 0.2s;
                `}
              >
                Refresh Now
              </button>
            </div>

            <Show when={props.hasPendingUpdates && !props.autoRefresh}>
              <div style="margin-top: 12px;">
                <button
                  class="apply-updates-button"
                  onClick={props.onApplyPendingUpdates}
                  style={`
                    width: 100%;
                    padding: 8px;
                    background: #ff9900;
                    border: 1px solid #ff9900;
                    color: #000000;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 12px;
                    font-weight: 600;
                    transition: all 0.2s;
                  `}
                >
                  Apply {props.pendingUpdatesCount} Pending Updates
                </button>
              </div>
            </Show>
          </div>

          {/* Data Information */}
          <div class="settings-section" style="margin-bottom: 24px;">
            <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #e0e0e0;">
              📊 Data Information
            </h3>
            <div style="font-size: 12px; color: #888; line-height: 1.6;">
              <div>Total Items: <span style="color: #e0e0e0;">{props.totalCount}</span></div>
              <div>Filtered Items: <span style="color: #e0e0e0;">{props.filteredCount}</span></div>
              <Show when={props.filteredCount !== props.totalCount}>
                <div style="color: #ff9900;">
                  Hidden: {props.totalCount - props.filteredCount} items
                </div>
              </Show>
              <Show when={props.lastUpdated}>
                <div style="margin-top: 8px;">
                  Last Updated: <span style="color: #e0e0e0;">
                    {props.lastUpdated?.toLocaleTimeString()}
                  </span>
                </div>
              </Show>
            </div>
          </div>

          {/* Debug Settings */}
          <div class="settings-section" style="margin-bottom: 24px;">
            <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #e0e0e0;">
              🐛 Debug Settings
            </h3>
            <div style="font-size: 12px; display: flex; align-items: center; gap: 8px;">
              Debug Mode:
              <button
                class={`toggle-button ${props.debug ? "active" : ""}`}
                onClick={props.onToggleDebug}
                style={`
                  padding: 4px 8px;
                  background: ${props.debug ? "#ff00ff" : "#333333"};
                  border: 1px solid ${props.debug ? "#ff00ff" : "#666666"};
                  color: ${props.debug ? "#000000" : "#ffffff"};
                  border-radius: 4px;
                  cursor: pointer;
                  font-size: 12px;
                  transition: all 0.2s;
                `}
              >
                {props.debug ? "ON" : "OFF"}
              </button>
            </div>
          </div>

          {/* Reset Controls */}
          <div class="settings-section" style="margin-bottom: 24px;">
            <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #e0e0e0;">
              🔄 Reset Controls
            </h3>
            <button
              class="reset-button"
              onClick={props.onReset}
              title="Reset all filters and settings"
              style={`
                width: 100%;
                padding: 12px;
                background: #ef4444;
                border: 1px solid #ef4444;
                color: #ffffff;
                border-radius: 6px;
                cursor: pointer;
                font-size: 14px;
                font-weight: 600;
                transition: all 0.2s;
              `}
            >
              Reset All Settings
            </button>
            <p style="font-size: 11px; color: #666; margin: 8px 0 0 0; text-align: center;">
              This will reset all filters, view modes, and panel settings
            </p>
          </div>

          {/* Debug Logs */}
          <Show when={props.debug && props.logs.length > 0}>
            <div class="settings-section">
              <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #e0e0e0;">
                📋 Debug Logs
              </h3>
              <div
                class="debug-logs"
                style={`
                  max-height: 200px;
                  overflow-y: auto;
                  background: #111111;
                  border: 1px solid #333333;
                  border-radius: 4px;
                  padding: 8px;
                `}
              >
                <For each={props.logs}>
                  {(log) => (
                    <div style="font-size: 11px; color: #888; margin-bottom: 2px; font-family: monospace; word-break: break-all;">
                      {log}
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>
        </div>
      )}

      <ResizeHandle
        position="right"
        isDragging={resize.isDragging()}
        onMouseDown={(e) => resize.handleMouseDown(e, "left")}
      />

      <style>{`
        .settings-input:focus {
          outline: none;
          border-color: #ff00ff;
        }

        .settings-panel button[title="Close panel"]:hover {
          background: rgba(255, 255, 255, 0.1) !important;
          color: #ff4444 !important;
        }

        .toggle-button:hover {
          filter: brightness(1.1);
        }

        .connect-button:hover:not(:disabled) {
          background: #00cc00 !important;
          border-color: #00cc00 !important;
        }

        .disconnect-button:hover:not(:disabled) {
          background: #cc0000 !important;
          border-color: #cc0000 !important;
        }

        .refresh-button:hover {
          background: #0080ff !important;
          border-color: #0080ff !important;
        }

        .apply-updates-button:hover {
          background: #ffaa00 !important;
          border-color: #ffaa00 !important;
        }

        .reset-button:hover {
          background: #dc2626 !important;
          border-color: #dc2626 !important;
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

        /* Prevent overflow in panel content */
        .settings-panel {
          overflow-x: hidden;
        }

        .settings-panel * {
          max-width: 100%;
          box-sizing: border-box;
        }

        /* Smooth transitions for panel operations */
        .settings-panel.resizing {
          transition: none !important;
        }

        /* Debug logs scrollbar styling */
        .debug-logs::-webkit-scrollbar {
          width: 6px;
        }

        .debug-logs::-webkit-scrollbar-track {
          background: #222;
        }

        .debug-logs::-webkit-scrollbar-thumb {
          background: #555;
          border-radius: 3px;
        }

        .debug-logs::-webkit-scrollbar-thumb:hover {
          background: #777;
        }
      `}</style>
    </div>
  );
}

export default SettingsPanel;
