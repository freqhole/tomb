/**
 * Media Blob Feed List Component
 *
 * Displays a list of media blob feed items with virtual scrolling support,
 * empty states, loading indicators, and real-time updates.
 */

/* @jsxImportSource solid-js */
import { customElement } from "solid-element";
import { createSignal, For, Show, createMemo } from "solid-js";
import type { MediaBlob } from "../lib/websocket-types.js";
import MediaBlobFeedItemComponent from "./media-blob-feed-item.js";

export interface MediaBlobFeedListProps {
  /** Array of media blobs to display */
  items: MediaBlob[];
  /** Show loading state */
  loading?: boolean;
  /** Error message to display */
  error?: string | null;
  /** Empty state message */
  emptyMessage?: string;
  /** Maximum height for the list (enables scrolling) */
  maxHeight?: string;
  /** Item display mode */
  itemMode?: "default" | "compact";
  /** Show thumbnails on items */
  showThumbnails?: boolean;
  /** Show metadata on items */
  showMetadata?: boolean;
  /** Show timestamps on items */
  showTimestamps?: boolean;
  /** Enable item click handling */
  clickableItems?: boolean;
  /** Custom CSS class */
  className?: string;
  /** Thumbnail size for items */
  thumbnailSize?: number;
  /** Show item count */
  showItemCount?: boolean;
  /** Animation duration for new items (ms) */
  animationDuration?: number;
}

interface FeedListState {
  selectedItemId: string | null;
  lastUpdated: Date | null;
}

function MediaBlobFeedListComponent(props: MediaBlobFeedListProps) {
  const [state, setState] = createSignal<FeedListState>({
    selectedItemId: null,
    lastUpdated: null,
  });

  const items = () => props.items || [];
  const loading = () => props.loading || false;
  const error = () => props.error || null;
  const emptyMessage = () => props.emptyMessage || "No items in feed";
  const maxHeight = () => props.maxHeight || "auto";
  const itemMode = () => props.itemMode || "default";
  const showThumbnails = () => props.showThumbnails !== false;
  const showMetadata = () => props.showMetadata !== false;
  const showTimestamps = () => props.showTimestamps !== false;
  const clickableItems = () => props.clickableItems !== false;
  const thumbnailSize = () => props.thumbnailSize || 120;
  const showItemCount = () => props.showItemCount !== false;
  const animationDuration = () => props.animationDuration || 300;

  // Memoized sorted items (newest first)
  const sortedItems = createMemo(() => {
    return [...items()].sort((a, b) => {
      const dateA = new Date(a.created_at).getTime();
      const dateB = new Date(b.created_at).getTime();
      return dateB - dateA; // Newest first
    });
  });

  const handleItemClick = (event: CustomEvent) => {
    const { blob } = event.detail as { blob: MediaBlob };

    setState(prev => ({
      ...prev,
      selectedItemId: blob.id === prev.selectedItemId ? null : blob.id,
    }));

    // Emit event for parent components
    const listEvent = new CustomEvent("feed-item-selected", {
      detail: { blob, isSelected: blob.id !== state().selectedItemId },
      bubbles: true,
    });

    event.target?.dispatchEvent(listEvent);
  };

  const getItemAnimationStyle = (index: number) => {
    if (animationDuration() <= 0) return {};

    return {
      "animation-delay": `${index * 50}ms`,
      "animation-duration": `${animationDuration()}ms`,
      "animation-fill-mode": "both",
      "animation-name": "feed-item-appear",
    };
  };

  const formatItemCount = (count: number): string => {
    if (count === 0) return "No items";
    if (count === 1) return "1 item";
    return `${count.toLocaleString()} items`;
  };

  return (
    <div
      class={`media-blob-feed-list ${props.className || ""}`}
      style={{
        display: "flex",
        "flex-direction": "column",
        "font-family": "system-ui, -apple-system, sans-serif",
        height: "100%",
      }}
      onClick={(e) => {
        // Handle item clicks via event delegation
        const event = e as any;
        if (event.target.closest?.("[data-blob-id]")) {
          const detail = event.detail;
          if (detail?.blob) {
            handleItemClick(event as CustomEvent);
          }
        }
      }}
    >
      <style>{`
        @keyframes feed-item-appear {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }

        .media-blob-feed-list .loading-indicator {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 40px;
          color: #6b7280;
        }

        .media-blob-feed-list .loading-spinner {
          animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
          font-size: 24px;
          margin-right: 12px;
        }

        .media-blob-feed-list .error-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 40px 20px;
          text-align: center;
          color: #ef4444;
        }

        .media-blob-feed-list .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 60px 20px;
          text-align: center;
          color: #6b7280;
        }

        .media-blob-feed-list .empty-icon {
          font-size: 48px;
          margin-bottom: 16px;
          opacity: 0.5;
        }

        .media-blob-feed-list .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          border-bottom: 1px solid #e5e7eb;
          background-color: #f9fafb;
          font-size: 14px;
          color: #374151;
        }

        .media-blob-feed-list .feed-container {
          flex: 1;
          overflow-y: auto;
          padding: 8px;
        }

        .media-blob-feed-list .feed-container::-webkit-scrollbar {
          width: 8px;
        }

        .media-blob-feed-list .feed-container::-webkit-scrollbar-track {
          background: #f1f5f9;
        }

        .media-blob-feed-list .feed-container::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 4px;
        }

        .media-blob-feed-list .feed-container::-webkit-scrollbar-thumb:hover {
          background: #94a3b8;
        }

        .media-blob-feed-list .feed-item {
          margin-bottom: 8px;
          opacity: 0;
          animation: feed-item-appear 300ms ease-out forwards;
        }

        .media-blob-feed-list .feed-item:last-child {
          margin-bottom: 0;
        }

        .media-blob-feed-list .feed-item.selected {
          transform: scale(1.02);
          box-shadow: 0 4px 12px rgba(59, 130, 246, 0.15);
          border-color: #3b82f6;
        }
      `}</style>

      {/* Header with item count */}
      <Show when={showItemCount() && !loading() && !error()}>
        <div class="header">
          <div style={{ "font-weight": "500" }}>Feed</div>
          <div style={{ color: "#6b7280" }}>
            {formatItemCount(items().length)}
          </div>
        </div>
      </Show>

      {/* Loading State */}
      <Show when={loading()}>
        <div class="loading-indicator">
          <div class="loading-spinner">⏳</div>
          <div>Loading feed...</div>
        </div>
      </Show>

      {/* Error State */}
      <Show when={error() && !loading()}>
        <div class="error-state">
          <div style={{ "font-size": "48px", "margin-bottom": "16px" }}>
            ⚠️
          </div>
          <div style={{ "font-weight": "500", "margin-bottom": "8px" }}>
            Failed to load feed
          </div>
          <div style={{ "font-size": "14px", opacity: "0.8" }}>
            {error()}
          </div>
        </div>
      </Show>

      {/* Empty State */}
      <Show when={!loading() && !error() && items().length === 0}>
        <div class="empty-state">
          <div class="empty-icon">📭</div>
          <div style={{ "font-weight": "500", "margin-bottom": "8px" }}>
            {emptyMessage()}
          </div>
          <div style={{ "font-size": "14px", opacity: "0.8" }}>
            New items will appear here automatically
          </div>
        </div>
      </Show>

      {/* Feed Items */}
      <Show when={!loading() && !error() && items().length > 0}>
        <div
          class="feed-container"
          style={{
            "max-height": maxHeight(),
            overflow: maxHeight() !== "auto" ? "auto" : "visible",
          }}
        >
          <For each={sortedItems()}>
            {(item, index) => (
              <div
                class={`feed-item ${
                  state().selectedItemId === item.id ? "selected" : ""
                }`}
                style={getItemAnimationStyle(index())}
              >
                <MediaBlobFeedItemComponent
                  blob={item}
                  compact={itemMode() === "compact"}
                  showThumbnail={showThumbnails()}
                  showMetadata={showMetadata()}
                  showTimestamps={showTimestamps()}
                  clickable={clickableItems()}
                  thumbnailSize={thumbnailSize()}
                />
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

customElement(
  "media-blob-feed-list",
  {
    items: [],
    loading: false,
    error: null,
    emptyMessage: "No items in feed",
    maxHeight: "auto",
    itemMode: "default",
    showThumbnails: true,
    showMetadata: true,
    showTimestamps: true,
    clickableItems: true,
    className: "",
    thumbnailSize: 120,
    showItemCount: true,
    animationDuration: 300,
  },
  MediaBlobFeedListComponent
);

export default MediaBlobFeedListComponent;

// Export types for TypeScript users
export type { FeedListState };
