/**
 * Media Blob Feed List Component
 *
 * A reusable component that displays a list of media blob items.
 * Handles loading states, empty states, and different display modes.
 */

/* @jsxImportSource solid-js */
import { Show, For } from "solid-js";
import type { MediaBlob } from "../../lib/websocket-types.js";
import MediaBlobFeedItemComponent from "./MediaBlobFeedItem.js";

export interface MediaBlobFeedListProps {
  items: MediaBlob[];
  isLoading?: boolean;
  error?: string | null;
  mode?: "default" | "compact" | "detailed";
  maxHeight?: string;
  showPreview?: boolean;
  showMetadata?: boolean;
  emptyMessage?: string;
  onItemClick?: (item: MediaBlob) => void;
  className?: string;
}

export function MediaBlobFeedListComponent(props: MediaBlobFeedListProps) {
  const mode = () => props.mode || "default";
  const maxHeight = () => props.maxHeight || "400px";
  const emptyMessage = () => props.emptyMessage || "No media items found";

  const containerStyles = () => ({
    border: "1px solid #e2e8f0",
    "border-radius": "8px",
    "background-color": "#ffffff",
    overflow: "hidden",
  });

  const listStyles = () => ({
    "max-height": maxHeight(),
    "overflow-y": "auto" as const,
    padding: "8px",
    display: "flex",
    "flex-direction": "column" as const,
    gap: "8px",
  });

  const loadingStyles = () => ({
    display: "flex",
    "align-items": "center",
    "justify-content": "center",
    padding: "32px",
    color: "#64748b",
    "font-size": "14px",
    gap: "8px",
  });

  const emptyStyles = () => ({
    display: "flex",
    "flex-direction": "column" as const,
    "align-items": "center",
    "justify-content": "center",
    padding: "32px",
    color: "#64748b",
    "font-size": "14px",
    gap: "8px",
  });

  const errorStyles = () => ({
    display: "flex",
    "align-items": "center",
    "justify-content": "center",
    padding: "32px",
    color: "#dc2626",
    "font-size": "14px",
    gap: "8px",
    "background-color": "#fef2f2",
    border: "1px solid #fecaca",
    "border-radius": "6px",
    margin: "8px",
  });

  const headerStyles = () => ({
    padding: "12px 16px",
    "border-bottom": "1px solid #e2e8f0",
    "background-color": "#f8fafc",
    "font-size": "14px",
    "font-weight": "500",
    color: "#475569",
    display: "flex",
    "justify-content": "space-between",
    "align-items": "center",
  });

  const LoadingSpinner = () => (
    <div
      style={{
        width: "20px",
        height: "20px",
        border: "2px solid #e2e8f0",
        "border-top": "2px solid #3b82f6",
        "border-radius": "50%",
        animation: "spin 1s linear infinite",
      }}
    />
  );

  // Add CSS animation for spinner
  const spinKeyframes = `
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  `;

  return (
    <div class={props.className} style={containerStyles()}>
      <style>{spinKeyframes}</style>

      {/* Header */}
      <div style={headerStyles()}>
        <span>Media Feed</span>
        <span>{props.items.length} items</span>
      </div>

      {/* Error State */}
      <Show when={props.error}>
        <div style={errorStyles()}>
          <span>❌</span>
          <span>{props.error}</span>
        </div>
      </Show>

      {/* Loading State */}
      <Show when={props.isLoading && props.items.length === 0}>
        <div style={loadingStyles()}>
          <LoadingSpinner />
          <span>Loading media feed...</span>
        </div>
      </Show>

      {/* Empty State */}
      <Show when={!props.isLoading && !props.error && props.items.length === 0}>
        <div style={emptyStyles()}>
          <span style={{ "font-size": "32px" }}>📁</span>
          <span>{emptyMessage()}</span>
          <span style={{ "font-size": "12px", color: "#94a3b8" }}>
            Upload some files to see them here
          </span>
        </div>
      </Show>

      {/* Feed Items */}
      <Show when={props.items.length > 0}>
        <div style={listStyles()}>
          {/* Loading indicator for refresh */}
          <Show when={props.isLoading}>
            <div
              style={{
                display: "flex",
                "align-items": "center",
                "justify-content": "center",
                padding: "8px",
                gap: "8px",
                "font-size": "12px",
                color: "#64748b",
                "background-color": "#f8fafc",
                "border-radius": "6px",
                border: "1px solid #e2e8f0",
              }}
            >
              <LoadingSpinner />
              <span>Refreshing...</span>
            </div>
          </Show>

          <For each={props.items}>
            {(item) => (
              <MediaBlobFeedItemComponent
                item={item}
                mode={mode()}
                showPreview={props.showPreview}
                showMetadata={props.showMetadata}
                onItemClick={props.onItemClick}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

export default MediaBlobFeedListComponent;
