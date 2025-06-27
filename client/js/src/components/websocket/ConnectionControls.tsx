/**
 * WebSocket Connection Controls Component
 *
 * A reusable component that provides controls for managing WebSocket connections.
 * Includes connect/disconnect buttons and optional additional controls.
 */

/* @jsxImportSource solid-js */
import { Show } from "solid-js";
import { ConnectionStatus } from "../../lib/websocket-client.js";

export interface ConnectionControlsProps {
  status: ConnectionStatus;
  onConnect: () => void;
  onDisconnect: () => void;
  onRefresh?: () => void;
  showRefresh?: boolean;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
}

export function ConnectionControlsComponent(props: ConnectionControlsProps) {
  const isConnected = () => props.status === ConnectionStatus.Connected;
  const isConnecting = () => props.status === ConnectionStatus.Connecting;

  const canConnect = () =>
    !props.disabled &&
    (props.status === ConnectionStatus.Disconnected ||
      props.status === ConnectionStatus.Error);

  const canDisconnect = () =>
    !props.disabled && (isConnected() || isConnecting());

  const canRefresh = () =>
    !props.disabled &&
    isConnected() &&
    props.onRefresh &&
    props.showRefresh !== false;

  const buttonStyles = (
    variant: "primary" | "secondary" | "danger" = "primary"
  ) => {
    const base = {
      padding: props.compact ? "4px 8px" : "8px 16px",
      "font-size": props.compact ? "12px" : "14px",
      "font-weight": "500",
      border: "1px solid",
      "border-radius": "6px",
      cursor: "pointer",
      transition: "all 0.2s ease",
      display: "inline-flex",
      "align-items": "center",
      gap: "4px",
      "min-width": props.compact ? "auto" : "80px",
      "justify-content": "center",
    };

    switch (variant) {
      case "primary":
        return {
          ...base,
          "background-color": "#3b82f6",
          "border-color": "#3b82f6",
          color: "white",
        };
      case "secondary":
        return {
          ...base,
          "background-color": "#f8fafc",
          "border-color": "#e2e8f0",
          color: "#64748b",
        };
      case "danger":
        return {
          ...base,
          "background-color": "#ef4444",
          "border-color": "#ef4444",
          color: "white",
        };
    }
  };

  const disabledStyles = {
    opacity: "0.5",
    cursor: "not-allowed",
  };

  return (
    <div
      class={props.className}
      style={{
        display: "flex",
        gap: props.compact ? "4px" : "8px",
        "align-items": "center",
      }}
    >
      <Show when={canConnect()}>
        <button
          onClick={props.onConnect}
          style={buttonStyles("primary")}
          disabled={!canConnect()}
          title="Connect to WebSocket"
        >
          <span>🔌</span>
          <Show when={!props.compact}>Connect</Show>
        </button>
      </Show>

      <Show when={canDisconnect()}>
        <button
          onClick={props.onDisconnect}
          style={{
            ...buttonStyles("danger"),
            ...(isConnecting() ? disabledStyles : {}),
          }}
          disabled={!canDisconnect()}
          title="Disconnect from WebSocket"
        >
          <span>{isConnecting() ? "⏸️" : "🔌"}</span>
          <Show when={!props.compact}>
            {isConnecting() ? "Cancel" : "Disconnect"}
          </Show>
        </button>
      </Show>

      <Show when={canRefresh()}>
        <button
          onClick={props.onRefresh}
          style={buttonStyles("secondary")}
          disabled={!canRefresh()}
          title="Refresh feed data"
        >
          <span>🔄</span>
          <Show when={!props.compact}>Refresh</Show>
        </button>
      </Show>
    </div>
  );
}

export default ConnectionControlsComponent;
