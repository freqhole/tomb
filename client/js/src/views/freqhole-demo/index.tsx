import {
  createSignal,
  createMemo,
  createEffect,
  onMount,
  onCleanup,
  Show,
} from "solid-js";
import type {
  FilterConfig,
  GridViewMode,
  ColumnVisibility,
  GridState,
  SortField,
} from "./types";
import type { MediaBlob } from "../../lib/websocket-types";
import { BrowsePanel } from "./BrowsePanel";
import { FilterPanel } from "./FilterPanel";
import { EdgeToggleButton } from "./EdgeToggleButton";
import { SelectionToolbar } from "./components/SelectionToolbar";
import { useSelection } from "./hooks/useSelection";
import { InfiniteDataGrid } from "../../components/infinite-data-grid";
import type { GridColumn } from "../../components/infinite-data-grid/types";
import { Thumbnail } from "./components/Thumbnail";
import { getDisplayFilename } from "../../lib/media-utils";
import { formatBytes } from "../../lib/format-utils";
import { useWebSocketFeed } from "../../hooks/useWebSocketFeed";
import type { NotificationChannel } from "../../lib/websocket-types";

export interface FreqholeDemoProps {
  wsUrl: string;
  apiBaseUrl: string;
  autoConnect: boolean;
}

const STORAGE_KEY = "freqhole-demo-state";
const DEFAULT_PANEL_WIDTH = 300;

// Load state from localStorage
function loadState(): Partial<GridState> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

// Save state to localStorage
function saveState(updates: Partial<GridState>) {
  try {
    const current = loadState();
    const updated = { ...current, ...updates };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Ignore storage errors
  }
}

export function FreqholeDemo(props: FreqholeDemoProps) {
  const initialState = loadState();

  // WebSocket feed integration
  const feed = useWebSocketFeed({
    wsUrl: props.wsUrl,
    channels: ["MediaBlobs"] as NotificationChannel[],
    debug: initialState.debug ?? false,
    autoConnect: props.autoConnect,
    autoRefresh: initialState.autoRefresh ?? true,
    pageSize: 50,
  });

  // State
  const [filterConfig, setFilterConfig] = createSignal<FilterConfig>({
    name: "",
    mime: "",
    blobType: "",
    minSize: 0,
    maxSize: 100000000,
    hasParent: "all",
    hasLocalPath: "all",
    ...(initialState.filterConfig || {}),
  });

  const [sortConfig, setSortConfig] = createSignal({
    field: "created_at",
    direction: "desc",
    ...(initialState.sortConfig || {}),
  });

  const [viewMode, setViewMode] = createSignal<GridViewMode>(
    (initialState.viewMode as GridViewMode) || "default"
  );

  const [columnVisibility, setColumnVisibility] =
    createSignal<ColumnVisibility>({
      id: false,
      thumbnail: true,
      name: true,
      mime: true,
      blob_type: true,
      size: true,
      parent_blob_id: false,
      local_path: false,
      created_at: true,
      updated_at: false,
      actions: true,
      ...(initialState.columnVisibility || {}),
    });

  const [isFilterPanelOpen, setIsFilterPanelOpen] = createSignal(
    initialState.isFilterPanelOpen ?? true
  );
  const [filterPanelWidth, setFilterPanelWidth] = createSignal(
    initialState.filterPanelWidth || DEFAULT_PANEL_WIDTH
  );

  const [isBrowsePanelOpen, setIsBrowsePanelOpen] = createSignal(
    initialState.isBrowsePanelOpen ?? true
  );
  const [browsePanelWidth, setBrowsePanelWidth] = createSignal(
    initialState.browsePanelWidth || DEFAULT_PANEL_WIDTH
  );

  const [wsUrl, setWsUrl] = createSignal(props.wsUrl);
  const [autoConnect, setAutoConnect] = createSignal(props.autoConnect);
  const [autoRefresh, setAutoRefresh] = createSignal(true);
  const [debug, setDebug] = createSignal(false);
  const [logs, setLogs] = createSignal<string[]>([]);

  // Real WebSocket state from feed
  const connectionStatus = () => feed.state().connectionStatus;
  const hasPendingUpdates = () => feed.state().hasPendingUpdates;
  const lastUpdated = () => feed.state().lastUpdated;

  // Track thumbnail requests to avoid duplicates
  const [requestedThumbnails, setRequestedThumbnails] = createSignal<
    Set<string>
  >(new Set());

  // Selection hook with storage integration
  const selection = useSelection({
    onSelectionChange: (selectedItems) => {
      // Auto-save selection changes
      saveState({ selectedItems });
    },
    onDelete: (selectedItems) => {
      console.log("Delete requested for", selectedItems.size, "items");
      // TODO: Implement delete with confirmation
    },
    saveToStorage: (_selectedItems) => {
      // Already handled by onSelectionChange
    },
    initialSelection: new Set(
      initialState.selectedItems ? Array.from(initialState.selectedItems) : []
    ),
  });

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
      selection.selectRange(selection.lastSelectedIndex(), index, sortedData());
    } else {
      // Delegate to selection hook
      selection.handleRowClick(item, index, event);
    }
  };

  const handleRowDoubleClick = (item: MediaBlob) => {
    // TODO: Open preview popup
    console.log("Double-clicked:", item.id);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "a" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      selection.selectAll(sortedData());
    } else {
      // Delegate to selection hook
      selection.handleKeyDown(event);
    }
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
        selection.selectRange(startIdx, endIdx, sortedData());
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

  // Computed values
  const filteredData = createMemo(() => {
    const config = filterConfig();
    return feed.state().items.filter((item) => {
      // Name filter
      if (
        config.name &&
        !getDisplayFilename(item as any)
          .toLowerCase()
          .includes(config.name.toLowerCase())
      ) {
        return false;
      }

      // MIME filter
      if (config.mime && !item.mime?.startsWith(config.mime)) {
        return false;
      }

      // Blob type filter
      if (config.blobType && item.blob_type !== config.blobType) {
        return false;
      }

      // Size filter
      if (
        (item.size || 0) < config.minSize ||
        (item.size || 0) > config.maxSize
      ) {
        return false;
      }

      // Has parent filter
      if (config.hasParent !== "all") {
        const hasParent = !!item.parent_blob_id;
        if (config.hasParent === "yes" && !hasParent) return false;
        if (config.hasParent === "no" && hasParent) return false;
      }

      // Has local path filter
      if (config.hasLocalPath !== "all") {
        const hasLocalPath = !!item.local_path;
        if (config.hasLocalPath === "yes" && !hasLocalPath) return false;
        if (config.hasLocalPath === "no" && hasLocalPath) return false;
      }

      return true;
    });
  });

  const sortedData = createMemo(() => {
    const config = sortConfig();
    const data = [...filteredData()];

    return data.sort((a, b) => {
      const aValue = (a as any)[config.field];
      const bValue = (b as any)[config.field];

      let comparison = 0;
      if (aValue < bValue) comparison = -1;
      else if (aValue > bValue) comparison = 1;

      return config.direction === "desc" ? comparison * -1 : comparison;
    });
  });

  // Helper function to request thumbnails
  const requestThumbnails = (itemId: string) => {
    if (!requestedThumbnails().has(itemId)) {
      setRequestedThumbnails((prev) => new Set([...prev, itemId]));
      feed.actions.getThumbnails(itemId);
      addLog(`🖼️ Requesting thumbnails for ${itemId.slice(0, 8)}`);
    }
  };

  const visibleColumns = createMemo((): GridColumn<MediaBlob>[] => {
    const vis = columnVisibility();
    const columns: GridColumn<MediaBlob>[] = [];

    // Thumbnail column (first)
    if (vis.thumbnail) {
      columns.push({
        key: "thumbnail",
        title: "📷",
        width: 60,
        render: (item) => (
          <Thumbnail
            item={item}
            size={40}
            apiBaseUrl={props.apiBaseUrl}
            onRequestThumbnails={requestThumbnails}
            requestedThumbnails={requestedThumbnails()}
            showIndicators={true}
          />
        ),
      });
    }

    // Name column (second)
    if (vis.name) {
      columns.push({
        key: "name",
        title: "Name",
        width: 250,
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
        title: "Actions",
        width: 100,
        render: (item) => (
          <button
            style={`
              background: #ff00ff;
              border: none;
              color: #000000;
              padding: 4px 8px;
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
              font-weight: 600;
            `}
            onClick={() =>
              window.open(`${props.apiBaseUrl}/api/blobs/${item.id}`, "_blank")
            }
          >
            ⋯
          </button>
        ),
      });
    }

    return columns;
  });

  const mimeCategories = createMemo(() => {
    return [
      ...new Set(
        feed
          .state()
          .items.map((item) => item.mime?.split("/")[0])
          .filter(Boolean)
      ),
    ].sort() as string[];
  });

  const blobTypes = createMemo(() => {
    const unique = [
      ...new Set(feed.state().items.map((item) => item.blob_type)),
    ];
    return unique.sort();
  });

  // Actions
  const updateFilter = (key: keyof FilterConfig, value: any) => {
    setFilterConfig((prev) => ({ ...prev, [key]: value }));
    saveState({ filterConfig: { ...filterConfig(), [key]: value } });
  };

  const handleSort = (field: string, direction: "asc" | "desc") => {
    setSortConfig({ field, direction });
    saveState({ sortConfig: { field: field as SortField, direction } });
  };

  const handleViewModeChange = (mode: GridViewMode) => {
    setViewMode(mode);
    saveState({ viewMode: mode });
  };

  const toggleColumnVisibility = (column: keyof ColumnVisibility) => {
    setColumnVisibility((prev) => {
      const updated = { ...prev, [column]: !prev[column] };
      saveState({ columnVisibility: updated });
      return updated;
    });
  };

  const toggleBrowsePanel = () => {
    setIsBrowsePanelOpen((prev) => {
      const newValue = !prev;
      saveState({ isBrowsePanelOpen: newValue });
      return newValue;
    });
  };

  const toggleFilterPanel = () => {
    setIsFilterPanelOpen((prev) => {
      const newValue = !prev;
      saveState({ isFilterPanelOpen: newValue });
      return newValue;
    });
  };

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [`${timestamp}: ${message}`, ...prev.slice(0, 49)]);
  };

  // Reactive effects for feed state monitoring
  createEffect(() => {
    const items = feed.state().items;
    if (items.length > 0) {
      addLog(`📊 Feed updated: ${items.length} items available`);
    }
  });

  // Monitor thumbnail requests
  createEffect(() => {
    const requestedSet = feed.state().requestedThumbnails;
    if (requestedSet.size > 0) {
      addLog(`🖼️ Thumbnail requests: ${requestedSet.size} items`);
    }
  });

  createEffect(() => {
    const status = feed.state().connectionStatus;
    addLog(`🔌 Connection status: ${status}`);
  });

  createEffect(() => {
    if (feed.state().hasPendingUpdates) {
      addLog(
        `📥 ${feed.state().pendingUpdates.length} pending updates available`
      );
    }
  });

  // Component initialization
  onMount(() => {
    addLog("🚀 FreqholeDemo mounted");
    addLog(`🔌 WebSocket URL: ${wsUrl()}`);

    if (autoConnect()) {
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
        isOpen={isBrowsePanelOpen()}
        filterConfig={filterConfig()}
        onTogglePanel={toggleBrowsePanel}
        onFilterChange={updateFilter}
        onWidthChange={(width) => {
          setBrowsePanelWidth(width);
          saveState({ browsePanelWidth: width });
        }}
        initialWidth={browsePanelWidth()}
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
        onMore={() => {
          console.log("Show bulk actions menu");
          // TODO: Implement bulk actions menu
        }}
      />

      {/* Main Content */}
      <div style="flex: 1; position: relative; overflow: hidden; min-width: 0;">
        <InfiniteDataGrid
          data={sortedData() as any}
          columns={visibleColumns()}
          onSort={handleSort}
          sortField={sortConfig().field}
          sortDirection={sortConfig().direction as "asc" | "desc"}
          rowHeight={
            viewMode() === "compact" ? 40 : viewMode() === "detailed" ? 80 : 60
          }
          headerHeight={60}
          getItemId={(item) => item.id}
          selectedItems={selection.selectedItems()}
          onRowClick={handleRowClick}
          onRowDoubleClick={handleRowDoubleClick}
          onRowMouseDown={selection.handleRowMouseDown}
          isDragSelecting={selection.isDragSelecting()}
          showPaginationStatus={true}
          onLoadMore={() => feed.actions.loadMore()}
          hasMore={feed.state().hasMore}
          isLoadingMore={feed.state().isLoadingMore}
        />
      </div>

      {/* Edge Toggle Buttons */}
      <EdgeToggleButton
        isVisible={!isBrowsePanelOpen()}
        position="left"
        panelName="Browse"
        onClick={toggleBrowsePanel}
      />

      <EdgeToggleButton
        isVisible={!isFilterPanelOpen()}
        position="right"
        panelName="Controls"
        onClick={toggleFilterPanel}
      />

      {/* Drag Selection Box */}
      <Show
        when={
          selection.isDragSelecting() &&
          selection.dragStart() &&
          selection.dragEnd()
        }
      >
        <div
          style={(() => {
            const start = selection.dragStart()!;
            const end = selection.dragEnd()!;
            const left = Math.min(start.x, end.x);
            const top = Math.min(start.y, end.y);
            const width = Math.abs(end.x - start.x);
            const height = Math.abs(end.y - start.y);
            return `
              position: fixed;
              left: ${left}px;
              top: ${top}px;
              width: ${width}px;
              height: ${height}px;
              border: 2px dashed #ff00ff;
              background: rgba(255, 0, 255, 0.1);
              pointer-events: none;
              z-index: 1000;
            `;
          })()}
        />
      </Show>

      {/* Filter Panel */}
      <FilterPanel
        isOpen={isFilterPanelOpen()}
        filterConfig={filterConfig()}
        viewMode={viewMode()}
        columnVisibility={columnVisibility()}
        wsUrl={wsUrl()}
        autoConnect={autoConnect()}
        autoRefresh={autoRefresh()}
        debug={debug()}
        connectionStatus={connectionStatus()}
        hasPendingUpdates={hasPendingUpdates()}
        pendingUpdatesCount={feed.state().pendingUpdates.length}
        filteredCount={filteredData().length}
        totalCount={feed.state().items.length}
        sortConfig={sortConfig()}
        lastUpdated={lastUpdated()}
        mimeCategories={mimeCategories()}
        blobTypes={blobTypes()}
        logs={logs()}
        onTogglePanel={toggleFilterPanel}
        onFilterChange={updateFilter}
        onViewModeChange={handleViewModeChange}
        onColumnToggle={toggleColumnVisibility}
        onWsUrlChange={setWsUrl}
        onConnect={() => {
          feed.actions.connect();
          addLog("🔌 Connecting to WebSocket...");
        }}
        onDisconnect={() => {
          feed.actions.disconnect();
          addLog("🔌 Disconnecting from WebSocket...");
        }}
        onRefresh={() => {
          addLog("🔄 Refreshing data...");
          feed.actions.refresh();
        }}
        onApplyPendingUpdates={() => {
          feed.actions.applyPendingUpdates();
          addLog("✅ Applied pending updates");
        }}
        onToggleAutoConnect={() => {
          setAutoConnect((prev) => !prev);
          addLog(`🔧 Auto-connect: ${!autoConnect() ? "ON" : "OFF"}`);
        }}
        onToggleAutoRefresh={() => {
          setAutoRefresh((prev) => !prev);
          addLog(`🔧 Auto-refresh: ${!autoRefresh() ? "ON" : "OFF"}`);
        }}
        onToggleDebug={() => {
          setDebug((prev) => !prev);
          addLog(`🐛 Debug: ${!debug() ? "ON" : "OFF"}`);
        }}
        onReset={() => {
          if (
            confirm(
              "Reset all filters, sort settings, and panel width? This will reload the page."
            )
          ) {
            localStorage.removeItem(STORAGE_KEY);
            window.location.reload();
          }
        }}
        onWidthChange={(width) => {
          setFilterPanelWidth(width);
          saveState({ filterPanelWidth: width });
        }}
        initialWidth={filterPanelWidth()}
      />

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
    </div>
  );
}

// Helper functions moved to lib/media-utils.ts and lib/format-utils.ts
// Mock data generation removed - now using real WebSocket feed data

export default FreqholeDemo;
