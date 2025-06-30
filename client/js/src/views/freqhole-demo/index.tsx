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
import { PopupPreview } from "./components/PopupPreview";
import { ActionMenu } from "./components/ActionMenu";
import { BulkActionMenu } from "./components/BulkActionMenu";
import { DragSelectionOverlay } from "./components/DragSelectionOverlay";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { useKeyboardNavigation } from "./hooks/useKeyboardNavigation";
import { useViewModes } from "./hooks/useViewModes";
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

  // View mode is now handled by useViewModes hook

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

  // Popup preview state
  const [popupPreview, setPopupPreview] = createSignal<{
    item: MediaBlob;
    isOpen: boolean;
  } | null>(null);

  // Action menu state
  const [actionMenu, setActionMenu] = createSignal<{
    item: MediaBlob;
    isOpen: boolean;
    position: { x: number; y: number };
  } | null>(null);

  // Bulk action menu state
  const [bulkActionMenu, setBulkActionMenu] = createSignal<{
    isOpen: boolean;
    position: { x: number; y: number };
  } | null>(null);

  // Confirm dialog state
  const [confirmDialog, setConfirmDialog] = createSignal<{
    isOpen: boolean;
    title: string;
    message: string;
    items?: MediaBlob[];
    onConfirm: () => void;
  } | null>(null);

  // View modes
  const viewModes = useViewModes((initialState.viewMode as any) || "default");

  // Helper functions that will be used by hooks
  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [`${timestamp}: ${message}`, ...prev.slice(0, 49)]);
  };

  // Keyboard navigation
  const keyboardNav = useKeyboardNavigation({
    onPreview: (item) => setPopupPreview({ item, isOpen: true }),
    onToggleSelection: (item) => selection.toggleSelection(item.id),
    onSelectAll: (items) => selection.selectAll(items),
    onClearSelection: () => selection.clearSelection(),
    onEscape: () => {
      if (popupPreview()?.isOpen) {
        closePopupPreview();
      } else if (actionMenu()?.isOpen) {
        closeActionMenu();
      } else if (bulkActionMenu()?.isOpen) {
        closeBulkActionMenu();
      } else {
        selection.clearSelection();
      }
    },
    onDelete: (items) => {
      setConfirmDialog({
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
          setConfirmDialog(null);
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
    getAllItems: () => sortedData(),
    onLog: addLog,
  });

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
      const items = sortedData().filter((item) => selectedItems.has(item.id));
      setConfirmDialog({
        isOpen: true,
        title: "Delete Selected Files",
        message: `Delete ${items.length} selected file${items.length !== 1 ? "s" : ""}?`,
        items: items,
        onConfirm: () => {
          // TODO: Implement actual delete API call
          addLog(`🗑️ Deleted ${items.length} selected items`);
          console.log("Deleted selected items:", Array.from(selectedItems));
          selection.clearSelection();
          setConfirmDialog(null);
        },
      });
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
    setPopupPreview({ item, isOpen: true });
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
      setBulkActionMenu({
        isOpen: true,
        position,
      });
      addLog(`🖱️ Bulk context menu opened for ${selectedCount} items`);
    } else {
      // Show individual action menu for single item
      setActionMenu({
        item,
        isOpen: true,
        position,
      });
      addLog(`🖱️ Context menu opened for: ${getDisplayFilename(item)}`);
    }
  };

  const closePopupPreview = () => {
    setPopupPreview(null);
  };

  const closeActionMenu = () => {
    setActionMenu(null);
  };

  const closeBulkActionMenu = () => {
    setBulkActionMenu(null);
  };

  const handleActionMenuClick = (item: MediaBlob, event: MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();

    const currentMenu = actionMenu();
    if (currentMenu && currentMenu.item.id === item.id) {
      // Close if clicking same item
      closeActionMenu();
      addLog(`⋯ Action menu closed for: ${getDisplayFilename(item)}`);
    } else {
      // Open menu at button position
      const rect = (event.target as HTMLElement).getBoundingClientRect();
      const position = {
        x: rect.right - 120, // Offset to the left of button
        y: rect.bottom + 4,
      };

      setActionMenu({
        item,
        isOpen: true,
        position,
      });
      addLog(`⋯ Action menu opened for: ${getDisplayFilename(item)}`);
    }
  };

  const handleDownload = async (item: MediaBlob) => {
    try {
      const filename = getDisplayFilename(item);
      const link = document.createElement("a");
      link.href = `/api/blobs/${item.id}`;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      addLog(`📥 Downloaded: ${filename}`);
    } catch (error) {
      console.error("Download failed:", error);
      addLog(`❌ Download failed: ${error}`);
    }
  };

  const handleCopyUrl = async (item: MediaBlob) => {
    try {
      const url = `${window.location.origin}/api/blobs/${item.id}`;
      await navigator.clipboard.writeText(url);
      addLog(`🔗 Copied URL for: ${getDisplayFilename(item)}`);
    } catch (error) {
      console.error("Copy URL failed:", error);
      addLog(`❌ Copy URL failed: ${error}`);
    }
  };

  const handleDeleteItem = (item: MediaBlob) => {
    setConfirmDialog({
      isOpen: true,
      title: "Delete File",
      message: `Are you sure you want to delete this file? This action cannot be undone.`,
      items: [item],
      onConfirm: () => {
        // TODO: Implement actual delete API call
        addLog(`🗑️ Deleted: ${getDisplayFilename(item)}`);
        console.log("Deleted item:", item.id);
        setConfirmDialog(null);
      },
    });
  };

  const handleBulkMoreClick = (event: MouseEvent) => {
    const currentMenu = bulkActionMenu();
    if (currentMenu?.isOpen) {
      // Close if already open
      closeBulkActionMenu();
    } else {
      // Position menu above the More button
      const rect = (event.target as HTMLElement).getBoundingClientRect();
      const position = {
        x: rect.left + rect.width / 2 - 100, // Center horizontally
        y: rect.top - 10, // Position above button
      };

      setBulkActionMenu({
        isOpen: true,
        position,
      });
    }
  };

  const handleBulkDownload = async () => {
    const selectedItems = Array.from(selection.selectedItems());
    const items = sortedData().filter((item) =>
      selectedItems.includes(item.id)
    );

    addLog(`📥 Starting bulk download of ${items.length} items...`);

    for (const item of items) {
      await handleDownload(item);
      // Small delay to prevent overwhelming the browser
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    addLog(`✅ Bulk download completed: ${items.length} items`);
  };

  const handleBulkDelete = () => {
    const selectedItems = Array.from(selection.selectedItems());
    const items = sortedData().filter((item) =>
      selectedItems.includes(item.id)
    );

    setConfirmDialog({
      isOpen: true,
      title: "Delete Multiple Files",
      message: `Are you sure you want to delete ${items.length} files?`,
      items: items,
      onConfirm: () => {
        // TODO: Implement actual bulk delete API call
        addLog(`🗑️ Bulk deleted ${items.length} items`);
        console.log("Bulk deleted items:", selectedItems);
        selection.clearSelection();
        setConfirmDialog(null);
      },
    });
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
      // Special handling for dynamic name field
      if (config.field === "name") {
        const aName = getDisplayFilename(a);
        const bName = getDisplayFilename(b);
        const comparison = aName.localeCompare(bName, undefined, {
          numeric: true,
          sensitivity: "base",
        });
        return config.direction === "desc" ? comparison * -1 : comparison;
      }

      // Date comparison
      if (
        config.field.includes("_at") ||
        config.field.includes("date") ||
        config.field.includes("time")
      ) {
        const aDate = new Date((a as any)[config.field]);
        const bDate = new Date((b as any)[config.field]);
        if (!isNaN(aDate.getTime()) && !isNaN(bDate.getTime())) {
          const comparison = aDate.getTime() - bDate.getTime();
          return config.direction === "desc" ? comparison * -1 : comparison;
        }
      }

      // Numeric comparison
      const aValue = (a as any)[config.field];
      const bValue = (b as any)[config.field];

      if (aValue == null && bValue == null) return 0;
      if (aValue == null) return config.direction === "desc" ? -1 : 1;
      if (bValue == null) return config.direction === "desc" ? 1 : -1;

      const aNum = Number(aValue);
      const bNum = Number(bValue);
      if (
        !isNaN(aNum) &&
        !isNaN(bNum) &&
        typeof aValue === "number" &&
        typeof bValue === "number"
      ) {
        const comparison = aNum - bNum;
        return config.direction === "desc" ? comparison * -1 : comparison;
      }

      // String comparison (case-insensitive)
      const aStr = String(aValue).toLowerCase();
      const bStr = String(bValue).toLowerCase();
      const comparison = aStr.localeCompare(bStr);
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
    viewModes.setViewMode(mode as any);
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
        onMore={handleBulkMoreClick}
      />

      {/* Main Content */}
      <div style="flex: 1; position: relative; overflow: hidden; min-width: 0;">
        <InfiniteDataGrid
          data={sortedData() as any}
          columns={visibleColumns()}
          onSort={handleSort}
          sortField={sortConfig().field}
          sortDirection={sortConfig().direction as "asc" | "desc"}
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
        viewMode={viewModes.viewMode()}
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

      {/* Popup Preview */}
      <PopupPreview
        item={popupPreview()?.item || null}
        isOpen={popupPreview()?.isOpen || false}
        onClose={closePopupPreview}
      />

      {/* Action Menu */}
      <ActionMenu
        item={actionMenu()?.item || null}
        isOpen={actionMenu()?.isOpen || false}
        position={actionMenu()?.position || { x: 0, y: 0 }}
        onClose={closeActionMenu}
        onDownload={handleDownload}
        onPreview={(item) => setPopupPreview({ item, isOpen: true })}
        onDelete={handleDeleteItem}
        onCopyUrl={handleCopyUrl}
      />

      {/* Bulk Action Menu */}
      <BulkActionMenu
        selectedCount={selection.selectedItems().size}
        isOpen={bulkActionMenu()?.isOpen || false}
        position={bulkActionMenu()?.position || { x: 0, y: 0 }}
        onClose={closeBulkActionMenu}
        onDownloadAll={handleBulkDownload}
        onDeleteAll={handleBulkDelete}
        onClearSelection={selection.clearSelection}
      />

      {/* Confirm Dialog */}
      <ConfirmDialog
        isOpen={confirmDialog()?.isOpen || false}
        title={confirmDialog()?.title || ""}
        message={confirmDialog()?.message || ""}
        items={confirmDialog()?.items}
        onConfirm={confirmDialog()?.onConfirm || (() => {})}
        onCancel={() => setConfirmDialog(null)}
      />

      {/* Drag Selection Overlay */}
      <DragSelectionOverlay
        isDragSelecting={selection.isDragSelecting()}
        dragStart={selection.dragStart()}
        dragEnd={selection.dragEnd()}
      />
    </div>
  );
}

// Helper functions moved to lib/media-utils.ts and lib/format-utils.ts
// Mock data generation removed - now using real WebSocket feed data

export default FreqholeDemo;
