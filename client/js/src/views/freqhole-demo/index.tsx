import { createSignal, createMemo, onMount, onCleanup } from "solid-js";
import type { FilterConfig } from "./types";
import type { MediaBlob } from "../../lib/websocket-types";
import { BrowsePanel } from "./BrowsePanel";

import { FilterOnlyPanel } from "./components/FilterOnlyPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { EdgeToggleButton } from "./EdgeToggleButton";
import { SelectionToolbar } from "./components/SelectionToolbar";
import { InfiniteDataGrid } from "../../components/infinite-data-grid";
import type { GridColumn } from "../../components/infinite-data-grid/types";
import { Thumbnail } from "./components/Thumbnail";
import { PopupPreview } from "./components/PopupPreview";
import { ActionMenu } from "./components/ActionMenu";
import { BulkActionMenu } from "./components/BulkActionMenu";
import { DragSelectionOverlay } from "./components/DragSelectionOverlay";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { HeaderActionMenu } from "./components/HeaderActionMenu";
import { useKeyboardNavigation } from "./hooks/useKeyboardNavigation";
import { useViewModes } from "./hooks/useViewModes";
import { useResponsiveColumns } from "./hooks/useResponsiveColumns";
import { useFreqholeData } from "./hooks/useFreqholeData";
import {
  FreqholeStateProvider,
  useFreqholeAppContext,
} from "./context/FreqholeStateContext";

import { getDisplayFilename } from "../../lib/media-utils";
import { formatBytes } from "../../lib/format-utils";
import { useWebSocketFeed } from "../../hooks/useWebSocketFeed";
import type { NotificationChannel } from "../../lib/websocket-types";

export interface FreqholeDemoProps {
  wsUrl: string;
  apiBaseUrl: string;
  autoConnect: boolean;
}

export function FreqholeDemo(props: FreqholeDemoProps) {
  return (
    <FreqholeStateProvider wsUrl={props.wsUrl} autoConnect={props.autoConnect}>
      <FreqholeDemoContent apiBaseUrl={props.apiBaseUrl} />
    </FreqholeStateProvider>
  );
}

function FreqholeDemoContent(props: { apiBaseUrl: string }) {
  // Get state and selection from context instead of creating new instances
  const { state, selection } = useFreqholeAppContext();

  // View modes (keeping existing integration)
  const initialState = state.loadState();
  const viewModes = useViewModes((initialState.viewMode as any) || "default");

  // Responsive columns hook for smart column hiding
  const responsiveColumns = useResponsiveColumns({
    baseColumnVisibility: () => state.columnVisibility(),
  });

  // Set up feed and data hooks (these should match what's in context)
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

  // Helper functions that will be used by hooks
  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    const currentLogs = state.logs();
    state.setLogs([`${timestamp}: ${message}`, ...currentLogs.slice(0, 49)]);
  };

  // Keyboard navigation
  const keyboardNav = useKeyboardNavigation({
    onPreview: (item) => state.setPopupPreview({ item, isOpen: true }),
    onToggleSelection: (item) => selection.toggleSelection(item.id),
    onSelectAll: (items) => selection.selectAll(items),
    onClearSelection: () => selection.clearSelection(),
    onEscape: () => {
      if (state.popupPreview()?.isOpen) {
        state.setPopupPreview(null);
      } else if (state.actionMenu()?.isOpen) {
        state.setActionMenu(null);
      } else if (state.bulkActionMenu()?.isOpen) {
        state.setBulkActionMenu(null);
      } else {
        selection.clearSelection();
      }
    },
    onDelete: (items) => {
      state.setConfirmDialog({
        isOpen: true,
        title: "Delete Files",
        message: `Delete ${items.length} selected file${items.length !== 1 ? "s" : ""}?`,
        items: items,
        onConfirm: () => {
          // TODO: Implement actual delete API call
          addLog(`🗑️ Deleted ${items.length} items via keyboard`);
          console.log(
            "Deleted via keyboard:",
            items.map((i) => i.id)
          );
          selection.clearSelection();
          state.setConfirmDialog(null);
        },
      });
    },
    isTextInputFocused: () => {
      const target = document.activeElement as HTMLElement;
      return (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable ||
          target.getAttribute("contenteditable") === "true")
      );
    },
    getSelectedItems: () => selection.selectedItems(),
    getAllItems: () => data.sortedData(),
    onLog: addLog,
  });

  // Track thumbnail requests to avoid duplicates (using existing hook state)

  // Enhanced event handlers that work with the data
  const handleRowClick = (
    item: MediaBlob,
    index: number,
    event: MouseEvent
  ) => {
    if (event.shiftKey && selection.lastSelectedIndex() >= 0) {
      // Prevent unwanted text selection on Shift+click
      event.preventDefault();
      // Handle range selection with access to sorted data
      selection.selectRange(
        selection.lastSelectedIndex(),
        index,
        data.sortedData()
      );
    } else {
      // Delegate to selection hook
      selection.handleRowClick(item, index, event);
    }
  };

  const handleRowDoubleClick = (item: MediaBlob) => {
    state.setPopupPreview({ item, isOpen: true });
    addLog(`🖼️ Opened preview for: ${getDisplayFilename(item)}`);
  };

  const handleRowContextMenu = (
    item: MediaBlob,
    _index: number,
    event: MouseEvent
  ) => {
    event.preventDefault();
    event.stopPropagation();

    const position = {
      x: event.clientX,
      y: event.clientY,
    };

    const selectedCount = selection.selectedItems().size;

    if (selectedCount > 1) {
      // Show bulk action menu when multiple items selected
      state.setBulkActionMenu({
        isOpen: true,
        position,
      });
      addLog(`🖱️ Bulk context menu opened for ${selectedCount} items`);
    } else {
      // Show individual action menu for single item
      state.setActionMenu({
        item,
        isOpen: true,
        position,
      });
      addLog(`🖱️ Context menu opened for: ${getDisplayFilename(item)}`);
    }
  };

  const handleActionMenuClick = (item: MediaBlob, event: MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();

    const currentMenu = state.actionMenu();
    if (currentMenu && currentMenu.item.id === item.id) {
      // Close if clicking same item
      state.setActionMenu(null);
      addLog(`⋯ Action menu closed for: ${getDisplayFilename(item)}`);
    } else {
      // Open menu at button position
      const rect = (event.target as HTMLElement).getBoundingClientRect();
      const position = {
        x: rect.right - 120, // Offset to the left of button
        y: rect.bottom + 4,
      };

      state.setActionMenu({
        item,
        isOpen: true,
        position,
      });
      addLog(`⋯ Action menu opened for: ${getDisplayFilename(item)}`);
    }
  };

  const handleBulkMoreClick = (event: MouseEvent) => {
    const currentMenu = state.bulkActionMenu();
    if (currentMenu?.isOpen) {
      // Close if already open
      state.setBulkActionMenu(null);
    } else {
      // Position menu above the More button
      const rect = (event.target as HTMLElement).getBoundingClientRect();
      const position = {
        x: rect.left + rect.width / 2 - 100, // Center horizontally
        y: rect.top - 10, // Position above button
      };

      state.setBulkActionMenu({
        isOpen: true,
        position,
      });
    }
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    // Let keyboard navigation handle most keys
    keyboardNav.handleKeyDown(event);

    // Also delegate to selection hook for any additional handling
    selection.handleKeyDown(event);
  };

  // Enhanced drag selection with proper item calculation
  const handleMouseMove = (event: MouseEvent) => {
    if (selection.isDragSelecting() && selection.dragStart()) {
      selection.setDragEnd({
        x: event.clientX,
        y: event.clientY,
        endIndex: -1,
      });

      // Calculate which items are in the selection rectangle
      const start = selection.dragStart()!;
      const currentIndex = Math.floor((event.clientY - start.y) / 60); // Rough row height
      if (currentIndex !== start.startIndex) {
        const startIdx = Math.min(
          start.startIndex,
          start.startIndex + currentIndex
        );
        const endIdx = Math.max(
          start.startIndex,
          start.startIndex + currentIndex
        );
        selection.selectRange(startIdx, endIdx, data.sortedData());
      }
    }
  };

  // Setup enhanced event listeners
  onMount(() => {
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("keydown", handleKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("keydown", handleKeyDown);
  });

  // Track thumbnail requests to avoid duplicates
  const [thumbnailRequests, setThumbnailRequests] = createSignal<Set<string>>(
    new Set()
  );

  // Helper function to request thumbnails
  const requestThumbnails = (itemId: string) => {
    if (!thumbnailRequests().has(itemId)) {
      setThumbnailRequests((prev) => new Set([...prev, itemId]));
      feed.actions.getThumbnails(itemId);
      addLog(`🖼️ Requesting thumbnails for ${itemId.slice(0, 8)}`);
    }
  };

  const visibleColumns = createMemo((): GridColumn<MediaBlob>[] => {
    const vis = responsiveColumns.responsiveColumnVisibility();
    const columns: GridColumn<MediaBlob>[] = [];

    // Thumbnail column (first)
    if (vis.thumbnail) {
      columns.push({
        key: "thumbnail",
        title: "",
        width: 60,
        render: (item) => (
          <Thumbnail
            item={item}
            size={40}
            apiBaseUrl={props.apiBaseUrl}
            onRequestThumbnails={requestThumbnails}
            requestedThumbnails={thumbnailRequests()}
            showIndicators={true}
          />
        ),
      });
    }

    // Name column (second) - flexible width to fill remaining space
    if (vis.name) {
      columns.push({
        key: "name",
        title: "Name",
        // No width specified = flex: 1 (expands to fill remaining space)
        sortable: true,
        render: (item) => (
          <span style="font-weight: 500;" title={getDisplayFilename(item)}>
            {getDisplayFilename(item)}
          </span>
        ),
      });
    }

    // Type column (third)
    if (vis.blob_type) {
      columns.push({
        key: "blob_type",
        title: "Type",
        width: 100,
        sortable: true,
      });
    }

    // MIME Type column (fourth)
    if (vis.mime) {
      columns.push({
        key: "mime",
        title: "MIME Type",
        width: 150,
        sortable: true,
        render: (item) => <span>{item.mime || "unknown"}</span>,
      });
    }

    // ID column (hidden by default, but available)
    if (vis.id) {
      columns.push({
        key: "id",
        title: "ID",
        width: 200,
        sortable: true,
        render: (item) => (
          <span style="font-family: monospace; font-size: 12px;">
            {item.id}
          </span>
        ),
      });
    }

    if (vis.size) {
      columns.push({
        key: "size",
        title: "Size",
        width: 100,
        sortable: true,
        render: (item) => <span>{formatBytes(item.size || 0)}</span>,
      });
    }

    if (vis.parent_blob_id) {
      columns.push({
        key: "parent_blob_id",
        title: "Parent",
        width: 120,
        render: (item) => <span>{item.parent_blob_id ? "Yes" : "No"}</span>,
      });
    }

    if (vis.local_path) {
      columns.push({
        key: "local_path",
        title: "Local Path",
        width: 200,
        render: (item) => <span>{item.local_path || "None"}</span>,
      });
    }

    if (vis.created_at) {
      columns.push({
        key: "created_at",
        title: "Created",
        width: 140,
        sortable: true,
        render: (item) => (
          <span>{new Date(item.created_at).toLocaleString()}</span>
        ),
      });
    }

    if (vis.updated_at) {
      columns.push({
        key: "updated_at",
        title: "Updated",
        width: 140,
        sortable: true,
        render: (item) => (
          <span>{new Date(item.updated_at).toLocaleString()}</span>
        ),
      });
    }

    if (vis.actions) {
      columns.push({
        key: "actions",
        title: (
          <button
            onClick={(e) => {
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              state.setHeaderActionMenu({
                isOpen: !state.headerActionMenu()?.isOpen,
                position: {
                  x: rect.left + rect.width / 2,
                  y: rect.bottom + 5,
                },
              });
            }}
            title="Controls"
            style={`
              background: ${state.headerActionMenu()?.isOpen ? "#ff00ff" : "#333"};
              border: 1px solid ${state.headerActionMenu()?.isOpen ? "#ff00ff" : "#555"};
              color: ${state.headerActionMenu()?.isOpen ? "#000" : "#fff"};
              padding: 4px 8px;
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              transition: all 0.15s ease;
              position: relative;
            `}
          >
            ⋯
            {responsiveColumns.getHiddenColumns().length > 0 && (
              <span
                style="
                  position: absolute;
                  top: -2px;
                  right: -2px;
                  background: #ff9900;
                  color: #000;
                  font-size: 8px;
                  font-weight: bold;
                  padding: 1px 3px;
                  border-radius: 50%;
                  line-height: 1;
                  min-width: 12px;
                  text-align: center;
                "
                title={`${responsiveColumns.getHiddenColumns().length} columns hidden on mobile screens`}
              >
                {responsiveColumns.getHiddenColumns().length}
              </span>
            )}
          </button>
        ),
        sortable: false,
        width: 100,
        className: "sticky-actions-column",
        render: (item) => (
          <button
            style={`
              background: #3a3a3a;
              border: 1px solid #4a4a4a;
              color: #e0e0e0;
              padding: ${viewModes.viewMode() === "compact" ? "2px 6px" : "4px 8px"};
              border-radius: 4px;
              cursor: pointer;
              font-size: ${viewModes.viewMode() === "compact" ? "10px" : "12px"};
              transition: all 0.2s;
            `}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.background = "#4a4a4a";
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLElement).style.background = "#3a3a3a";
            }}
            onClick={(e) => handleActionMenuClick(item as MediaBlob, e)}
          >
            ⋯
          </button>
        ),
      });
    }

    return columns;
  });

  // Actions
  const updateFilter = (key: keyof FilterConfig, value: any) => {
    state.updateFilter(key, value);
  };

  const handleSort = (field: string, direction: "asc" | "desc") => {
    state.handleSort(field, direction);
  };

  // Reactive effects for feed state monitoring - COMMENTED OUT DUE TO INFINITE RECURSION
  // createEffect(() => {
  //   const items = feed.state().items;
  //   if (items.length > 0) {
  //     addLog(`📦 Loaded ${items.length} items from feed`);
  //   }
  // });

  // // Monitor thumbnail requests
  // createEffect(() => {
  //   const requestedSet = feed.state().requestedThumbnails;
  //   if (requestedSet.size > 0) {
  //     addLog(`🖼️ ${requestedSet.size} thumbnails requested`);
  //   }
  // });

  // createEffect(() => {
  //   const status = feed.state().connectionStatus;
  //   addLog(`🔌 Connection status: ${status}`);
  // });

  // createEffect(() => {
  //   if (feed.state().hasPendingUpdates) {
  //     addLog(
  //       `⏳ ${feed.state().pendingUpdates.length} pending updates available`
  //     );
  //   }
  // });

  // Component initialization
  onMount(() => {
    addLog("🚀 FreqholeDemo mounted");
    addLog(`🔌 WebSocket URL: ${state.wsUrl()}`);

    if (state.autoConnect()) {
      addLog("🔌 Auto-connecting to WebSocket...");
    }
  });

  return (
    <div
      style={`
        height: 100vh;
        background: #000000;
        color: #ffffff;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        display: flex;
        overflow: hidden;
      `}
    >
      {/* Browse Panel */}
      <BrowsePanel
        isOpen={state.isBrowsePanelOpen()}
        filterConfig={state.filterConfig()}
        onTogglePanel={() => state.toggleBrowsePanel()}
        onFilterChange={updateFilter}
        onWidthChange={(width) => {
          state.setBrowsePanelWidth(width);
        }}
        initialWidth={state.browsePanelWidth()}
      />

      {/* Selection Toolbar - Clean modular component */}
      <SelectionToolbar
        selectedCount={selection.selectedItems().size}
        onDownload={() => {
          console.log(
            "Bulk download:",
            selection.selectedItems().size,
            "items"
          );
          // TODO: Implement bulk download
        }}
        onClear={selection.clearSelection}
        onMore={handleBulkMoreClick}
      />

      {/* Main Content */}
      <div style="flex: 1; position: relative; overflow-y: hidden; overflow-x: auto; min-width: 0;">
        <InfiniteDataGrid
          data={data.sortedData() as any}
          columns={visibleColumns()}
          onSort={handleSort}
          sortField={state.sortConfig().field}
          sortDirection={state.sortConfig().direction as "asc" | "desc"}
          defaultSort={{ field: "created_at", direction: "desc" }}
          rowHeight={viewModes.getRowHeight()}
          headerHeight={60}
          getItemId={(item) => item.id}
          selectedItems={selection.selectedItems()}
          onRowClick={handleRowClick}
          onRowDoubleClick={handleRowDoubleClick}
          onRowMouseDown={selection.handleRowMouseDown}
          onContextMenu={(item, index, event) =>
            handleRowContextMenu(item as MediaBlob, index, event)
          }
          isDragSelecting={selection.isDragSelecting()}
          showPaginationStatus={true}
          onLoadMore={() => feed.actions.loadMore()}
          hasMore={feed.state().hasMore}
          isLoadingMore={feed.state().isLoadingMore}
          focusedIndex={keyboardNav.focusedIndex()}
          showFocusIndicator={true}
        />
      </div>

      {/* Edge Toggle Buttons */}
      <EdgeToggleButton />

      {/* Controls button removed - now handled by Actions header menu */}

      {/* Filter Only Panel */}
      <FilterOnlyPanel />

      {/* Settings Panel */}
      <SettingsPanel />

      <style>{`
        body.resizing {
          cursor: col-resize;
          user-select: none;
        }

        body.drag-selecting {
          user-select: none;
          cursor: crosshair;
        }

        body.drag-selecting * {
          user-select: none;
          cursor: crosshair;
        }
      `}</style>

      {/* Popup Preview */}
      <PopupPreview />

      {/* Action Menu */}
      <ActionMenu />

      {/* Bulk Action Menu */}
      <BulkActionMenu />

      {/* Confirm Dialog */}
      <ConfirmDialog />

      {/* Header Action Menu */}
      <HeaderActionMenu />

      {/* Drag Selection Overlay */}
      <DragSelectionOverlay />
    </div>
  );
}

// Helper functions moved to lib/media-utils.ts and lib/format-utils.ts
// Mock data generation removed - now using real WebSocket feed data

export default FreqholeDemo;
