/**
 * WebSocket Connection Status Component
 *
 * A reusable component that displays the current WebSocket connection status
 * with appropriate styling and indicators.
 */

/* @jsxImportSource solid-js */
import { Show } from "solid-js";
import { ConnectionStatus } from "../../lib/websocket-client.js";

export interface ConnectionStatusProps {
  status: ConnectionStatus;
  showText?: boolean;
  compact?: boolean;
  className?: string;
}

export function ConnectionStatusComponent(props: ConnectionStatusProps) {
  const statusInfo = () => {
    switch (props.status) {
      case ConnectionStatus.Connected:
        return {
          text: "Connected",
          emoji: "🟢",
          color: "#22c55e",
          bgColor: "#dcfce7",
        };
      case ConnectionStatus.Connecting:
        return {
          text: "Connecting...",
          emoji: "🔄",
          color: "#eab308",
          bgColor: "#fef3c7",
        };
      case ConnectionStatus.Disconnected:
        return {
          text: "Disconnected",
          emoji: "🔴",
          color: "#ef4444",
          bgColor: "#fee2e2",
        };
      case ConnectionStatus.Error:
        return {
          text: "Error",
          emoji: "❌",
          color: "#dc2626",
          bgColor: "#fecaca",
        };
      default:
        return {
          text: "Unknown",
          emoji: "❓",
          color: "#6b7280",
          bgColor: "#f3f4f6",
        };
    }
  };

  const baseStyles = () => ({
    display: "inline-flex",
    "align-items": "center",
    gap: props.compact ? "4px" : "8px",
    padding: props.compact ? "2px 6px" : "4px 8px",
    "border-radius": "6px",
    "font-size": props.compact ? "12px" : "14px",
    "font-weight": "500",
    "background-color": statusInfo().bgColor,
    color: statusInfo().color,
    border: `1px solid ${statusInfo().color}20`,
  });

  return (
    <div
      class={props.className}
      style={baseStyles()}
      title={`WebSocket ${statusInfo().text}`}
    >
      <span>{statusInfo().emoji}</span>
      <Show when={props.showText !== false}>
        <span>{statusInfo().text}</span>
      </Show>
    </div>
  );
}

export default ConnectionStatusComponent;
